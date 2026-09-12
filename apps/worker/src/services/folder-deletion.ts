import { folderContains } from "@miyulabmd/shared";

export type NoteFolderTarget = {
  id: string;
  shortId: string;
  folder: string;
};

export type FolderTarget = {
  id: string;
  folder: string;
};

export function listNotesInFolderSubtree(
  notes: NoteFolderTarget[],
  rootFolder: string,
): NoteFolderTarget[] {
  return notes.filter((row) => folderContains(rootFolder, row.folder ?? ""));
}

export function listFoldersInSubtree(
  folders: FolderTarget[],
  rootFolder: string,
): FolderTarget[] {
  return folders.filter((row) => folderContains(rootFolder, row.folder));
}

export function noteEvictionIds(
  note: Pick<NoteFolderTarget, "id" | "shortId">,
): string[] {
  const ids = [note.id];
  if (note.shortId && note.shortId !== note.id) {
    ids.push(note.shortId);
  }
  return ids;
}

export function collectNoteEvictionIds(notes: NoteFolderTarget[]): string[] {
  return notes.flatMap((note) => noteEvictionIds(note));
}

export function collectFolderIds(folders: FolderTarget[]): string[] {
  return folders.map((folder) => folder.id);
}
