import { NoteList } from "../components/notes/NoteList.tsx";

export function HomePage() {
  return (
    <section>
      <h1>ノート</h1>
      <NoteList notes={[]} />
    </section>
  );
}
