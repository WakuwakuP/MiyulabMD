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
          key={note.id}
          href={`/n/${note.id}`}
          name={note.title}
          icon={<MarkdownIcon />}
          menuOpen={false}
          onMenu={(event) => event.preventDefault()}
        />
      ))}
    </DriveList>
  );
}
