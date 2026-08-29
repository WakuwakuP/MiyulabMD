import {
  collectOgUrls,
  normalizeEmbedMarkdown,
  type OgPreview,
  renderMarkdownHtml as renderMarkdownHtmlBase,
} from "@miyulabmd/markdown";
import { fetchOgPreview, peekOgPreview } from "./api.ts";

function ogUrls(markdown: string): string[] {
  return collectOgUrls(normalizeEmbedMarkdown(markdown));
}

export function peekOgCards(markdown: string): Map<string, OgPreview> {
  const cards = new Map<string, OgPreview>();
  for (const url of ogUrls(markdown)) {
    const card = peekOgPreview(url);
    if (card) cards.set(url, card);
  }
  return cards;
}

export function renderMarkdownHtml(
  markdown: string,
  cards: Map<string, OgPreview> = peekOgCards(markdown),
): string {
  return renderMarkdownHtmlBase(markdown, cards);
}

export async function loadOgCards(
  markdown: string,
): Promise<Map<string, OgPreview>> {
  const cards = new Map<string, OgPreview>();
  await Promise.all(
    ogUrls(markdown).map(async (url) => {
      const result = await fetchOgPreview(url);
      if (result.ok) cards.set(url, result.data);
    }),
  );
  return cards;
}

export async function renderMarkdown(markdown: string): Promise<string> {
  return renderMarkdownHtml(markdown, await loadOgCards(markdown));
}
