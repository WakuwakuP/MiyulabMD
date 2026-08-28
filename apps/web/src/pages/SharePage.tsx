import { useParams } from "react-router";
import { MarkdownPreview } from "../components/editor/MarkdownPreview.tsx";

export function SharePage() {
  const { id } = useParams();

  return (
    <section>
      <h1>共有ノート {id}</h1>
      <MarkdownPreview markdown="" />
    </section>
  );
}
