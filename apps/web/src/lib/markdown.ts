import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import { remark } from "remark";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import { fetchOgPreview } from "./api.ts";
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
  },
};

export async function renderMarkdown(markdown: string): Promise<string> {
  const normalized = normalizeEmbedMarkdown(markdown);
  const cards = new Map<string, OgPreview>();
  await Promise.all(
    collectOgUrls(normalized).map(async (url) => {
      const result = await fetchOgPreview(url);
      if (result.ok) cards.set(url, result.data);
    }),
  );
  const expanded = expandEmbedsForPreview(normalized, cards);
  const file = await remark()
    .use(remarkGfm)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypeSanitize, schema)
    .use(rehypeStringify)
    .process(expanded);
  return String(file);
}
