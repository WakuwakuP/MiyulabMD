const noteGenerations = new Map<string, number>();
const userClearGenerations = new Map<string, number>();
let nextGeneration = 1;

function generationKey(userId: string, noteId: string): string {
  return JSON.stringify([userId, noteId]);
}

export function currentNoteReadGeneration(
  userId: string,
  noteId: string,
): number {
  return (
    noteGenerations.get(generationKey(userId, noteId)) ??
    userClearGenerations.get(userId) ??
    0
  );
}

export function beginNoteReadOrder(userId: string, noteId: string): number {
  return currentNoteReadGeneration(userId, noteId);
}

export function enterNoteDenialOrder(userId: string, noteId: string): number {
  const key = generationKey(userId, noteId);
  const generation = nextGeneration++;
  noteGenerations.set(key, generation);
  return generation;
}

export function clearUserNoteReadOrder(userId: string): void {
  userClearGenerations.set(userId, nextGeneration++);
  for (const key of noteGenerations.keys()) {
    if (key.startsWith(`${JSON.stringify([userId]).slice(0, -1)},`)) {
      noteGenerations.delete(key);
    }
  }
}

export function isCurrentNoteReadOrder(
  userId: string,
  noteId: string,
  token: number,
): boolean {
  return currentNoteReadGeneration(userId, noteId) === token;
}
