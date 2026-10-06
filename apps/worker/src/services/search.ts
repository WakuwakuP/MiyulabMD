import type { GrepMatch, GrepResult } from "@miyulabmd/shared";

const GREP_DEFAULTS = {
  contextAfter: 1,
  contextBefore: 1,
  maxMatchesPerNote: 10,
  maxNotes: 50,
} as const;

export const GREP_LIMITS = {
  /** Abort the scan after this wall-clock budget. */
  deadlineMs: 1500,
  maxContext: 5,
  maxMatchesPerNote: 50,
  maxNotes: 200,
  maxPatternLength: 500,
  /** Deterministic bounds so huge drives stop before the CPU budget does. */
  maxScanChars: 2_000_000,
  maxScanNotes: 500,
} as const;

export type GrepRow = {
  id: string;
  title: string;
  markdown_snapshot: string | null;
  snapshot_updated_at: number | null;
};

export type LineMatcher = {
  /** First match inside a single line, or null. Index is 0-based. */
  match(line: string): { index: number; length: number } | null;
  /** Optional indexed fixed-string scan; null retains per-line matching. */
  prepareSnapshot?(snapshot: string): {
    findNext(start: number): { index: number; length: number } | null;
  } | null;
};

function globToRegExp(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "i");
}

export function createLineMatcher(
  pattern: string,
  options: { caseSensitive?: boolean; fixedString?: boolean } = {},
):
  | { kind: "ok"; matcher: LineMatcher }
  | { kind: "bad_request"; error: string } {
  if (!pattern) {
    return { error: "pattern is required", kind: "bad_request" };
  }
  if (pattern.length > GREP_LIMITS.maxPatternLength) {
    return {
      error: `pattern must be at most ${GREP_LIMITS.maxPatternLength} characters`,
      kind: "bad_request",
    };
  }

  const caseSensitive = options.caseSensitive ?? false;
  if (options.fixedString ?? true) {
    const needle = caseSensitive ? pattern : pattern.toLowerCase();
    return {
      kind: "ok",
      matcher: {
        match(line) {
          const haystack = caseSensitive ? line : line.toLowerCase();
          const index = haystack.indexOf(needle);
          return index === -1 ? null : { index, length: needle.length };
        },
        prepareSnapshot(snapshot) {
          const haystack = caseSensitive ? snapshot : snapshot.toLowerCase();
          // Unicode lowercasing can expand characters (e.g. İ -> i + dot).
          // In that case whole-snapshot offsets cannot index original text.
          if (haystack.length !== snapshot.length) {
            return null;
          }
          return {
            findNext(start) {
              const index = haystack.indexOf(needle, start);
              return index === -1 ? null : { index, length: needle.length };
            },
          };
        },
      },
    };
  }

  let regex: RegExp;
  try {
    regex = new RegExp(pattern, caseSensitive ? "" : "i");
  } catch {
    return { error: "invalid regular expression", kind: "bad_request" };
  }
  return {
    kind: "ok",
    matcher: {
      match(line) {
        const hit = regex.exec(line);
        return hit ? { index: hit.index, length: hit[0].length } : null;
      },
    },
  };
}

function clampInt(
  value: number | undefined,
  fallback: number,
  max: number,
): number {
  if (value === undefined) {
    return fallback;
  }
  return Math.max(0, Math.min(Math.trunc(value), max));
}

export type GrepScanOptions = {
  globTitle?: string;
  maxMatchesPerNote?: number;
  maxNotes?: number;
  contextBefore?: number;
  contextAfter?: number;
  deadlineMs?: number;
};

type GrepScanConfig = {
  maxMatchesPerNote: number;
  maxNotes: number;
  contextBefore: number;
  contextAfter: number;
  deadline: number;
  titleFilter: RegExp | null;
};

function resolveScanConfig(options: GrepScanOptions): GrepScanConfig {
  return {
    contextAfter: clampInt(
      options.contextAfter,
      GREP_DEFAULTS.contextAfter,
      GREP_LIMITS.maxContext,
    ),
    contextBefore: clampInt(
      options.contextBefore,
      GREP_DEFAULTS.contextBefore,
      GREP_LIMITS.maxContext,
    ),
    deadline: Date.now() + (options.deadlineMs ?? GREP_LIMITS.deadlineMs),
    maxMatchesPerNote: clampInt(
      options.maxMatchesPerNote,
      GREP_DEFAULTS.maxMatchesPerNote,
      GREP_LIMITS.maxMatchesPerNote,
    ),
    maxNotes: Math.max(
      1,
      Math.min(
        Math.trunc(options.maxNotes ?? GREP_DEFAULTS.maxNotes),
        GREP_LIMITS.maxNotes,
      ),
    ),
    titleFilter: options.globTitle ? globToRegExp(options.globTitle) : null,
  };
}

function linesBefore(snapshot: string, start: number, count: number): string[] {
  const lines: string[] = [];
  let end = start - 1;
  while (end >= 0 && lines.length < count) {
    const separator = end === 0 ? -1 : snapshot.lastIndexOf("\n", end - 1);
    lines.unshift(snapshot.slice(separator + 1, end));
    end = separator;
  }
  return lines;
}

function linesAfter(snapshot: string, end: number, count: number): string[] {
  const lines: string[] = [];
  if (end === snapshot.length) {
    return lines;
  }
  let start = end + 1;
  while (lines.length < count) {
    const separator = snapshot.indexOf("\n", start);
    lines.push(snapshot.slice(start, separator === -1 ? undefined : separator));
    if (separator === -1) {
      break;
    }
    start = separator + 1;
  }
  return lines;
}

function scanNoteLines(
  row: GrepRow,
  lines: readonly string[],
  matcher: LineMatcher,
  config: GrepScanConfig,
): { matches: GrepMatch[]; truncated: boolean } {
  const matches: GrepMatch[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (matches.length >= config.maxMatchesPerNote) {
      return { matches, truncated: true };
    }
    const text = lines[index] ?? "";
    const hit = matcher.match(text);
    if (!hit) {
      continue;
    }
    matches.push({
      after: lines.slice(index + 1, index + 1 + config.contextAfter),
      before: lines.slice(Math.max(0, index - config.contextBefore), index),
      column: hit.index + 1,
      line: index + 1,
      noteId: row.id,
      snapshotUpdatedAt: row.snapshot_updated_at,
      text,
      title: row.title,
    });
  }
  return { matches, truncated: false };
}

function scanIndexedNote(
  row: GrepRow,
  snapshot: string,
  prepared: NonNullable<
    ReturnType<NonNullable<LineMatcher["prepareSnapshot"]>>
  >,
  config: GrepScanConfig,
): { matches: GrepMatch[]; truncated: boolean } {
  const matches: GrepMatch[] = [];
  if (config.maxMatchesPerNote === 0) {
    return { matches, truncated: true };
  }
  let start = 0;
  let line = 1;
  let hit = prepared.findNext(start);
  while (hit) {
    let separator = snapshot.indexOf("\n", start);
    while (separator !== -1 && separator < hit.index) {
      start = separator + 1;
      line += 1;
      separator = snapshot.indexOf("\n", start);
    }
    const end = separator === -1 ? snapshot.length : separator;
    // A fixed-string pattern containing a newline cannot match one line.
    if (hit.index + hit.length <= end) {
      matches.push({
        after: linesAfter(snapshot, end, config.contextAfter),
        before: linesBefore(snapshot, start, config.contextBefore),
        column: hit.index - start + 1,
        line,
        noteId: row.id,
        snapshotUpdatedAt: row.snapshot_updated_at,
        text: snapshot.slice(start, end),
        title: row.title,
      });
      if (matches.length >= config.maxMatchesPerNote) {
        return { matches, truncated: end < snapshot.length };
      }
    }
    if (separator === -1) {
      break;
    }
    start = separator + 1;
    line += 1;
    hit = prepared.findNext(start);
  }
  return { matches, truncated: false };
}

function scanNote(
  row: GrepRow,
  snapshot: string,
  matcher: LineMatcher,
  config: GrepScanConfig,
) {
  // Fixed strings skip nonmatching lines without allocating a full array.
  // Regex and expanding Unicode casing retain the original per-line path.
  const prepared = matcher.prepareSnapshot?.(snapshot);
  return prepared
    ? scanIndexedNote(row, snapshot, prepared, config)
    : scanNoteLines(row, snapshot.split("\n"), matcher, config);
}

/**
 * Line-scan already permission-filtered rows. Callers must pass only rows the
 * user may view; this function never widens visibility.
 */
export function grepRows(
  rows: readonly GrepRow[],
  matcher: LineMatcher,
  options: GrepScanOptions = {},
): GrepResult {
  const config = resolveScanConfig(options);
  const matches: GrepMatch[] = [];
  let scannedNotes = 0;
  let scannedChars = 0;
  let matchedNotes = 0;
  let truncated = false;

  for (const row of rows) {
    if (
      matchedNotes >= config.maxNotes ||
      scannedNotes >= GREP_LIMITS.maxScanNotes ||
      Date.now() > config.deadline
    ) {
      truncated = true;
      break;
    }
    if (config.titleFilter && !config.titleFilter.test(row.title)) {
      continue;
    }

    const snapshot = row.markdown_snapshot ?? "";
    scannedNotes += 1;
    scannedChars += snapshot.length;
    if (scannedChars > GREP_LIMITS.maxScanChars) {
      truncated = true;
      break;
    }

    const scanned = scanNote(row, snapshot, matcher, config);
    matches.push(...scanned.matches);
    if (scanned.truncated) {
      truncated = true;
    }
    if (scanned.matches.length > 0) {
      matchedNotes += 1;
    }
  }

  return { matches, scannedNotes, truncated };
}
