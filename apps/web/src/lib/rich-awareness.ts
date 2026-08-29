import * as Y from "yjs";
import type { CollabAwareness } from "./collaboration.ts";

export type RemoteMarkdownCursor = {
  clientId: number;
  name: string;
  color: string;
  colorLight: string;
  anchor: number;
  head: number;
};

export function writeMarkdownCursor(
  awareness: CollabAwareness,
  yText: Y.Text,
  mdAnchor: number,
  mdHead: number,
): void {
  const length = yText.length;
  const anchor = Y.createRelativePositionFromTypeIndex(
    yText,
    clampIndex(mdAnchor, length),
  );
  const head = Y.createRelativePositionFromTypeIndex(
    yText,
    clampIndex(mdHead, length),
  );
  const current = awareness.getLocalState() ?? {};
  const prev = current.cursor as
    | { anchor?: unknown; head?: unknown }
    | undefined;
  if (prev?.anchor && prev.head) {
    const currentAnchor = Y.createRelativePositionFromJSON(prev.anchor);
    const currentHead = Y.createRelativePositionFromJSON(prev.head);
    if (
      Y.compareRelativePositions(currentAnchor, anchor) &&
      Y.compareRelativePositions(currentHead, head)
    ) {
      return;
    }
  }
  awareness.setLocalStateField("cursor", { anchor, head });
}

export function readRemoteMarkdownCursors(
  awareness: CollabAwareness,
  yText: Y.Text,
): RemoteMarkdownCursor[] {
  const doc = yText.doc;
  if (!doc) return [];

  const peers: RemoteMarkdownCursor[] = [];
  awareness.getStates().forEach((state, clientId) => {
    if (clientId === awareness.doc.clientID) return;
    const cursor = state.cursor as
      | { anchor?: unknown; head?: unknown }
      | undefined;
    if (!cursor?.anchor || !cursor.head) return;
    const anchor = Y.createAbsolutePositionFromRelativePosition(
      Y.createRelativePositionFromJSON(cursor.anchor),
      doc,
    );
    const head = Y.createAbsolutePositionFromRelativePosition(
      Y.createRelativePositionFromJSON(cursor.head),
      doc,
    );
    if (!anchor || !head || anchor.type !== yText || head.type !== yText)
      return;

    const user = (state.user ?? {}) as {
      name?: string;
      color?: string;
      colorLight?: string;
    };
    const color = user.color ?? "#30bced";
    peers.push({
      clientId,
      name: user.name ?? "Anonymous",
      color,
      colorLight: user.colorLight ?? `${color}33`,
      anchor: anchor.index,
      head: head.index,
    });
  });
  return peers;
}

function clampIndex(value: number, length: number): number {
  return Math.max(0, Math.min(value, length));
}
