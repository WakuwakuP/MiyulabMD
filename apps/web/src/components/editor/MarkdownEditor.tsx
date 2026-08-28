type Props = {
  noteId: string;
};

export function MarkdownEditor({ noteId }: Props) {
  return <textarea readOnly placeholder={`ノート ${noteId} のエディタ（未実装）`} />;
}
