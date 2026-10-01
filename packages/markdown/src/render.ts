import { markdownBody } from "@miyulabmd/shared";
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
import { rehypeDiagrams } from "./diagrams.ts";
import {
  expandEmbedsForPreview,
  isAllowedYoutubeEmbedSrc,
  normalizeEmbedMarkdown,
  type OgPreview,
  YOUTUBE_EMBED_ALLOW,
} from "./embeds.ts";
import {
  rehypeTaskCheckboxes,
  remarkTaskCheckboxes,
} from "./task-list-render.ts";
import { remarkWikiLinks, type WikiLinkMap } from "./wikilinks.ts";

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
  attributes: {
    ...defaultSchema.attributes,
    a: ["href", "target", "rel", "className"],
    code: ["className", "dataFilename"],
    div: ["className", "dataDiagramLang"],
    h1: ["id"],
    h2: ["id"],
    h3: ["id"],
    iframe: [
      "src",
      "title",
      "allow",
      "allowFullScreen",
      "loading",
      "width",
      "height",
    ],
    img: ["src", "alt"],
    pre: ["className"],
    span: ["className"],
  },
  tagNames: [
    ...(defaultSchema.tagNames ?? []),
    "iframe",
    "small",
    ...TABLE_TAGS,
  ],
};

type HastNode = {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

function youtubeIframeProperties(
  properties: Record<string, unknown>,
): Record<string, unknown> | null {
  const src = properties.src;
  if (typeof src !== "string" || !isAllowedYoutubeEmbedSrc(src)) {
    return null;
  }
  const next: Record<string, unknown> = {
    allow: YOUTUBE_EMBED_ALLOW,
    loading: "lazy",
    src,
    title: typeof properties.title === "string" ? properties.title : "YouTube",
  };
  if (
    properties.allowFullScreen === true ||
    properties.allowfullscreen === true
  ) {
    next.allowFullScreen = true;
  }
  if (
    typeof properties.width === "string" ||
    typeof properties.width === "number"
  ) {
    next.width = properties.width;
  }
  if (
    typeof properties.height === "string" ||
    typeof properties.height === "number"
  ) {
    next.height = properties.height;
  }
  return next;
}

/** Drop author iframes; keep only the YouTube embed this renderer emits. */
function rehypeSafeIframes() {
  return (tree: HastNode) => {
    function visit(node: HastNode) {
      if (!node.children) {
        return;
      }
      node.children = node.children.flatMap((child) => {
        if (child.tagName === "iframe") {
          const properties = youtubeIframeProperties(child.properties ?? {});
          if (!properties) {
            return [];
          }
          child.properties = properties;
          child.children = [];
          return [child];
        }
        visit(child);
        return [child];
      });
    }
    visit(tree);
  };
}

function createProcessor(render: boolean) {
  const configured = remark()
    .use(remarkGfm)
    .use(remarkFenceInfo)
    .use(remarkTaskCheckboxes)
    .use(remarkWikiLinks)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw);

  if (render) {
    configured
      .use(rehypeCodeFilename)
      .use(rehypeDiagrams)
      .use(rehypeHighlight)
      .use(rehypeCodeFilenameWrap)
      .use(rehypeSlug);
  }

  configured
    .use(rehypeSanitize, schema)
    .use(rehypeSafeIframes)
    .use(rehypeTaskCheckboxes);
  if (render) {
    configured.use(rehypeStringify);
  }
  return configured;
}

const processor = createProcessor(true);
const imageProcessor = createProcessor(false);

function collectImageNodes(node: unknown, urls: Set<string>): void {
  if (!node || typeof node !== "object") {
    return;
  }
  const record = node as Record<string, unknown>;
  if (record.type === "element" && record.tagName === "img") {
    const properties = record.properties;
    if (properties && typeof properties === "object") {
      const src = (properties as Record<string, unknown>).src;
      if (typeof src === "string" && src) {
        urls.add(src);
      }
    }
  }
  if (Array.isArray(record.children)) {
    for (const child of record.children) {
      collectImageNodes(child, urls);
    }
  }
}

/** Collect image destinations using the same Markdown and sanitization rules as rendering. */
export function collectImageUrls(markdown: string): string[] {
  const normalized = normalizeEmbedMarkdown(markdownBody(markdown));
  const tree = imageProcessor.runSync(imageProcessor.parse(normalized));
  const urls = new Set<string>();
  collectImageNodes(tree, urls);
  return [...urls];
}

/** Sync HTML for View / Worker SSR. Does not fetch OGP. */
export function renderMarkdownHtml(
  markdown: string,
  cards: Map<string, OgPreview> = new Map(),
  wikiLinks?: WikiLinkMap,
): string {
  const expanded = expandEmbedsForPreview(
    normalizeEmbedMarkdown(markdownBody(markdown)),
    cards,
  );
  return String(
    processor.processSync({
      data: { taskSource: markdown, wikiLinks },
      value: expanded,
    }),
  );
}
