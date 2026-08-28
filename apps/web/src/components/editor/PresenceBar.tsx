import { useEffect, useState } from "react";
import type { AwarenessUserState, CollabAwareness } from "../../lib/collaboration.ts";
import { colorForEmail } from "../../lib/user-style.ts";
import { Avatar } from "../ui/Avatar.tsx";
import styles from "./presence.module.css";

type Props = {
  awareness: CollabAwareness;
};

function readAwarenessState(state: Record<string, unknown> | null): AwarenessUserState | null {
  if (!state) return null;

  const nested =
    state.user && typeof state.user === "object" ? (state.user as Record<string, unknown>) : null;
  const userId = typeof state.userId === "string" ? state.userId : null;
  const email = typeof state.email === "string" ? state.email : null;
  const displayName =
    (typeof state.displayName === "string" && state.displayName) ||
    (typeof nested?.name === "string" && nested.name) ||
    null;
  const color =
    (typeof state.color === "string" && state.color) ||
    (typeof nested?.color === "string" && nested.color) ||
    colorForEmail(email, userId ?? displayName ?? "guest");

  if (!displayName) {
    return null;
  }
  return { userId: userId ?? displayName, displayName, color };
}

export function PresenceBar({ awareness }: Props) {
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

  if (peers.length === 0) return null;

  return (
    <div className={`${styles.list} ${peers.length >= 5 ? styles.packed : ""}`} aria-label="共同編集者">
      {peers.map((peer) => (
        <span key={peer.clientId} className={styles.item}>
          <Avatar name={peer.displayName} color={peer.color} size="sm" />
        </span>
      ))}
    </div>
  );
}
