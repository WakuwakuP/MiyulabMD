import { DurableObject } from "cloudflare:workers";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import * as awarenessProtocol from "y-protocols/awareness";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";

import { db } from "../db/client.ts";
import { persistMarkdownSnapshot } from "../services/notes.ts";
import {
  AGENT_IDLE_MS,
  type AgentPresenceInput,
  agentAwarenessState,
} from "./agent-presence.ts";
import {
  type AwarenessChanges,
  applyOwnedClientChanges,
  clientsForAwarenessBroadcast,
  clockForRemoval,
  encodeAwarenessNullUpdate,
  nextAwarenessClocks,
} from "./awareness-sync.ts";
import {
  type AgentCursor,
  applyTextDiff,
  excerptAround,
  type InsertPosition,
  planInsert,
  planReplace,
} from "./markdown-edit.ts";

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
  awarenessClocks: Record<string, number>;
};

function isRoomSocket(origin: unknown): origin is WebSocket {
  return (
    typeof origin === "object" &&
    origin !== null &&
    "deserializeAttachment" in origin &&
    "serializeAttachment" in origin
  );
}

export type ApplyEditInput = {
  noteId: string;
  agent: AgentPresenceInput;
} & (
  | {
      op: "replace";
      oldString: string;
      newString: string;
      replaceAll?: boolean;
    }
  | { op: "insert"; text: string; position: InsertPosition }
  | { op: "set"; markdown: string }
);

export type ApplyEditResult =
  | {
      ok: true;
      cursor: AgentCursor;
      excerpt: string;
      markdownLength: number;
    }
  | {
      ok: false;
      error: "not_found" | "ambiguous" | "invalid";
      message: string;
      matches?: number;
    };

/**
 * ノート 1 件につき 1 Durable Object。
 * Yjs 同期・awareness・SQLite 永続化・MCP からの差分編集を担う。
 */
export class DocumentRoom extends DurableObject<Env> {
  private doc: Y.Doc | null = null;
  private awareness: awarenessProtocol.Awareness | null = null;
  private loading: Promise<void> | null = null;
  private snapshotTimer: ReturnType<typeof setTimeout> | null = null;
  private agentIdleTimer: ReturnType<typeof setTimeout> | null = null;

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
      awarenessClocks: {},
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
    const owned = attachment?.awarenessClientIds ?? [];
    if (owned.length === 0) {
      return;
    }

    const awareness = this.awareness!;
    const present = owned.filter((id) => awareness.getStates().has(id));
    if (present.length > 0) {
      awarenessProtocol.removeAwarenessStates(awareness, present, ws);
    }

    const stale = owned.filter((id) => !awareness.meta.has(id));
    if (stale.length > 0) {
      const clocks = attachment?.awarenessClocks ?? {};
      this.sendAwarenessUpdate(
        encodeAwarenessNullUpdate(
          stale.map((clientId) => ({
            clientId,
            clock: clockForRemoval(clocks[String(clientId)]),
          })),
        ),
        ws,
      );
    }
  }

  async webSocketError(_ws: WebSocket, _error: unknown): Promise<void> {
    // 接続エラーは webSocketClose で後処理する。
  }

  async applyMarkdown(markdown: string, noteId?: string): Promise<void> {
    await this.ensureInitialized(noteId);
    const ytext = this.doc!.getText("markdown");
    applyTextDiff(ytext, markdown, "applyMarkdown");
    this.scheduleSnapshotPersist();
  }

  async getMarkdown(noteId?: string): Promise<string> {
    await this.ensureInitialized(noteId);
    return this.doc!.getText("markdown").toString();
  }

  /** 最新本文を返し、エージェントのカーソルを出す。 */
  async readForAgent(
    noteId: string,
    agent: AgentPresenceInput,
  ): Promise<string> {
    await this.ensureInitialized(noteId);
    const markdown = this.doc!.getText("markdown").toString();
    this.touchAgentPresence(agent, { anchor: 0, head: 0 });
    return markdown;
  }

  async setAgentPresence(
    noteId: string,
    agent: AgentPresenceInput,
    cursor?: AgentCursor,
  ): Promise<void> {
    await this.ensureInitialized(noteId);
    this.touchAgentPresence(agent, cursor ?? { anchor: 0, head: 0 });
  }

  async clearAgentPresence(): Promise<void> {
    await this.ensureInitialized();
    this.stopAgentIdle();
    this.awareness?.setLocalState(null);
  }

  async applyEdit(input: ApplyEditInput): Promise<ApplyEditResult> {
    await this.ensureInitialized(input.noteId);
    const ytext = this.doc!.getText("markdown");
    const current = ytext.toString();

    const plan =
      input.op === "replace"
        ? planReplace(
            current,
            input.oldString,
            input.newString,
            input.replaceAll,
          )
        : input.op === "insert"
          ? planInsert(current, input.text, input.position)
          : {
              ok: true as const,
              next: input.markdown,
              cursor: cursorAfterSet(current, input.markdown),
            };

    if (!plan.ok) {
      return plan;
    }

    applyTextDiff(ytext, plan.next, "applyEdit");
    this.touchAgentPresence(input.agent, plan.cursor);
    this.scheduleSnapshotPersist();

    return {
      ok: true,
      cursor: plan.cursor,
      excerpt: excerptAround(plan.next, plan.cursor.anchor, plan.cursor.head),
      markdownLength: plan.next.length,
    };
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

    awareness.on("update", (changes: AwarenessChanges, origin: unknown) => {
      this.trackOwnedAwareness(changes, origin);
      this.broadcastAwarenessDiff(changes, origin);
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

  private trackOwnedAwareness(
    changes: AwarenessChanges,
    origin: unknown,
  ): void {
    if (!isRoomSocket(origin)) {
      return;
    }

    const attachment = origin.deserializeAttachment() as WsAttachment | null;
    if (!attachment) {
      return;
    }

    const owned = applyOwnedClientChanges(
      attachment.awarenessClientIds ?? [],
      changes,
    );
    attachment.awarenessClientIds = owned;
    attachment.awarenessClocks = nextAwarenessClocks(
      attachment.awarenessClocks ?? {},
      owned,
      changes,
      (clientId) => this.awareness?.meta.get(clientId)?.clock,
    );
    origin.serializeAttachment(attachment);
  }

  private broadcastAwarenessDiff(
    changes: AwarenessChanges,
    origin: unknown,
  ): void {
    const awareness = this.awareness;
    if (!awareness) {
      return;
    }

    const clients = clientsForAwarenessBroadcast(changes);
    if (clients.length === 0) {
      return;
    }

    const withMeta = clients.filter((id) => awareness.meta.has(id));
    const withoutMeta = clients.filter((id) => !awareness.meta.has(id));

    if (withMeta.length > 0) {
      this.sendAwarenessUpdate(
        awarenessProtocol.encodeAwarenessUpdate(awareness, withMeta),
        origin,
      );
    }
    if (withoutMeta.length > 0) {
      this.sendAwarenessUpdate(
        encodeAwarenessNullUpdate(
          withoutMeta.map((clientId) => ({
            clientId,
            clock: clockForRemoval(undefined),
          })),
        ),
        origin,
      );
    }
  }

  private sendAwarenessUpdate(update: Uint8Array, origin: unknown): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(encoder, update);
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

  private touchAgentPresence(
    agent: AgentPresenceInput,
    cursor: AgentCursor,
  ): void {
    const awareness = this.awareness;
    const ytext = this.doc?.getText("markdown");
    if (!awareness || !ytext) {
      return;
    }
    awareness.setLocalState(agentAwarenessState(agent, ytext, cursor));
    this.scheduleAgentIdle();
  }

  private scheduleAgentIdle(): void {
    this.stopAgentIdle();
    this.agentIdleTimer = setTimeout(() => {
      this.agentIdleTimer = null;
      this.awareness?.setLocalState(null);
    }, AGENT_IDLE_MS);
  }

  private stopAgentIdle(): void {
    if (this.agentIdleTimer !== null) {
      clearTimeout(this.agentIdleTimer);
      this.agentIdleTimer = null;
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

function cursorAfterSet(previous: string, next: string): AgentCursor {
  const max = Math.min(previous.length, next.length);
  let start = 0;
  while (start < max && previous[start] === next[start]) {
    start += 1;
  }
  return { anchor: start, head: next.length };
}
