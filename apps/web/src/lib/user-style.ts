const USER_COLORS = [
  "#2563eb",
  "#4f46e5",
  "#7c3aed",
  "#c026d3",
  "#db2777",
  "#e11d48",
  "#ea580c",
  "#d97706",
  "#16a34a",
  "#0d9488",
  "#0891b2",
  "#0284c7",
] as const;

export function colorForSeed(seed: string): string {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return USER_COLORS[Math.abs(hash) % USER_COLORS.length] ?? USER_COLORS[0];
}

export function colorForEmail(email: string | null | undefined, fallback = "guest"): string {
  return colorForSeed((email?.trim().toLowerCase() || fallback).trim());
}

export function initialFromName(label: string): string {
  const trimmed = label.trim();
  if (!trimmed) return "?";
  const first = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(trimmed)][0];
  return (first?.segment ?? trimmed[0] ?? "?").toUpperCase();
}
