type Props = {
  markdown: string;
};

export function MarkdownPreview({ markdown }: Props) {
  return <article>{markdown || "プレビュー（未実装）"}</article>;
}
