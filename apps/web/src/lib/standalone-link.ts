const BARE_URL = /^(https?:\/\/[^\s<>]+)$/;
const MD_LINK = /^\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)$/;

export function standaloneLinkUrl(line: string): string | null {
  const trimmed = line.trim();
  const bare = BARE_URL.exec(trimmed);
  if (bare?.[1]) return bare[1];
  const md = MD_LINK.exec(trimmed);
  return md?.[2] ?? null;
}

export function mapLinesOutsideFences(
  markdown: string,
  mapLine: (line: string) => string,
): string {
  let inFence = false;
  return markdown
    .split("\n")
    .map((line) => {
      if (/^```/.test(line)) {
        inFence = !inFence;
        return line;
      }
      return inFence ? line : mapLine(line);
    })
    .join("\n");
}

export function collectStandaloneLinkUrls(markdown: string): string[] {
  const urls = new Set<string>();
  mapLinesOutsideFences(markdown, (line) => {
    const url = standaloneLinkUrl(line);
    if (url) urls.add(url);
    return line;
  });
  return [...urls];
}
