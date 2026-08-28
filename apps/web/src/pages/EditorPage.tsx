import { useParams } from "react-router";
import { MarkdownEditor } from "../components/editor/MarkdownEditor.tsx";
import { MarkdownPreview } from "../components/editor/MarkdownPreview.tsx";
import { PresenceBar } from "../components/editor/PresenceBar.tsx";
import { PermissionPicker } from "../components/notes/PermissionPicker.tsx";

export function EditorPage() {
  const { id = "" } = useParams();

  return (
    <section>
      <header>
        <h1>編集</h1>
        <PermissionPicker value="editable" disabled />
        <PresenceBar />
      </header>
      <MarkdownEditor noteId={id} />
      <MarkdownPreview markdown="" />
    </section>
  );
}
