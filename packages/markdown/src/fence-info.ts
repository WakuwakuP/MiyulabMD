export type FenceInfo = {
  language: string;
  filename: string;
};

const LANGUAGE_ALIASES: Record<string, string> = {
  cjs: "javascript",
  dockerfile: "dockerfile",
  htm: "xml",
  html: "xml",
  js: "javascript",
  jsx: "javascript",
  kt: "kotlin",
  md: "markdown",
  mjs: "javascript",
  py: "python",
  rb: "ruby",
  rs: "rust",
  sh: "bash",
  shell: "bash",
  ts: "typescript",
  tsx: "typescript",
  yml: "yaml",
};

const KNOWN_LANGUAGES = new Set([
  "bash",
  "c",
  "cpp",
  "csharp",
  "css",
  "diff",
  "dockerfile",
  "go",
  "graphql",
  "ini",
  "java",
  "javascript",
  "json",
  "kotlin",
  "less",
  "lua",
  "makefile",
  "markdown",
  "objectivec",
  "perl",
  "php",
  "plaintext",
  "python",
  "r",
  "ruby",
  "rust",
  "scss",
  "sql",
  "swift",
  "typescript",
  "vbnet",
  "xml",
  "yaml",
  ...Object.keys(LANGUAGE_ALIASES),
]);

const EXTENSION_LANGUAGES: Record<string, string> = {
  ...LANGUAGE_ALIASES,
  bash: "bash",
  c: "c",
  cc: "cpp",
  cpp: "cpp",
  cs: "csharp",
  css: "css",
  cxx: "cpp",
  diff: "diff",
  go: "go",
  graphql: "graphql",
  h: "c",
  hpp: "cpp",
  ini: "ini",
  java: "java",
  json: "json",
  less: "less",
  lua: "lua",
  markdown: "markdown",
  php: "php",
  py: "python",
  r: "r",
  rb: "ruby",
  rs: "rust",
  scss: "scss",
  sql: "sql",
  swift: "swift",
  toml: "ini",
  yaml: "yaml",
  yml: "yaml",
};

function looksLikeFilename(value: string): boolean {
  if (!value.includes(".") || value.endsWith(".")) return false;
  return !/\s/.test(value);
}

export function resolveLanguage(value: string): string {
  const key = value.trim().toLowerCase();
  if (!key) return "";
  return LANGUAGE_ALIASES[key] ?? key;
}

export function isKnownLanguage(value: string): boolean {
  return KNOWN_LANGUAGES.has(value.trim().toLowerCase());
}

export function inferLanguageFromFilename(filename: string): string {
  const base = filename.trim().split(/[/\\]/).pop() ?? "";
  if (/^dockerfile$/i.test(base)) return "dockerfile";
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return "";
  return EXTENSION_LANGUAGES[base.slice(dot + 1).toLowerCase()] ?? "";
}

export function parseFenceInfo(info: string): FenceInfo {
  const trimmed = info.trim();
  if (!trimmed) return { language: "", filename: "" };

  const colon = trimmed.indexOf(":");
  if (colon >= 0) {
    return {
      language: trimmed.slice(0, colon).trim(),
      filename: trimmed.slice(colon + 1).trim(),
    };
  }

  if (!isKnownLanguage(trimmed) && looksLikeFilename(trimmed)) {
    return { language: "", filename: trimmed };
  }

  return { language: trimmed, filename: "" };
}

export function highlightLanguage(info: FenceInfo): string {
  if (info.language && isKnownLanguage(info.language)) {
    return resolveLanguage(info.language);
  }
  const inferred = inferLanguageFromFilename(info.filename || info.language);
  if (inferred) return inferred;
  return resolveLanguage(info.language);
}

export function serializeFenceInfo(info: FenceInfo): string {
  const language = info.language.trim();
  const filename = info.filename.trim();
  if (language && filename) return `${language}:${filename}`;
  return filename || language;
}
