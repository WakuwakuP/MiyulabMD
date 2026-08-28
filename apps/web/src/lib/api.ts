import type { Note, NoteSummary, SessionUser } from "@miyulabmd/shared";

export async function fetchMe(): Promise<SessionUser | null> {
  const res = await fetch("/api/me");
  if (!res.ok) return null;
  const body = (await res.json()) as { user: SessionUser | null };
  return body.user;
}

export async function fetchNotes(): Promise<NoteSummary[]> {
  const res = await fetch("/api/notes");
  if (!res.ok) return [];
  const body = (await res.json()) as { notes: NoteSummary[] };
  return body.notes;
}

export async function fetchNote(id: string): Promise<Note | null> {
  const res = await fetch(`/api/notes/${id}`);
  if (!res.ok) return null;
  return (await res.json()) as Note;
}
