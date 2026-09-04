export type MarkdownFrontmatterSplit = {
  raw: string | null;
  body: string;
  unclosed: boolean;
};

const FENCE = /^(?:---|\.\.\.)[ \t]*$/;

export function splitMarkdownFrontmatter(
  markdown: string,
): MarkdownFrontmatterSplit {
  const text = markdown.replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/);
  if ((lines[0] ?? "").trim() !== "---") {
    return { raw: null, body: markdown, unclosed: false };
  }

  for (let index = 1; index < lines.length; index += 1) {
    if (!FENCE.test(lines[index] ?? "")) continue;
    return {
      raw: lines.slice(1, index).join("\n"),
      body: lines.slice(index + 1).join("\n"),
      unclosed: false,
    };
  }

  return {
    raw: lines.slice(1).join("\n"),
    body: "",
    unclosed: true,
  };
}

/** 閉じた frontmatter があるときだけ本文。なければ元の markdown。 */
export function markdownBody(markdown: string): string {
  const split = splitMarkdownFrontmatter(markdown);
  if (split.raw !== null && !split.unclosed) return split.body;
  return markdown;
}

/** 閉じた YAML ブロックを保ったまま、本文だけ差し替える。 */
export function withClosedFrontmatter(source: string, body: string): string {
  const split = splitMarkdownFrontmatter(source);
  const next = body.replace(/^\uFEFF/, "");
  if (split.raw === null || split.unclosed) return next;
  return `---\n${split.raw}\n---\n\n${next.replace(/^\n+/, "")}`;
}
