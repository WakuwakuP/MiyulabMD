export type OgPreview = {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
};

const YOUTUBE_IMAGE = /!\[youtube]\((https?:\/\/[^)\s]+)\)/gi;
const OGP_LINK = /\[ogp]\((https?:\/\/[^)\s]+)\)/gi;
const YOUTUBE_BLOCK = /:::youtube\s*\{([^}]*)\}(?:\s*:::)?/g;
const OGP_BLOCK = /:::ogCard\s*\{([^}]*)\}(?:\s*:::)?/g;

export function attr(source: string, name: string): string | null {
  const match = new RegExp(`${name}="([^"]+)"`).exec(source);
  return match?.[1] ?? null;
}

export function youtubeId(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "youtu.be") {
      return parsed.pathname.replace(/^\//, "") || null;
    }
    if (parsed.hostname.endsWith("youtube.com") || parsed.hostname.endsWith("youtube-nocookie.com")) {
      return parsed.searchParams.get("v") || parsed.pathname.split("/").pop() || null;
    }
  } catch {
    return null;
  }
  return null;
}

export function youtubeEmbedUrl(url: string): string | null {
  const id = youtubeId(url);
  return id ? `https://www.youtube-nocookie.com/embed/${id}` : null;
}

export function normalizeEmbedMarkdown(markdown: string): string {
  return markdown
    .replace(YOUTUBE_IMAGE, (_all, url: string) => `:::youtube {src="${url}"}`)
    .replace(OGP_LINK, (_all, url: string) => `:::ogCard {href="${url}"}`);
}

export function canonicalizeEditorMarkdown(markdown: string): string {
  YOUTUBE_BLOCK.lastIndex = 0;
  OGP_BLOCK.lastIndex = 0;
  return normalizeEmbedMarkdown(markdown)
    .replace(YOUTUBE_BLOCK, (_all, attrs: string) => {
      const src = attr(attrs, "src") ?? "";
      return `:::youtube {src="${src}"} :::`;
    })
    .replace(OGP_BLOCK, (_all, attrs: string) => {
      const href = attr(attrs, "href") ?? "";
      return `:::ogCard {href="${href}"} :::`;
    });
}

export function collectOgUrls(markdown: string): string[] {
  const urls = new Set<string>();
  for (const match of markdown.matchAll(OGP_BLOCK)) {
    const href = attr(match[1] ?? "", "href");
    if (href) urls.add(href);
  }
  for (const match of markdown.matchAll(OGP_LINK)) {
    urls.add(match[1] ?? "");
  }
  return [...urls].filter(Boolean);
}

export function expandEmbedsForPreview(markdown: string, cards: Map<string, OgPreview>): string {
  const normalized = normalizeEmbedMarkdown(markdown);
  return normalized
    .replace(YOUTUBE_BLOCK, (_all, attrs: string) => {
      const src = attr(attrs, "src") ?? "";
      const embed = youtubeEmbedUrl(src);
      if (!embed) return "";
      return `<div class="embed-youtube"><iframe src="${embed}" title="YouTube" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen loading="lazy"></iframe></div>`;
    })
    .replace(OGP_BLOCK, (_all, attrs: string) => {
      const href = attr(attrs, "href") ?? "";
      const card = cards.get(href);
      const title = card?.title || href;
      const description = card?.description
        ? `<span class="embed-og-desc">${escapeHtml(card.description)}</span>`
        : "";
      const image = card?.image
        ? `<img src="${escapeHtml(card.image)}" alt="" />`
        : "";
      const site = card?.siteName ? `<small>${escapeHtml(card.siteName)}</small>` : "";
      return `<div class="embed-og-wrap"><a class="embed-og" href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${image}<span><strong>${escapeHtml(title)}</strong>${description}${site}</span></a></div>`;
    });
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
