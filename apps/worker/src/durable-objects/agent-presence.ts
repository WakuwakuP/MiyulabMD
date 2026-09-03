import * as Y from "yjs";

import type { AgentCursor } from "./markdown-edit.ts";

export const AGENT_COLOR = "#7c3aed";
export const AGENT_IDLE_MS = 35_000;

export type AgentPresenceInput = {
  userId: string;
  displayName?: string;
};

/** トークン所有者の表示名。未設定なら email、それも無ければゲスト。 */
export function agentDisplayName(userLabel?: string | null): string {
  const name = userLabel?.trim() || "ゲスト";
  return `AI(${name})`;
}

export type AgentAwarenessState = {
  userId: string;
  displayName: string;
  color: string;
  email: null;
  kind: "agent";
  user: { name: string; color: string; colorLight: string };
  cursor: {
    anchor: ReturnType<typeof Y.createRelativePositionFromTypeIndex>;
    head: ReturnType<typeof Y.createRelativePositionFromTypeIndex>;
  };
};

export function agentUserId(userId: string): string {
  return userId.startsWith("agent:") ? userId : `agent:${userId}`;
}

/** y-codemirror / CollabCarets / PresenceBar が読む awareness。 */
export function agentAwarenessState(
  agent: AgentPresenceInput,
  yText: Y.Text,
  cursor: AgentCursor,
): AgentAwarenessState {
  const name = agentDisplayName(agent.displayName);
  const length = yText.length;
  const anchor = clampIndex(cursor.anchor, length);
  const head = clampIndex(cursor.head, length);
  return {
    userId: agentUserId(agent.userId),
    displayName: name,
    color: AGENT_COLOR,
    email: null,
    kind: "agent",
    user: {
      name,
      color: AGENT_COLOR,
      colorLight: `${AGENT_COLOR}40`,
    },
    cursor: {
      anchor: Y.createRelativePositionFromTypeIndex(yText, anchor),
      head: Y.createRelativePositionFromTypeIndex(yText, head),
    },
  };
}

function clampIndex(value: number, length: number): number {
  return Math.max(0, Math.min(value, length));
}
