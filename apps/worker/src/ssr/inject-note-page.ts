import type { FolderCrumb, Note } from "@miyulabmd/shared";
import { folderUrl, MY_DRIVE_NAME, titleFromMarkdown } from "@miyulabmd/shared";

export function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Match client FolderBreadcrumbs so first paint does not jump when React mounts. */
export function ssrFolderCrumbsHtml(
  crumbs: readonly FolderCrumb[],
  showRootCrumb = false,
): string {
  if (!(showRootCrumb || crumbs.length > 0)) {
    return "";
  }
  const parts: string[] = [];
  if (showRootCrumb) {
    parts.push(`<a href="/">${escapeHtml(MY_DRIVE_NAME)}</a>`);
  }
  for (const [index, crumb] of crumbs.entries()) {
    if (showRootCrumb || index > 0) {
      parts.push('<span aria-hidden="true"> / </span>');
    }
    parts.push(
      `<a href="${escapeHtml(folderUrl(crumb.id))}">${escapeHtml(crumb.name)}</a>`,
    );
  }
  return `<nav aria-label="フォルダ" class="ssr-folder-crumbs">${parts.join("")}</nav>`;
}

export function injectNotePage(
  indexHtml: string,
  note: Note,
  previewHtml: string,
  ogCards: Record<string, unknown> = {},
  options: { showRootCrumb?: boolean } = {},
): string {
  const title = titleFromMarkdown(note.markdown) || note.title || "MiyulabMD";
  const crumbs = ssrFolderCrumbsHtml(
    note.crumbs ?? [],
    options.showRootCrumb === true,
  );
  const preview = `<div id="ssr-preview" data-note-id="${escapeHtml(note.id)}" data-short-id="${escapeHtml(note.shortId)}">${crumbs}<div class="document-view-shell"><article class="markdown-preview document-prose document-view-column">${previewHtml}</article></div></div>`;
  const bootstrap = `<script type="application/json" id="note-bootstrap">${jsonForScript(note)}</script>`;
  const ogBootstrap =
    Object.keys(ogCards).length > 0
      ? `<script type="application/json" id="og-bootstrap">${jsonForScript(ogCards)}</script>`
      : "";

  const html = indexHtml.replace(
    /<title>[^<]*<\/title>/,
    `<title>${escapeHtml(title)} · MiyulabMD</title>`,
  );
  if (!html.includes("</body>")) {
    return `${html}${preview}${bootstrap}${ogBootstrap}`;
  }
  return html.replace("</body>", `${preview}${bootstrap}${ogBootstrap}</body>`);
}

export function notePageId(pathname: string): string | null {
  const match = /^\/(?:n|s)\/([^/]+)\/?$/.exec(pathname);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

export function isPublicGuestCacheable(note: Note, hasUser: boolean): boolean {
  return (
    !hasUser &&
    (note.access.effectiveReadScope === "public" ||
      note.access.effectiveReadScope === "link")
  );
}
