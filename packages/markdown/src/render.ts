import rehypeHighlight from "rehype-highlight";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeSlug from "rehype-slug";
import rehypeStringify from "rehype-stringify";
import { remark } from "remark";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import {
  rehypeCodeFilename,
  rehypeCodeFilenameWrap,
  remarkFenceInfo,
} from "./code-filename.ts";
import {
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
    pre: ["className"],
    code: ["className", "dataFilename"],
    h1: ["id"],
    h2: ["id"],
    h3: ["id"],
  },
};

const processor = remark()
  .use(remarkGfm)
  .use(remarkFenceInfo)
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(rehypeRaw)
  .use(rehypeCodeFilename)
  .use(rehypeHighlight)
  .use(rehypeCodeFilenameWrap)
  .use(rehypeSlug)
  .use(rehypeSanitize, schema)
  .use(rehypeStringify);

/** Sync HTML for View / Worker SSR. Does not fetch OGP. */
export function renderMarkdownHtml(
  markdown: string,
  cards: Map<string, OgPreview> = new Map(),
): string {
  const expanded = expandEmbedsForPreview(
    normalizeEmbedMarkdown(markdown),
    cards,
  );
  return String(processor.processSync(expanded));
}
