import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
  type ArticleMeta,
  type ArticleSchemaField,
  coerceArticleValue,
} from "./article.ts";
import { splitMarkdownFrontmatter } from "./markdown-frontmatter.ts";

export type ArticleFrontmatterIssue = {
  key?: string;
  message: string;
};

export type ArticleFrontmatterRead = {
  data: ArticleMeta;
  body: string;
  issues: ArticleFrontmatterIssue[];
};

export {
  markdownBody,
  splitMarkdownFrontmatter,
} from "./markdown-frontmatter.ts";
export type { MarkdownFrontmatterSplit } from "./markdown-frontmatter.ts";

function normalizeYamlValue(value: unknown): unknown {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? undefined
      : value.toISOString().slice(0, 10);
  }
  if (Array.isArray(value)) return value.map(normalizeYamlValue);
  if (value && typeof value === "object") {
    const next: ArticleMeta = {};
    for (const [key, entry] of Object.entries(value)) {
      next[key] = normalizeYamlValue(entry);
    }
    return next;
  }
  return value;
}

export function parseFrontmatterYaml(
  raw: string,
): { ok: true; data: ArticleMeta } | { ok: false; error: string } {
  if (!raw.trim()) return { ok: true, data: {} };
  try {
    const parsed: unknown = parseYaml(raw);
    if (parsed == null) return { ok: true, data: {} };
    const normalized = normalizeYamlValue(parsed);
    if (
      !normalized ||
      typeof normalized !== "object" ||
      Array.isArray(normalized)
    ) {
      return {
        ok: false,
        error: "frontmatter はオブジェクトである必要があります",
      };
    }
    return { ok: true, data: normalized as ArticleMeta };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `YAML が不正です: ${message}` };
  }
}

export function readArticleFrontmatter(
  markdown: string,
): ArticleFrontmatterRead {
  const split = splitMarkdownFrontmatter(markdown);
  if (split.raw === null) {
    return { data: {}, body: markdown, issues: [] };
  }
  if (split.unclosed) {
    return {
      data: {},
      body: markdown,
      issues: [{ message: "frontmatter の閉じの --- がありません" }],
    };
  }
  const parsed = parseFrontmatterYaml(split.raw);
  if (!parsed.ok) {
    return { data: {}, body: split.body, issues: [{ message: parsed.error }] };
  }
  return { data: parsed.data, body: split.body, issues: [] };
}

export function validateArticleDocument(
  schema: ArticleSchemaField[],
  markdown: string,
): ArticleFrontmatterRead {
  const split = splitMarkdownFrontmatter(markdown);
  if (split.raw === null) {
    return {
      data: {},
      body: markdown,
      issues: [{ message: "ノート先頭に YAML frontmatter（---）が必要です" }],
    };
  }
  const read = readArticleFrontmatter(markdown);
  if (read.issues.length > 0) return read;

  const issues: ArticleFrontmatterIssue[] = [];
  for (const field of schema) {
    const raw = read.data[field.key];
    if (raw === undefined) {
      if (field.required && field.default === undefined && !field.fixed) {
        issues.push({
          key: field.key,
          message: `${field.key} は必須です`,
        });
      }
      continue;
    }
    const coerced = coerceArticleValue(field.type, raw, field.enum);
    if (coerced === undefined) {
      issues.push({
        key: field.key,
        message: `${field.key} の型が不正です（${field.type}）`,
      });
      continue;
    }
    if (
      field.fixed &&
      field.default !== undefined &&
      coerced !== field.default
    ) {
      issues.push({
        key: field.key,
        message: `${field.key} は ${String(field.default)} で固定です`,
      });
    }
  }

  return { data: read.data, body: read.body, issues };
}

function templateValue(field: ArticleSchemaField, title: string): unknown {
  if (field.default !== undefined) return field.default;
  if (field.key === "title") return title;
  if (field.enum && field.enum.length > 0) return field.enum[0];
  switch (field.type) {
    case "boolean":
      return false;
    case "string[]":
      return [];
    case "date":
      return new Date().toISOString().slice(0, 10);
    case "number":
      return undefined;
    default:
      return "";
  }
}

export function articleFrontmatterObject(
  schema: ArticleSchemaField[],
  title = "無題",
): ArticleMeta {
  const meta: ArticleMeta = {};
  for (const field of schema) {
    const value = templateValue(field, title);
    if (value !== undefined) meta[field.key] = value;
  }
  if (typeof meta.title !== "string" || !meta.title.trim()) {
    meta.title = title;
  }
  return meta;
}

export function stringifyArticleFrontmatter(meta: ArticleMeta): string {
  return stringifyYaml(meta, { lineWidth: 0 }).trimEnd();
}

export function articleTemplateMarkdown(
  schema: ArticleSchemaField[],
  title = "無題",
): string {
  const yaml = stringifyArticleFrontmatter(
    articleFrontmatterObject(schema, title),
  );
  return `---\n${yaml}\n---\n\n# ${title}\n`;
}

export function ensureArticleMarkdown(
  markdown: string,
  schema: ArticleSchemaField[],
  title = "無題",
): string {
  const split = splitMarkdownFrontmatter(markdown);
  if (split.raw !== null && !split.unclosed) return markdown;
  const yaml = stringifyArticleFrontmatter(
    articleFrontmatterObject(schema, title),
  );
  const body = markdown.replace(/^\uFEFF/, "").replace(/^\n+/, "");
  return `---\n${yaml}\n---\n\n${body}`;
}
