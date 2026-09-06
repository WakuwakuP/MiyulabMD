import type { NoteSummary } from "@miyulabmd/shared";
import { DriveList, DriveRow } from "../ui/DriveList.tsx";
import { MarkdownIcon } from "../ui/icons.tsx";

type Props = {
  notes: NoteSummary[];
};

export function NoteList({ notes }: Props) {
  if (notes.length === 0) {
    return <p>ノートはまだありません。</p>;
  }

  return (
    <DriveList>
      {notes.map((note) => (
        <DriveRow
          href={`/n/${note.id}`}
          icon={<MarkdownIcon />}
          key={note.id}
          menuOpen={false}
          name={note.title}
          onMenu={(event) => event.preventDefault()}
        />
      ))}
    </DriveList>
  );
}
