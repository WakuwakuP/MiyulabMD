import type { NoteSummary } from "@miyulabmd/shared";
import { Link } from "react-router";

type Props = {
  notes: NoteSummary[];
};

export function NoteList({ notes }: Props) {
  if (notes.length === 0) {
    return <p>ノートはまだありません。</p>;
  }

  return (
    <ul>
      {notes.map((note) => (
        <li key={note.id}>
          <Link to={`/n/${note.id}`}>{note.title}</Link>
        </li>
      ))}
    </ul>
  );
}
