import { useEffect, useState } from "react";
import type { AwarenessUserState, CollabAwareness } from "../../lib/collaboration.ts";

type Props = {
  awareness: CollabAwareness;
  compact?: boolean;
};

function readAwarenessState(state: Record<string, unknown> | null): AwarenessUserState | null {
  if (!state) return null;

  const nested =
    state.user && typeof state.user === "object" ? (state.user as Record<string, unknown>) : null;
  const userId = typeof state.userId === "string" ? state.userId : null;
  const displayName =
    (typeof state.displayName === "string" && state.displayName) ||
    (typeof nested?.name === "string" && nested.name) ||
    null;
  const color =
    (typeof state.color === "string" && state.color) ||
    (typeof nested?.color === "string" && nested.color) ||
    null;

  if (!displayName || !color) {
    return null;
  }
  return { userId: userId ?? displayName, displayName, color };
}

export function PresenceBar({ awareness, compact = false }: Props) {
  const [peers, setPeers] = useState<Array<AwarenessUserState & { clientId: number }>>([]);

  useEffect(() => {
    const sync = () => {
      const localClientId = awareness.clientID;
      const next: Array<AwarenessUserState & { clientId: number }> = [];

      awareness.getStates().forEach((state: unknown, clientId: number) => {
        if (clientId === localClientId) return;
        const parsed = readAwarenessState(state as Record<string, unknown> | null);
        if (parsed) next.push({ ...parsed, clientId });
      });

      setPeers(next);
    };

    sync();
    awareness.on("change", sync);
    return () => {
      awareness.off("change", sync);
    };
  }, [awareness]);

  if (peers.length === 0) {
    return compact ? null : <div className="presence-bar presence-bar--empty">共同編集者はまだいません</div>;
  }

  return (
    <div className={compact ? "presence-bar presence-bar--compact" : "presence-bar"} aria-label="共同編集者">
      {peers.map((peer) => (
        <span key={peer.clientId} className="presence-chip" title={peer.displayName}>
          <span className="presence-dot" style={{ backgroundColor: peer.color }} aria-hidden />
          {compact ? null : peer.displayName}
        </span>
      ))}
    </div>
  );
}
