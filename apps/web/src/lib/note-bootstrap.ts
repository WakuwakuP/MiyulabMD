import type { Note } from "@miyulabmd/shared";
import { seedOgPreviews } from "./api.ts";
import type { OgPreview } from "./embeds.ts";

const BOOTSTRAP_ID = "note-bootstrap";
const OG_BOOTSTRAP_ID = "og-bootstrap";
const SSR_PREVIEW_ID = "ssr-preview";

function matchesNoteId(
  note: Pick<Note, "id" | "shortId">,
  id: string,
): boolean {
  return note.id === id || note.shortId === id;
}

export function consumeOgBootstrap(): void {
  const el = document.getElementById(OG_BOOTSTRAP_ID);
  if (!el?.textContent) return;
  try {
    const cards = JSON.parse(el.textContent) as Record<string, OgPreview>;
    seedOgPreviews(cards);
  } catch {
    // ignore malformed bootstrap
  }
}

export function readNoteBootstrap(id: string): Note | null {
  consumeOgBootstrap();
  const el = document.getElementById(BOOTSTRAP_ID);
  if (!el?.textContent) return null;
  try {
    const note = JSON.parse(el.textContent) as Note;
    if (!note?.id || !matchesNoteId(note, id)) return null;
    return note;
  } catch {
    return null;
  }
}

export function dismissStaleSsrPreview(id: string): void {
  const el = document.getElementById(SSR_PREVIEW_ID);
  if (!el) return;
  const noteId = el.getAttribute("data-note-id");
  const shortId = el.getAttribute("data-short-id");
  if (noteId !== id && shortId !== id) {
    el.remove();
  }
}

export function removeSsrPreview(): void {
  document.getElementById(SSR_PREVIEW_ID)?.remove();
}
