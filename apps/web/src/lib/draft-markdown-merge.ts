import {
  splitMarkdownFrontmatter,
  withClosedFrontmatter,
} from "@miyulabmd/shared";
import diff from "fast-diff";

const EQUAL = 0;
const INSERT = 1;
const DELETE = -1;

type RegionChange = {
  start: number;
  end: number;
  text: string;
};

function collectChanges(base: string, next: string): RegionChange[] {
  const changes: RegionChange[] = [];
  let index = 0;
  for (const [op, text] of diff(base, next)) {
    if (op === EQUAL) {
      index += text.length;
    } else if (op === DELETE) {
      changes.push({ end: index + text.length, start: index, text: "" });
      index += text.length;
    } else if (op === INSERT) {
      changes.push({ end: index, start: index, text });
      index += text.length;
    }
  }
  return changes;
}

function rangesOverlap(a: RegionChange, b: RegionChange): boolean {
  const aEnd = a.start + (a.text.length || a.end - a.start);
  const bEnd = b.start + (b.text.length || b.end - b.start);
  return a.start < bEnd && b.start < aEnd;
}

function applyChanges(base: string, changes: RegionChange[]): string {
  let result = base;
  for (const change of [...changes].sort((a, b) => b.start - a.start)) {
    if (change.text.length > 0) {
      result =
        result.slice(0, change.start) +
        change.text +
        result.slice(change.start);
    } else {
      result = result.slice(0, change.start) + result.slice(change.end);
    }
  }
  return result;
}

/** Merge local/server edits since the last acknowledged local baseline. */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: 3-way frontmatter/body merge
export function mergeDraftMarkdownForPatch(input: {
  acknowledgedLocalMarkdown: string;
  acknowledgedMarkdown: string;
  localMarkdown: string;
}): { markdown: string; conflict: boolean } {
  const { acknowledgedLocalMarkdown, acknowledgedMarkdown, localMarkdown } =
    input;

  if (localMarkdown === acknowledgedLocalMarkdown) {
    return { conflict: false, markdown: acknowledgedMarkdown };
  }

  const localSplit = splitMarkdownFrontmatter(acknowledgedLocalMarkdown);
  const serverSplit = splitMarkdownFrontmatter(acknowledgedMarkdown);
  const latestSplit = splitMarkdownFrontmatter(localMarkdown);

  const baselineFm = localSplit.raw ?? "";
  const serverFm = serverSplit.raw ?? "";
  const latestFm = latestSplit.raw ?? "";

  const fmChangesLocal = collectChanges(baselineFm, latestFm);
  const fmChangesServer = collectChanges(baselineFm, serverFm);
  const bodyChangesLocal = collectChanges(localSplit.body, latestSplit.body);
  const bodyChangesServer = collectChanges(localSplit.body, serverSplit.body);

  let fmConflict = false;
  const fmMerged: RegionChange[] = [];
  for (const change of fmChangesLocal) {
    const overlaps = fmChangesServer.some((other) =>
      rangesOverlap(change, other),
    );
    if (overlaps) {
      fmConflict = true;
      fmMerged.push(change);
    } else {
      fmMerged.push(change);
    }
  }
  for (const change of fmChangesServer) {
    const overlaps = fmChangesLocal.some((other) =>
      rangesOverlap(change, other),
    );
    if (!overlaps) {
      fmMerged.push(change);
    }
  }

  let bodyConflict = false;
  const bodyMerged: RegionChange[] = [];
  for (const change of bodyChangesLocal) {
    const overlaps = bodyChangesServer.some((other) =>
      rangesOverlap(change, other),
    );
    if (overlaps) {
      bodyConflict = true;
      bodyMerged.push(change);
    } else {
      bodyMerged.push(change);
    }
  }
  for (const change of bodyChangesServer) {
    const overlaps = bodyChangesLocal.some((other) =>
      rangesOverlap(change, other),
    );
    if (!overlaps) {
      bodyMerged.push(change);
    }
  }

  const mergedFm = applyChanges(baselineFm, fmMerged);
  const mergedBody = applyChanges(localSplit.body, bodyMerged);
  const markdown = withClosedFrontmatter(
    acknowledgedMarkdown,
    mergedBody.length > 0 || mergedFm.length > 0
      ? mergedBody
      : latestSplit.body,
  );

  if (mergedFm.length > 0 && !bodyConflict) {
    const withFm =
      mergedFm.length > 0 ? `---\n${mergedFm}\n---\n\n${mergedBody}` : markdown;
    return {
      conflict: fmConflict || bodyConflict,
      markdown: withFm,
    };
  }

  return { conflict: fmConflict || bodyConflict, markdown };
}

/** Contract: promotion sync must not merge independent Yjs CRDT state. */
export function adoptServerMarkdownWithoutCrdtMerge(
  localMarkdown: string,
  serverMarkdown: string,
): string {
  return serverMarkdown.length > 0 ? serverMarkdown : localMarkdown;
}
