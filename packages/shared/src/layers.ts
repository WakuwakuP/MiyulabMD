/**
 * Medallion layers: every note carries a quality layer
 * (bronze → silver → gold). Gold is a policy lock — edits are rejected
 * at the API/MCP boundary while `gold_unlocked_until` is not in the
 * future. Layers are orthogonal to PARA folders (quality vs. actionability).
 */

export const NOTE_LAYERS = ["bronze", "silver", "gold"] as const;
export type NoteLayer = (typeof NOTE_LAYERS)[number];

export function isNoteLayer(value: string): value is NoteLayer {
  return (NOTE_LAYERS as readonly string[]).includes(value);
}

export const NOTE_LAYER_LABELS: Record<NoteLayer, string> = {
  bronze: "Bronze（Inbox）",
  gold: "Gold（Canonical）",
  silver: "Silver（Refined）",
};

export const LAYER_RANK: Record<NoteLayer, number> = {
  bronze: 0,
  gold: 2,
  silver: 1,
};

/** 昇格は1段階ずつ。 */
export function nextLayer(layer: NoteLayer): NoteLayer | null {
  const rank = LAYER_RANK[layer];
  return NOTE_LAYERS[rank + 1] ?? null;
}

// --- gold lock --------------------------------------------------------------

/** Default unlock window for `unlock_gold_for_edit` (30 min). */
export const GOLD_UNLOCK_DEFAULT_MINUTES = 30;
/** Cap on unlock windows (24 h) so gold cannot be left open indefinitely. */
export const GOLD_UNLOCK_MAX_MINUTES = 24 * 60;

export function isGoldLockedAt(
  layer: string | null | undefined,
  goldUnlockedUntil: number | null | undefined,
  now: number = Date.now(),
): boolean {
  if (layer !== "gold") {
    return false;
  }
  return goldUnlockedUntil == null || goldUnlockedUntil <= now;
}

// --- promote gates ----------------------------------------------------------

export const PROMOTE_GATE_CODES = [
  "broken_links",
  "empty_body",
  "missing_title",
  "needs_confirm",
  "no_headings",
  "no_links",
] as const;
export type PromoteGateCode = (typeof PROMOTE_GATE_CODES)[number];

export type PromoteGateFailure = {
  code: PromoteGateCode;
  message: string;
};

export type NoteLayerEvent = {
  id: string;
  noteId: string;
  fromLayer: NoteLayer | null;
  toLayer: NoteLayer;
  actorUserId: string | null;
  actorName: string;
  reason: string | null;
  createdAt: number;
};
