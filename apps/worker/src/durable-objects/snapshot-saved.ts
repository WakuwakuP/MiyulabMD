import { encodeSnapshotSaved } from "@miyulabmd/shared";

/** A save hint is best-effort, and strictly follows the D1 writer's success. */
export async function writeSnapshotAndNotify(
  write: () => Promise<void>,
  noteId: string,
  subscribers: () => Iterable<{ send(frame: Uint8Array): void }>,
): Promise<void> {
  await write();
  const payload = encodeSnapshotSaved(noteId);
  for (const socket of subscribers()) {
    try {
      socket.send(payload);
    } catch {
      // Disconnection cannot turn successful persistence into a write retry.
    }
  }
}
