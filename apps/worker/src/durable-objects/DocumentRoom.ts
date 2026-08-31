import { DurableObject } from "cloudflare:workers";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import * as awarenessProtocol from "y-protocols/awareness";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";

import { db } from "../db/client.ts";
import { persistMarkdownSnapshot } from "../services/notes.ts";

/** y-websocket 互換のトップレベルメッセージ種別。 */
const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;
const MESSAGE_QUERY_AWARENESS = 3;

const STORAGE_YJS_KEY = "yjs-update";
const STORAGE_NOTE_ID_KEY = "note-id";
const SNAPSHOT_DEBOUNCE_MS = 3000;

type WsAttachment = {
  canEdit: boolean;
  userId?: string;
  displayName?: string;
  awarenessClientIds: number[];
};

function extractAwarenessClientIds(update: Uint8Array): number[] {
  const decoder = decoding.createDecoder(update);
  const len = decoding.readVarUint(decoder);
  const ids: number[] = [];
  for (let i = 0; i < len; i += 1) {
    ids.push(decoding.readVarUint(decoder));
    decoding.readVarUint(decoder);
    decoding.readVarString(decoder);
  }
  return ids;
}

/**
 * ノート 1 件につき 1 Durable Object。
 * Yjs 同期・awareness・SQLite 永続化・MCP からの applyMarkdown を担う。
 */
export class DocumentRoom extends DurableObject<Env> {
  private doc: Y.Doc | null = null;
  private awareness: awarenessProtocol.Awareness | null = null;
  private loading: Promise<void> | null = null;
  private snapshotTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  async fetch(request: Request): Promise<Response> {
    const upgrade = request.headers.get("Upgrade");
    if (!upgrade || upgrade.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket upgrade", {
        status: 426,
        headers: { Upgrade: "websocket" },
      });
    }

    const noteId = request.headers.get("X-Note-Id");
    if (!noteId) {
      return new Response("Missing X-Note-Id", { status: 400 });
    }

    await this.ensureInitialized(noteId);

    const canEdit = request.headers.get("X-Can-Edit") === "true";
    const userId = request.headers.get("X-User-Id") ?? undefined;
    const displayName = request.headers.get("X-Display-Name") ?? undefined;

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server);

    const attachment: WsAttachment = {
      canEdit,
      userId,
      displayName,
      awarenessClientIds: [],
    };
    server.serializeAttachment(attachment);

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(
    ws: WebSocket,
    message: ArrayBuffer | string,
  ): Promise<void> {
    await this.ensureInitialized();

    const attachment = ws.deserializeAttachment() as WsAttachment | null;
    const canEdit = attachment?.canEdit ?? false;

    const data =
      typeof message === "string"
        ? new TextEncoder().encode(message)
        : new Uint8Array(message);
    const decoder = decoding.createDecoder(data);
    const messageType = decoding.readVarUint(decoder);

    switch (messageType) {
      case MESSAGE_SYNC: {
        const syncTypePos = decoder.pos;
        const syncMessageType = decoding.readVarUint(decoder);
        decoder.pos = syncTypePos;

        if (
          !canEdit &&
          (syncMessageType === syncProtocol.messageYjsSyncStep2 ||
            syncMessageType === syncProtocol.messageYjsUpdate)
        ) {
          break;
        }

        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_SYNC);
        syncProtocol.readSyncMessage(decoder, encoder, this.doc!, ws);

        if (encoding.length(encoder) > 1) {
          ws.send(encoding.toUint8Array(encoder));
        }
        break;
      }
      case MESSAGE_AWARENESS: {
        const update = decoding.readVarUint8Array(decoder);
        if (attachment) {
          const clientIds = extractAwarenessClientIds(update);
          attachment.awarenessClientIds = [
            ...new Set([...attachment.awarenessClientIds, ...clientIds]),
          ];
          ws.serializeAttachment(attachment);
        }
        awarenessProtocol.applyAwarenessUpdate(this.awareness!, update, ws);
        break;
      }
      case MESSAGE_QUERY_AWARENESS: {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
        encoding.writeVarUint8Array(
          encoder,
          awarenessProtocol.encodeAwarenessUpdate(
            this.awareness!,
            Array.from(this.awareness!.getStates().keys()),
          ),
        );
        ws.send(encoding.toUint8Array(encoder));
        break;
      }
      default:
        break;
    }
  }

  async webSocketClose(
    ws: WebSocket,
    _code: number,
    _reason: string,
    _wasClean: boolean,
  ): Promise<void> {
    await this.ensureInitialized();

    const attachment = ws.deserializeAttachment() as WsAttachment | null;
    if (attachment?.awarenessClientIds.length) {
      awarenessProtocol.removeAwarenessStates(
        this.awareness!,
        attachment.awarenessClientIds,
        ws,
      );
    }
  }

  async webSocketError(_ws: WebSocket, _error: unknown): Promise<void> {
    // 接続エラーは webSocketClose で後処理する。
  }

  async applyMarkdown(markdown: string): Promise<void> {
    await this.ensureInitialized();
    const doc = this.doc!;
    const ytext = doc.getText("markdown");

    doc.transact(() => {
      ytext.delete(0, ytext.length);
      if (markdown.length > 0) {
        ytext.insert(0, markdown);
      }
    }, "applyMarkdown");

    this.scheduleSnapshotPersist();
  }

  async getMarkdown(): Promise<string> {
    await this.ensureInitialized();
    return this.doc!.getText("markdown").toString();
  }

  private async ensureInitialized(noteId?: string): Promise<void> {
    if (noteId) {
      const existing = await this.ctx.storage.get<string>(STORAGE_NOTE_ID_KEY);
      if (!existing) {
        await this.ctx.storage.put(STORAGE_NOTE_ID_KEY, noteId);
      }
    }

    if (this.doc) {
      return;
    }

    if (!this.loading) {
      this.loading = this.initializeDocument();
    }
    await this.loading;
  }

  private async initializeDocument(): Promise<void> {
    if (this.doc) {
      return;
    }

    const doc = new Y.Doc();
    const awareness = new awarenessProtocol.Awareness(doc);

    const storedUpdate =
      await this.ctx.storage.get<ArrayBuffer>(STORAGE_YJS_KEY);
    if (storedUpdate && storedUpdate.byteLength > 0) {
      Y.applyUpdate(doc, new Uint8Array(storedUpdate));
    } else {
      const noteId = await this.ctx.storage.get<string>(STORAGE_NOTE_ID_KEY);
      if (noteId) {
        const row = await db(this.env)
          .prepare("SELECT markdown_snapshot FROM notes WHERE id = ?")
          .bind(noteId)
          .first<{ markdown_snapshot: string }>();

        const snapshot = row?.markdown_snapshot ?? "";
        if (snapshot.length > 0) {
          doc.getText("markdown").insert(0, snapshot);
          await this.persistYjsState(doc);
        }
      }
    }

    doc.on("update", (update: Uint8Array, origin: unknown) => {
      void this.onDocUpdate(update, origin);
    });

    awareness.on("update", (_changes: unknown, origin: unknown) => {
      this.broadcastAwareness(origin);
    });

    this.doc = doc;
    this.awareness = awareness;
  }

  private async onDocUpdate(
    update: Uint8Array,
    origin: unknown,
  ): Promise<void> {
    const doc = this.doc;
    if (!doc) {
      return;
    }

    await this.persistYjsState(doc);
    this.broadcastSyncUpdate(update, origin);
    this.scheduleSnapshotPersist();
  }

  private async persistYjsState(doc: Y.Doc): Promise<void> {
    const merged = Y.encodeStateAsUpdate(doc);
    await this.ctx.storage.put(STORAGE_YJS_KEY, merged);
  }

  private broadcastSyncUpdate(update: Uint8Array, origin: unknown): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    const payload = encoding.toUint8Array(encoder);

    for (const ws of this.ctx.getWebSockets()) {
      if (ws === origin) {
        continue;
      }
      try {
        ws.send(payload);
      } catch {
        // 切断済み接続は無視する。
      }
    }
  }

  private broadcastAwareness(origin: unknown): void {
    const awareness = this.awareness;
    if (!awareness) {
      return;
    }

    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(
        awareness,
        Array.from(awareness.getStates().keys()),
      ),
    );
    const payload = encoding.toUint8Array(encoder);

    for (const ws of this.ctx.getWebSockets()) {
      if (ws === origin) {
        continue;
      }
      try {
        ws.send(payload);
      } catch {
        // 切断済み接続は無視する。
      }
    }
  }

  private scheduleSnapshotPersist(): void {
    if (this.snapshotTimer !== null) {
      clearTimeout(this.snapshotTimer);
    }

    this.snapshotTimer = setTimeout(() => {
      this.snapshotTimer = null;
      void this.flushSnapshotToD1();
    }, SNAPSHOT_DEBOUNCE_MS);
  }

  private async flushSnapshotToD1(): Promise<void> {
    const noteId = await this.ctx.storage.get<string>(STORAGE_NOTE_ID_KEY);
    if (!noteId || !this.doc) {
      return;
    }

    const markdown = this.doc.getText("markdown").toString();
    await persistMarkdownSnapshot(this.env, noteId, markdown);
  }
}
