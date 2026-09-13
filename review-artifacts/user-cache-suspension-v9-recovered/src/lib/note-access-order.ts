const noteGenerations = new Map<string, number>();

function generationKey(userId: string, noteId: string): string {
  return JSON.stringify([userId, noteId]);
}

export function currentNoteReadGeneration(
  userId: string,
  noteId: string,
): number {
  return noteGenerations.get(generationKey(userId, noteId)) ?? 0;
}

export function beginNoteReadOrder(userId: string, noteId: string): number {
  return currentNoteReadGeneration(userId, noteId);
}

export function enterNoteDenialOrder(userId: string, noteId: string): number {
  const key = generationKey(userId, noteId);
  const generation = currentNoteReadGeneration(userId, noteId) + 1;
  noteGenerations.set(key, generation);
  return generation;
}

export function isCurrentNoteReadOrder(
  userId: string,
  noteId: string,
  token: number,
): boolean {
  return currentNoteReadGeneration(userId, noteId) === token;
}
