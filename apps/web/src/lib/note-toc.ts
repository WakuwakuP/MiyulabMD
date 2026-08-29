import GithubSlugger from "github-slugger";

/** Matches rehype-sanitize default `clobberPrefix`. */
export const TOC_ID_PREFIX = "user-content-";

export type TocEntry = {
  level: 1 | 2 | 3;
  text: string;
  id: string;
};

function stripInlineMarkdown(text: string): string {
  return text
    .replace(/!\[[^\]]*]\([^)]+\)/g, "")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    .trim();
}

export function extractNoteToc(markdown: string): TocEntry[] {
  const slugger = new GithubSlugger();
  const entries: TocEntry[] = [];
  let inFence = false;

  for (const line of markdown.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const match = /^(#{1,3})\s+(.+?)\s*(?:#+\s*)?$/.exec(trimmed);
    if (!match?.[1] || !match[2]) continue;

    const level = match[1].length as 1 | 2 | 3;
    const text = stripInlineMarkdown(match[2]);
    if (!text) continue;

    entries.push({
      level,
      text,
      id: `${TOC_ID_PREFIX}${slugger.slug(text)}`,
    });
  }

  return entries;
}

/** Room for a sticky TOC beside the capped preview card without overlapping it. */
export function shouldShowPreviewToc(
  viewportWidth: number,
  options?: {
    minViewportPx?: number;
    tocWidthRem?: number;
    cardMaxRem?: number;
  },
): boolean {
  const minViewportPx = options?.minViewportPx ?? 1200;
  const tocWidthRem = options?.tocWidthRem ?? 12;
  const cardMaxRem = options?.cardMaxRem ?? 46;
  const horizontalPaddingPx = 32;
  const gapPx = 32;
  const cardMaxPx = cardMaxRem * 16;
  const cardWidthPx = Math.min(viewportWidth - horizontalPaddingPx, cardMaxPx);
  const atCap = cardWidthPx >= cardMaxPx - 1;

  if (!atCap || viewportWidth < minViewportPx) {
    return false;
  }

  const groupWidthPx =
    cardWidthPx + gapPx + tocWidthRem * 16 + horizontalPaddingPx;
  return viewportWidth >= groupWidthPx;
}
