import {
  GOLD_UNLOCK_DEFAULT_MINUTES,
  GOLD_UNLOCK_MAX_MINUTES,
  isNoteLayer,
  LAYER_RANK,
  NOTE_LAYERS,
  type NoteLayer,
  type NoteLayerEvent,
  type NoteSummary,
  nextLayer,
  type PromoteGateFailure,
  parseNoteLinks,
  type SessionUser,
  titleFromMarkdown,
} from "@miyulabmd/shared";

import { db } from "../db/client.ts";
import {
  findNoteRow,
  listAccessibleRows,
  type NoteRow,
  toSummary,
} from "./notes.ts";
import { viewDeniedHttpStatus } from "./permissions.ts";

export type LayerError =
  | { kind: "not_found" }
  | { kind: "denied"; status: number }
  | { kind: "invalid"; status: number; error: string };

export type LayerOutcome<T> =
  | { kind: "ok"; result: T }
  | { kind: "gates"; failures: PromoteGateFailure[]; to: NoteLayer }
  | LayerError;

function denied(status: number): LayerError {
  return { kind: "denied", status };
}
function notFound(): LayerError {
  return { kind: "not_found" };
}
function invalid(status: number, error: string): LayerError {
  return { error, kind: "invalid", status };
}

export function layerOf(row: NoteRow): NoteLayer {
  return isNoteLayer(row.layer ?? "") ? (row.layer as NoteLayer) : "bronze";
}

/** Gold かつ unlock 期限外なら編集ロック中。 */
export function noteLocked(row: NoteRow, now = Date.now()): boolean {
  const until = row.gold_unlocked_until;
  return layerOf(row) === "gold" && (until == null || until <= now);
}

/** 層変更系操作のロード＋権限チェック（層はオーナーの品質管理）。 */
async function loadForLayerChange(
  env_: Env,
  idOrShortId: string,
  user: SessionUser | undefined,
): Promise<{ row: NoteRow; user: SessionUser } | LayerError> {
  if (!user) {
    return denied(401);
  }
  const row = await findNoteRow(env_, idOrShortId);
  if (!row || row.owner_id !== user.id) {
    // 他人のノートには触れない（存在も隠す）。
    return notFound();
  }
  return { row, user };
}

async function recordLayerEvent(
  env_: Env,
  row: NoteRow,
  to: NoteLayer,
  user: SessionUser,
  reason: string | null,
): Promise<void> {
  await db(env_)
    .prepare(
      `INSERT INTO note_layer_events (
         id, note_id, from_layer, to_layer, actor_user_id, actor_name,
         reason, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      row.id,
      layerOf(row),
      to,
      user.id,
      user.displayName ?? user.email,
      reason,
      Date.now(),
    )
    .run();
}

async function applyLayer(
  env_: Env,
  row: NoteRow,
  to: NoteLayer,
  user: SessionUser,
  reason: string | null,
): Promise<{ kind: "ok"; result: { note: NoteSummary } }> {
  await recordLayerEvent(env_, row, to, user, reason);
  const demoting = LAYER_RANK[to] < LAYER_RANK[layerOf(row)];
  await db(env_)
    .prepare(
      `UPDATE notes SET layer = ?, updated_at = ?
         ${demoting ? ", gold_unlocked_until = NULL" : ""}
       WHERE id = ?`,
    )
    .bind(to, Date.now(), row.id)
    .run();
  const updated = await findNoteRow(env_, row.id);
  if (!updated) {
    throw new Error("note layer update failed");
  }
  return {
    kind: "ok",
    result: { note: await toSummary(env_, updated, user) },
  };
}

/**
 * 任意の層へ直接変更（監査あり）。昇格ゲートを通さないため、
 * ゲートを評価したい場合は promoteNote を使う。
 */
export async function setNoteLayer(
  env_: Env,
  idOrShortId: string,
  to: NoteLayer,
  reason: string | null,
  user: SessionUser | undefined,
): Promise<LayerOutcome<{ note: NoteSummary }>> {
  if (!isNoteLayer(to)) {
    return invalid(400, `layer は ${NOTE_LAYERS.join("/")} のいずれかです`);
  }
  const loaded = await loadForLayerChange(env_, idOrShortId, user);
  if ("kind" in loaded) {
    return loaded;
  }
  if (layerOf(loaded.row) === to) {
    return invalid(400, "すでにその層です");
  }
  return applyLayer(env_, loaded.row, to, loaded.user, reason);
}

const UNTITLED_TITLES = new Set(["", "Untitled", "無題"]);

/** 先頭の H1（タイトル行）を除いた本文に内容があるか。 */
function bodyBeyondTitle(markdown: string): string {
  const lines = markdown.split("\n");
  const rest = lines[0]?.startsWith("# ") ? lines.slice(1) : lines;
  return rest
    .join("\n")
    .replace(/^(?:---\n[\s\S]*?---\n)/, "")
    .trim();
}

function hasSubHeadings(markdown: string): boolean {
  return /^#{2,6}\s/m.test(markdown);
}

/** promote の機械可読ゲートを評価する。 */
export async function evaluatePromoteGates(
  env_: Env,
  row: NoteRow,
  to: NoteLayer,
): Promise<PromoteGateFailure[]> {
  const failures: PromoteGateFailure[] = [];
  const markdown = row.markdown_snapshot ?? "";
  const title = titleFromMarkdown(markdown) || (row.title ?? "");

  if (UNTITLED_TITLES.has(title.trim())) {
    failures.push({
      code: "missing_title",
      message: "タイトル（H1）がありません",
    });
  }
  if (!bodyBeyondTitle(markdown)) {
    failures.push({
      code: "empty_body",
      message: "タイトル以外の本文が空です",
    });
  }
  if (parseNoteLinks(markdown).length === 0) {
    failures.push({
      code: "no_links",
      message: "ノートへのリンク（[[...]] または /n/... リンク）がありません",
    });
  }

  if (to === "gold") {
    if (!hasSubHeadings(markdown)) {
      failures.push({
        code: "no_headings",
        message: "H2 以降の見出し（要約・構造）がありません",
      });
    }
    const broken = await db(env_)
      .prepare(
        `SELECT COUNT(*) AS n FROM note_links
         WHERE src_note_id = ? AND dest_status IN ('missing', 'ambiguous')`,
      )
      .bind(row.id)
      .first<{ n: number }>();
    if ((broken?.n ?? 0) > 0) {
      failures.push({
        code: "broken_links",
        message: `未解決リンクが ${broken?.n} 件あります`,
      });
    }
  }
  return failures;
}

/** 最新リビジョンをピンして compaction から守る（昇格時）。 */
async function pinLatestRevision(env_: Env, noteId: string): Promise<void> {
  await db(env_)
    .prepare(
      `UPDATE note_revisions SET pinned = 1
       WHERE note_id = ? AND created_at = (
         SELECT MAX(created_at) FROM note_revisions WHERE note_id = ?
       )`,
    )
    .bind(noteId, noteId)
    .run();
}

/**
 * 1段階昇格（bronze→silver→gold）。ゲートを評価し、失敗時は
 * 機械可読な failures 配列を返す。gold 昇格は confirm=true が必須。
 */
export async function promoteNote(
  env_: Env,
  idOrShortId: string,
  confirm: boolean | undefined,
  user: SessionUser | undefined,
): Promise<LayerOutcome<{ note: NoteSummary }>> {
  const loaded = await loadForLayerChange(env_, idOrShortId, user);
  if ("kind" in loaded) {
    return loaded;
  }
  const row = loaded.row;
  const to = nextLayer(layerOf(row));
  if (!to) {
    return invalid(400, "これ以上昇格できません（gold が最上位です）");
  }

  const failures = await evaluatePromoteGates(env_, row, to);
  if (to === "gold" && !confirm) {
    failures.push({
      code: "needs_confirm",
      message: "gold への昇格は confirm=true が必要です",
    });
  }
  if (failures.length > 0) {
    return { failures, kind: "gates", to };
  }

  const result = await applyLayer(env_, row, to, loaded.user, null);
  await pinLatestRevision(env_, row.id).catch(() => undefined);
  return result;
}

/** 降格。理由は必須（監査のため）。to 省略時は1段階下。 */
export async function demoteNote(
  env_: Env,
  idOrShortId: string,
  reason: string | null,
  to: NoteLayer | undefined,
  user: SessionUser | undefined,
): Promise<LayerOutcome<{ note: NoteSummary }>> {
  const loaded = await loadForLayerChange(env_, idOrShortId, user);
  if ("kind" in loaded) {
    return loaded;
  }
  const row = loaded.row;
  const current = layerOf(row);
  const target = to ?? NOTE_LAYERS[LAYER_RANK[current] - 1];
  if (!target) {
    return invalid(400, "bronze より下には降格できません");
  }
  if (LAYER_RANK[target] >= LAYER_RANK[current]) {
    return invalid(400, "demote は現在より低い層を指定してください");
  }
  if (!reason?.trim()) {
    return invalid(400, "降格には理由（reason）が必要です");
  }
  return applyLayer(env_, row, target, loaded.user, reason.trim());
}

/** gold の期限付き編集解除。canEdit 権限で実行可。 */
export async function unlockGoldForEdit(
  env_: Env,
  idOrShortId: string,
  minutes: number | undefined,
  user: SessionUser | undefined,
): Promise<LayerOutcome<{ note: NoteSummary; unlockedUntil: number }>> {
  if (!user) {
    return denied(401);
  }
  const row = await findNoteRow(env_, idOrShortId);
  if (!row) {
    return notFound();
  }
  const summary = await toSummary(env_, row, user);
  if (!summary.access.flags.canEdit) {
    return denied(
      viewDeniedHttpStatus(
        { flags: summary.access.flags, ownerId: row.owner_id },
        user.id,
        env_,
      ),
    );
  }
  if (layerOf(row) !== "gold") {
    return invalid(400, "gold ではないノートは解除不要です");
  }

  const span = Math.min(
    Math.max(Math.trunc(minutes ?? GOLD_UNLOCK_DEFAULT_MINUTES), 1),
    GOLD_UNLOCK_MAX_MINUTES,
  );
  const until = Date.now() + span * 60_000;
  await db(env_)
    .prepare("UPDATE notes SET gold_unlocked_until = ? WHERE id = ?")
    .bind(until, row.id)
    .run();
  const updated = await findNoteRow(env_, row.id);
  if (!updated) {
    throw new Error("note unlock failed");
  }
  return {
    kind: "ok",
    result: {
      note: await toSummary(env_, updated, user),
      unlockedUntil: until,
    },
  };
}

/** 指定層のノート一覧（閲覧可能なもののみ）。 */
export async function listNotesByLayer(
  env_: Env,
  user: SessionUser | undefined,
  layer: NoteLayer,
): Promise<LayerOutcome<{ notes: Awaited<ReturnType<typeof toSummary>>[] }>> {
  if (!user) {
    return denied(401);
  }
  if (!isNoteLayer(layer)) {
    return invalid(400, `layer は ${NOTE_LAYERS.join("/")} のいずれかです`);
  }
  const rows = (await listAccessibleRows(env_, user)).filter(
    (row) => layerOf(row) === layer,
  );
  return {
    kind: "ok",
    result: {
      notes: await Promise.all(rows.map((row) => toSummary(env_, row, user))),
    },
  };
}

/** 層イベント履歴（canView で閲覧可）。 */
export async function listLayerEvents(
  env_: Env,
  idOrShortId: string,
  user: SessionUser | undefined,
): Promise<LayerOutcome<{ events: NoteLayerEvent[] }>> {
  const row = await findNoteRow(env_, idOrShortId);
  if (!row) {
    return notFound();
  }
  const summary = await toSummary(env_, row, user);
  if (!summary.access.flags.canView) {
    return denied(
      viewDeniedHttpStatus(
        { flags: summary.access.flags, ownerId: row.owner_id },
        user?.id,
        env_,
      ),
    );
  }
  const rows = await db(env_)
    .prepare(
      `SELECT id, note_id, from_layer, to_layer, actor_user_id, actor_name,
              reason, created_at
         FROM note_layer_events WHERE note_id = ? ORDER BY created_at DESC`,
    )
    .bind(row.id)
    .all<{
      actor_name: string;
      actor_user_id: string | null;
      created_at: number;
      from_layer: string | null;
      id: string;
      note_id: string;
      reason: string | null;
      to_layer: string;
    }>();
  return {
    kind: "ok",
    result: {
      events: (rows.results ?? []).map((event) => ({
        actorName: event.actor_name,
        actorUserId: event.actor_user_id,
        createdAt: event.created_at,
        fromLayer: isNoteLayer(event.from_layer ?? "")
          ? (event.from_layer as NoteLayer)
          : null,
        id: event.id,
        noteId: event.note_id,
        reason: event.reason,
        toLayer: isNoteLayer(event.to_layer)
          ? (event.to_layer as NoteLayer)
          : "bronze",
      })),
    },
  };
}
