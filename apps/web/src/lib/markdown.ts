import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeSlug from "rehype-slug";
import rehypeStringify from "rehype-stringify";
import { remark } from "remark";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import { fetchOgPreview, peekOgPreview } from "./api.ts";
import {
  collectOgUrls,
  expandEmbedsForPreview,
  normalizeEmbedMarkdown,
  type OgPreview,
} from "./embeds.ts";

const TABLE_TAGS = [
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "colgroup",
  "col",
] as const;

const schema = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames ?? []),
    "iframe",
    "small",
    ...TABLE_TAGS,
  ],
  attributes: {
    ...defaultSchema.attributes,
    iframe: [
      "src",
      "title",
      "allow",
      "allowFullScreen",
      "loading",
      "width",
      "height",
    ],
    div: ["className"],
    a: ["href", "target", "rel", "className"],
    img: ["src", "alt"],
    span: ["className"],
    h1: ["id"],
    h2: ["id"],
    h3: ["id"],
  },
};

const processor = remark()
  .use(remarkGfm)
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(rehypeRaw)
  .use(rehypeSlug)
  .use(rehypeSanitize, schema)
  .use(rehypeStringify);

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
  const expanded = expandEmbedsForPreview(
    normalizeEmbedMarkdown(markdown),
    cards,
  );
  return String(processor.processSync(expanded));
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
