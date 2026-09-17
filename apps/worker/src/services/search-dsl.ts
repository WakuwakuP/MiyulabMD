import {
  isNoteLayer,
  layerFilterValue,
  type NoteLayer,
  paraFilterValue,
  pathFilterMatches,
  type SearchQuery,
  schemeFilterValue,
  tagFilterValue,
} from "@miyulabmd/shared";
import { db } from "../db/client.ts";

/**
 * Worker-side resolution of parsed DSL operators into row-matchable filters.
 * `scheme:`/`jd:`/`para:` resolve to folder-path prefixes under the caller's
 * own drive (a user's scheme metadata is private — non-owner lookups fail
 * closed to "no match").
 */

export type LayerFilter = { value: NoteLayer; negated: boolean };
export type TagFilter = { value: string; negated: boolean };
export type FolderPrefixFilter = { value: string; negated: boolean };
/**
 * OR-ed set of folder prefixes (e.g. `para:projects` across every space).
 * Positive filters need one matching prefix; negated ones need none to match.
 */
export type FolderPrefixSetFilter = { values: string[]; negated: boolean };

export type ResolvedSearchDsl = {
  parsed: SearchQuery;
  folderPrefixes: FolderPrefixFilter[];
  folderPrefixSets: FolderPrefixSetFilter[];
  layers: LayerFilter[];
  tags: TagFilter[];
  /** A non-negated filter resolved to nothing — the result set is empty. */
  empty: boolean;
};

async function folderPathForSchemeId(
  env: Env,
  ownerId: string,
  schemeId: string,
): Promise<string | null> {
  const row = await db(env)
    .prepare("SELECT folder FROM folders WHERE owner_id = ? AND scheme_id = ?")
    .bind(ownerId, schemeId)
    .first<{ folder: string }>();
  return row?.folder ?? null;
}

/**
 * `para:projects` → every space's Projects path; `para:work.projects` → the
 * bucket inside that space only. The default space resolves via its materialized
 * rootless row (`para_space_id IS NULL` on its bucket folders).
 */
async function folderPathsForParaBucket(
  env: Env,
  ownerId: string,
  bucket: string,
  spaceName?: string,
): Promise<string[]> {
  if (spaceName === undefined) {
    const rows = await db(env)
      .prepare(
        "SELECT folder FROM folders WHERE owner_id = ? AND para_bucket = ?",
      )
      .bind(ownerId, bucket)
      .all<{ folder: string }>();
    return (rows.results ?? []).map((row) => row.folder);
  }
  const space = await db(env)
    .prepare(
      "SELECT id, root_folder_id FROM para_spaces WHERE owner_id = ? AND name = ?",
    )
    .bind(ownerId, spaceName)
    .first<{ id: string; root_folder_id: string | null }>();
  if (!space) {
    return [];
  }
  const rows =
    space.root_folder_id === null
      ? await db(env)
          .prepare(
            "SELECT folder FROM folders WHERE owner_id = ? AND para_bucket = ? AND para_space_id IS NULL",
          )
          .bind(ownerId, bucket)
          .all<{ folder: string }>()
      : await db(env)
          .prepare(
            "SELECT folder FROM folders WHERE owner_id = ? AND para_bucket = ? AND para_space_id = ?",
          )
          .bind(ownerId, bucket, space.id)
          .all<{ folder: string }>();
  return (rows.results ?? []).map((row) => row.folder);
}

type ResolvedFilter =
  | { kind: "folder"; value: string }
  | { kind: "folder-set"; values: string[] }
  | { kind: "layer"; value: NoteLayer }
  | { kind: "tag"; value: string }
  | "drop"
  | "empty";

/** scheme:/jd: resolve to a folder path; para: to a per-space path set. */
async function folderPathForFilter(
  env: Env,
  user: { id: string } | undefined,
  filter: { kind: string; value: string },
): Promise<ResolvedFilter | null> {
  if (!user) {
    return null;
  }
  if (filter.kind === "para") {
    const parsed = paraFilterValue(filter.value);
    if (!parsed) {
      return null;
    }
    const paths = await folderPathsForParaBucket(
      env,
      user.id,
      parsed.bucket,
      parsed.space,
    );
    return paths.length > 0 ? { kind: "folder-set", values: paths } : null;
  }
  const schemeId = schemeFilterValue(filter.value);
  const path = schemeId
    ? await folderPathForSchemeId(env, user.id, schemeId)
    : null;
  return path === null ? null : { kind: "folder", value: path };
}

/**
 * Resolve one DSL filter. `"drop"` means the filter cannot apply (negated or
 * unknown); `"empty"` means a non-negated filter resolved to nothing, making
 * the whole result set empty.
 */
async function resolveFilter(
  env: Env,
  user: { id: string } | undefined,
  filter: { kind: string; value: string; negated: boolean },
): Promise<ResolvedFilter> {
  const miss = filter.negated ? "drop" : ("empty" as const);
  switch (filter.kind) {
    case "path":
      return { kind: "folder", value: filter.value };
    case "tag":
      return {
        kind: "tag",
        value: tagFilterValue(filter.value).toLowerCase(),
      };
    case "layer": {
      const layer = layerFilterValue(filter.value);
      return layer ? { kind: "layer", value: layer } : miss;
    }
    case "scheme":
    case "jd":
    case "para": {
      const resolved = await folderPathForFilter(env, user, filter);
      return resolved === null ? miss : resolved;
    }
    default:
      return "drop";
  }
}

export async function resolveSearchDsl(
  env: Env,
  user: { id: string } | undefined,
  parsed: SearchQuery,
): Promise<ResolvedSearchDsl> {
  const folderPrefixes: FolderPrefixFilter[] = [];
  const folderPrefixSets: FolderPrefixSetFilter[] = [];
  const layers: LayerFilter[] = [];
  const tags: TagFilter[] = [];
  let empty = false;

  for (const filter of parsed.filters) {
    const resolved = await resolveFilter(env, user, filter);
    if (resolved === "empty") {
      empty = true;
      continue;
    }
    if (resolved === "drop") {
      continue;
    }
    if (resolved.kind === "folder") {
      folderPrefixes.push({ negated: filter.negated, value: resolved.value });
    } else if (resolved.kind === "folder-set") {
      folderPrefixSets.push({
        negated: filter.negated,
        values: resolved.values,
      });
    } else if (resolved.kind === "layer") {
      layers.push({ negated: filter.negated, value: resolved.value });
    } else {
      tags.push({ negated: filter.negated, value: resolved.value });
    }
  }
  return { empty, folderPrefixes, folderPrefixSets, layers, parsed, tags };
}

function rowLayer(row: { layer: string | null }): NoteLayer {
  return isNoteLayer(row.layer ?? "") ? (row.layer as NoteLayer) : "bronze";
}

/**
 * `#foo` matches `#foo` and nested `#foo/bar`, but not `#foobar`.
 * Tag characters are word chars, `-`, and `/` (nested tags).
 */
function bodyHasTag(body: string, tag: string): boolean {
  let from = 0;
  for (;;) {
    const index = body.indexOf(tag, from);
    if (index < 0) {
      return false;
    }
    const next = body.charAt(index + tag.length);
    if (next === "" || !/[\w-]/.test(next)) {
      return true;
    }
    from = index + 1;
  }
}

/**
 * Authoritative in-memory check: every positive term must appear (per scope),
 * every negated term must be absent, and every resolved filter must hold.
 * Runs after permission filtering — it never widens visibility.
 */
function termFound(
  term: { value: string },
  title: string,
  body: string,
  scope: "all" | "body" | "title",
): boolean {
  if (scope === "title") {
    return title.includes(term.value);
  }
  if (scope === "body") {
    return body.includes(term.value);
  }
  return title.includes(term.value) || body.includes(term.value);
}

export function rowMatchesSearchDsl(
  row: {
    title: string;
    folder: string;
    markdown_snapshot: string | null;
    layer: string | null;
  },
  resolved: ResolvedSearchDsl,
  scope: "all" | "body" | "title",
): boolean {
  const title = row.title.toLowerCase();
  const body = (row.markdown_snapshot ?? "").toLowerCase();
  for (const term of resolved.parsed.terms) {
    if (termFound(term, title, body, scope) === term.negated) {
      return false;
    }
  }
  for (const prefix of resolved.folderPrefixes) {
    if (pathFilterMatches(row.folder, prefix.value) === prefix.negated) {
      return false;
    }
  }
  for (const set of resolved.folderPrefixSets) {
    const any = set.values.some((value) =>
      pathFilterMatches(row.folder, value),
    );
    if (any === set.negated) {
      return false;
    }
  }
  for (const tag of resolved.tags) {
    if (bodyHasTag(body, tag.value) === tag.negated) {
      return false;
    }
  }
  for (const layer of resolved.layers) {
    if ((rowLayer(row) === layer.value) === layer.negated) {
      return false;
    }
  }
  return true;
}
