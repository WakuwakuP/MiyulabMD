import {
  ACCESS_SCOPE_LABELS,
  type AccessScope,
  ARTICLE_FIELD_TYPES,
  type ArticleSchemaField,
  type ArticleSource,
  type ArticleUpdateAudience,
  type ArticleUpdateAudienceValue,
  DRIVE_ARTICLE_UPDATE_AUDIENCE_LABELS,
  type DriveArticleUpdateAudience,
  type FolderRecord,
  type SharedDriveSummary,
} from "@miyulabmd/shared";
import { type FormEvent, useEffect, useState } from "react";
import { useOutletContext } from "react-router";
import type { AppShellContext } from "../../components/layout/AppShellContext.ts";
import { FolderHierarchySelect } from "../../components/settings/FolderHierarchySelect.tsx";
import { SiteMigrateDialog } from "../../components/settings/SiteMigrateDialog.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { CheckLabel, Field, Row } from "../../components/ui/Field.tsx";
import { Input } from "../../components/ui/Input.tsx";
import { Select } from "../../components/ui/Select.tsx";
import { ErrorText, MutedText } from "../../components/ui/Text.tsx";
import {
  createArticleSource,
  deleteArticleSource,
  fetchArticleSourceSettings,
  fetchFolderTree,
  fetchSharedDrives,
  fetchSharedFolders,
  updateArticleSource,
} from "../../lib/api.ts";
import { hasSelectableSourceFolders } from "../../lib/folder-tree.ts";

type DraftField = ArticleSchemaField & { rowId: string };
type Draft = {
  id?: string;
  name: string;
  folder: string;
  driveRoot: boolean;
  sharedFolderId: string;
  updateAudience: ArticleUpdateAudienceValue;
  schema: DraftField[];
  webhookUrl: string;
  webhookAuthorization: string;
  webhookAuthorizationSet: boolean;
};
function newRowId(): string {
  return crypto.randomUUID();
}
function emptyDraft(): Draft {
  return {
    driveRoot: false,
    folder: "",
    name: "",
    schema: [],
    sharedFolderId: "",
    updateAudience: "self",
    webhookAuthorization: "",
    webhookAuthorizationSet: false,
    webhookUrl: "",
  };
}
function audienceFromSource(
  source: ArticleSource,
  drive: boolean,
): ArticleUpdateAudienceValue {
  if (drive) {
    return source.updateAudience === "managers_or_editors"
      ? "managers_or_editors"
      : "managers";
  }
  return source.updateAudience === "editors" ? "editors" : "self";
}

function draftFromSource(
  source: ArticleSource,
  shared: boolean,
  drive: boolean,
): Draft {
  return {
    driveRoot: drive && source.folder === "",
    folder: source.folder,
    id: source.id,
    name: source.name,
    schema: source.schema.map((field) => ({ ...field, rowId: newRowId() })),
    sharedFolderId: shared ? (source.folderId ?? "") : "",
    updateAudience: audienceFromSource(source, drive),
    webhookAuthorization: "",
    webhookAuthorizationSet: source.webhookAuthorizationSet,
    webhookUrl: source.webhookUrl ?? "",
  };
}

function sourcePlace(source: ArticleSource, shared: boolean): string {
  if (source.ownerKind === "shared_drive") {
    const audience =
      source.updateAudience === "managers_or_editors"
        ? "管理者または編集者"
        : "管理者のみ";
    return `${source.folder || "ドライブ全体"} · ${audience}`;
  }
  const audience =
    source.updateAudience === "editors" ? "編集できる人" : "自分のみ";
  if (shared) {
    return `${source.folder} · 共有フォルダ · ${audience}`;
  }
  return `${source.folder} · ${audience}`;
}

function selectedWriteScope(
  folders: FolderRecord[],
  sharedFolders: FolderRecord[],
  draft: Draft,
): AccessScope | null {
  if (draft.sharedFolderId) {
    return (
      sharedFolders.find((folder) => folder.id === draft.sharedFolderId)
        ?.writeScope ?? null
    );
  }
  if (!draft.folder) {
    return null;
  }
  return (
    folders.find((folder) => folder.folder === draft.folder)?.writeScope ?? null
  );
}

function folderFields(
  draft: Draft,
  driveRootId: string | null,
): { folder?: string; folderId?: string } {
  if (draft.driveRoot && driveRootId) {
    return { folderId: driveRootId };
  }
  if (draft.sharedFolderId) {
    return { folderId: draft.sharedFolderId };
  }
  if (draft.folder) {
    return { folder: draft.folder };
  }
  return {};
}

function sharedFolderOptions(
  folders: FolderRecord[],
  draft: Draft,
): FolderRecord[] {
  const editable = folders.filter((folder) => folder.canEdit);
  if (
    !draft.sharedFolderId ||
    editable.some((folder) => folder.id === draft.sharedFolderId)
  ) {
    return editable;
  }
  return [
    ...editable,
    {
      id: draft.sharedFolderId,
      name: draft.folder || "共有フォルダ",
      parentId: null,
    },
  ];
}

function audienceHint(
  audience: ArticleUpdateAudience,
  writeScope: AccessScope | null,
  sharedFolder: boolean,
): string {
  const range = writeScope
    ? `現在の編集範囲は「${ACCESS_SCOPE_LABELS[writeScope]}」です。`
    : "";
  if (sharedFolder || audience === "editors") {
    return `このフォルダを編集できる人が「サイトを更新」を押せます。閲覧だけの人は押せません。${range}`;
  }
  return `フォルダの所有者だけが「サイトを更新」を押せます。${range}`;
}

function DriveAudienceFields({
  draft,
  folders,
  onChange,
}: {
  draft: Draft;
  folders: FolderRecord[];
  onChange: (draft: Draft) => void;
}) {
  return (
    <>
      <CheckLabel>
        <input
          checked={draft.driveRoot}
          onChange={(event) =>
            onChange({
              ...draft,
              driveRoot: event.target.checked,
              folder: "",
              sharedFolderId: "",
            })
          }
          type="checkbox"
        />
        ドライブ全体
      </CheckLabel>
      {!draft.driveRoot && (
        <div className="grid gap-[0.35rem]">
          <span className="text-[0.85rem] text-muted">ディレクトリ</span>
          <FolderHierarchySelect
            folders={folders}
            id="source-folder"
            onChange={(folder) => onChange({ ...draft, folder })}
            value={draft.folder}
          />
        </div>
      )}
      <fieldset className="grid gap-2 border-0 p-0">
        <legend className="text-[0.85rem] text-muted">
          サイトを更新できる人
        </legend>
        {(
          Object.entries(DRIVE_ARTICLE_UPDATE_AUDIENCE_LABELS) as [
            DriveArticleUpdateAudience,
            string,
          ][]
        ).map(([value, label]) => (
          <CheckLabel key={value}>
            <input
              checked={draft.updateAudience === value}
              name="update-audience"
              onChange={() => onChange({ ...draft, updateAudience: value })}
              type="radio"
              value={value}
            />
            {label}
          </CheckLabel>
        ))}
        <MutedText>
          役割はドライブ全体です。管理者は常に実行できます。編集者は「管理者または編集者」のときだけ実行できます。
        </MutedText>
      </fieldset>
    </>
  );
}

function SourceAudienceFields({
  draft,
  editableShared,
  folders,
  onChange,
  sharedFolders,
}: {
  draft: Draft;
  editableShared: FolderRecord[];
  folders: FolderRecord[];
  onChange: (draft: Draft) => void;
  sharedFolders: FolderRecord[];
}) {
  const showSharedPicker =
    Boolean(draft.sharedFolderId) || (!draft.id && editableShared.length > 0);
  return (
    <>
      {!draft.sharedFolderId && (
        <div className="grid gap-[0.35rem]">
          <span className="text-[0.85rem] text-muted">
            ディレクトリ（マイドライブ）
          </span>
          <FolderHierarchySelect
            folders={folders}
            id="source-folder"
            onChange={(folder) => onChange({ ...draft, folder })}
            value={draft.folder}
          />
        </div>
      )}
      {showSharedPicker && (
        <Field htmlFor="source-shared-folder" label="共有フォルダ">
          <Select
            className="w-full rounded-lg px-3 py-2.5"
            id="source-shared-folder"
            onChange={(event) => {
              const sharedFolderId = event.target.value;
              onChange({
                ...draft,
                folder: "",
                sharedFolderId,
                updateAudience: sharedFolderId
                  ? "editors"
                  : draft.updateAudience,
              });
            }}
            value={draft.sharedFolderId}
          >
            {!draft.id && <option value="">使わない</option>}
            {sharedFolderOptions(sharedFolders, draft).map((folder) => (
              <option key={folder.id} value={folder.id}>
                {folder.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <fieldset className="grid gap-2 border-0 p-0">
        <legend className="text-[0.85rem] text-muted">
          サイトを更新できる人
        </legend>
        <CheckLabel>
          <input
            checked={draft.updateAudience === "self"}
            disabled={Boolean(draft.sharedFolderId)}
            name="update-audience"
            onChange={() => onChange({ ...draft, updateAudience: "self" })}
            type="radio"
            value="self"
          />
          自分のみ
        </CheckLabel>
        <CheckLabel>
          <input
            checked={draft.updateAudience === "editors"}
            name="update-audience"
            onChange={() => onChange({ ...draft, updateAudience: "editors" })}
            type="radio"
            value="editors"
          />
          編集権限が付与されている範囲
        </CheckLabel>
        <MutedText>
          {audienceHint(
            draft.updateAudience === "editors" ? "editors" : "self",
            selectedWriteScope(folders, sharedFolders, draft),
            Boolean(draft.sharedFolderId),
          )}
        </MutedText>
      </fieldset>
    </>
  );
}

function defaultForType(type: ArticleSchemaField["type"]): string {
  if (type === "boolean") {
    return "false";
  }
  return "";
}
function parseDefault(
  type: ArticleSchemaField["type"],
  raw: string,
): unknown | undefined {
  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }
  if (type === "boolean") {
    return trimmed === "true";
  }
  if (type === "number") {
    const value = Number(trimmed);
    return Number.isFinite(value) ? value : undefined;
  }
  if (type === "string[]") {
    return trimmed
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return trimmed;
}
function defaultToInput(
  type: ArticleSchemaField["type"],
  value: unknown,
): string {
  if (value === undefined || value === null) {
    return "";
  }
  if (type === "string[]" && Array.isArray(value)) {
    return value.join(", ");
  }
  return String(value);
}

function applyLoadedSettings(
  loaded: {
    driveResult: Awaited<ReturnType<typeof fetchSharedDrives>>;
    folderResult: Awaited<ReturnType<typeof fetchFolderTree>>;
    sharedFolderResult:
      | Awaited<ReturnType<typeof fetchSharedFolders>>
      | { data: FolderRecord[]; ok: true };
    sourceResult: Awaited<ReturnType<typeof fetchArticleSourceSettings>>;
  },
  apply: {
    setDrives: (drives: SharedDriveSummary[]) => void;
    setError: (error: string) => void;
    setFolders: (folders: FolderRecord[]) => void;
    setSharedFolders: (folders: FolderRecord[]) => void;
    setSharedSources: (sources: ArticleSource[]) => void;
    setSources: (sources: ArticleSource[]) => void;
  },
) {
  if (loaded.driveResult.ok) {
    apply.setDrives(
      loaded.driveResult.data.filter((drive) => drive.role === "manager"),
    );
  }
  if (loaded.sourceResult.ok) {
    apply.setSources(loaded.sourceResult.data.sources);
    apply.setSharedSources(loaded.sourceResult.data.shared);
  } else {
    apply.setError(loaded.sourceResult.error);
    apply.setSources([]);
    apply.setSharedSources([]);
  }
  if (loaded.folderResult.ok) {
    apply.setFolders(loaded.folderResult.data);
  } else {
    apply.setError(loaded.folderResult.error);
  }
  if (loaded.sharedFolderResult.ok) {
    apply.setSharedFolders(loaded.sharedFolderResult.data);
  } else {
    apply.setError(loaded.sharedFolderResult.error);
  }
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: 主体の切り替えと移行を同じ画面に置く。
export function SiteSettingsPage() {
  const { user } = useOutletContext<AppShellContext>();
  const [sources, setSources] = useState<ArticleSource[]>([]);
  const [sharedSources, setSharedSources] = useState<ArticleSource[]>([]);
  const [folders, setFolders] = useState<FolderRecord[]>([]);
  const [sharedFolders, setSharedFolders] = useState<FolderRecord[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [drives, setDrives] = useState<SharedDriveSummary[]>([]);
  const [subjectId, setSubjectId] = useState<string | null>(null);
  const [migrating, setMigrating] = useState<ArticleSource | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeSubject = subjectId ?? user?.id ?? "";
  const driveSubject =
    drives.find(
      (drive) => drive.id === activeSubject && drive.role === "manager",
    ) ?? null;

  async function reload(actorId: string, ownerId: string) {
    const drive = ownerId !== actorId;
    const [sourceResult, folderResult, sharedFolderResult, driveResult] =
      await Promise.all([
        fetchArticleSourceSettings({
          ownerId: drive ? ownerId : undefined,
          viewerId: actorId,
        }),
        fetchFolderTree({
          ownerId: drive ? ownerId : undefined,
          viewerId: actorId,
        }),
        drive
          ? Promise.resolve({
              data: [] as FolderRecord[],
              ok: true as const,
            })
          : fetchSharedFolders({ viewerId: actorId }),
        fetchSharedDrives(),
      ]);
    return { driveResult, folderResult, sharedFolderResult, sourceResult };
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: Preserve the existing request lifecycle.
  useEffect(() => {
    let current = true;
    if (!user) {
      setLoading(false);
      return () => {
        current = false;
      };
    }
    setLoading(true);
    void reload(user.id, subjectId ?? user.id)
      .then((loaded) => {
        if (!current) {
          return;
        }
        applyLoadedSettings(loaded, {
          setDrives,
          setError,
          setFolders,
          setSharedFolders,
          setSharedSources,
          setSources,
        });
      })
      .catch((reason: unknown) => {
        if (current) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      })
      .finally(() => {
        if (current) {
          setLoading(false);
        }
      });
    return () => {
      current = false;
    };
  }, [subjectId, user]);

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Preserve the existing save flow.
  async function handleSave(event: FormEvent) {
    event.preventDefault();
    if (!draft) {
      return;
    }
    if (
      !(
        draft.name.trim() &&
        (draft.id || draft.folder || draft.sharedFolderId || draft.driveRoot)
      )
    ) {
      setError("名前とディレクトリを入力してください。");
      return;
    }
    setSaving(true);
    setError(null);
    const schema = draft.schema
      .filter((field) => field.key.trim())
      .map((field) => {
        const next: ArticleSchemaField = {
          key: field.key.trim(),
          type: field.type,
        };
        if (field.required) {
          next.required = true;
        }
        if (field.fixed) {
          next.fixed = true;
        }
        if (field.enum?.length) {
          next.enum = field.enum;
        }
        const fallback = parseDefault(
          field.type,
          defaultToInput(field.type, field.default),
        );
        if (fallback !== undefined) {
          next.default = fallback;
        }
        return next;
      });
    const driveRootId =
      folders.find((folder) => folder.folder === "")?.id ?? null;
    const folderInput = folderFields(draft, driveSubject ? driveRootId : null);
    const input = {
      ...folderInput,
      name: draft.name.trim(),
      schema,
      ...(driveSubject ? { ownerId: driveSubject.id } : {}),
      updateAudience: draft.sharedFolderId ? "editors" : draft.updateAudience,
      webhookUrl: draft.webhookUrl.trim() || null,
      ...(draft.webhookAuthorization.trim()
        ? { webhookAuthorization: draft.webhookAuthorization.trim() }
        : {}),
    };
    const result = draft.id
      ? await updateArticleSource(draft.id, input)
      : await createArticleSource(input);
    if (!result.ok) {
      setError(result.error);
      setSaving(false);
      return;
    }
    setDraft(null);
    setSaving(false);
    if (user) {
      try {
        const refreshed = await reload(user.id, subjectId ?? user.id);
        if (refreshed.sourceResult.ok) {
          setSources(refreshed.sourceResult.data.sources);
          setSharedSources(refreshed.sourceResult.data.shared);
        }
        if (refreshed.folderResult.ok) {
          setFolders(refreshed.folderResult.data);
        }
        if (refreshed.sharedFolderResult.ok) {
          setSharedFolders(refreshed.sharedFolderResult.data);
        }
      } catch (reason: unknown) {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    }
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Preserve the existing delete flow.
  async function handleDelete(id: string) {
    setError(null);
    const result = await deleteArticleSource(id);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (draft?.id === id) {
      setDraft(null);
    }
    if (user) {
      try {
        const refreshed = await reload(user.id, subjectId ?? user.id);
        if (refreshed.sourceResult.ok) {
          setSources(refreshed.sourceResult.data.sources);
          setSharedSources(refreshed.sourceResult.data.shared);
        }
        if (refreshed.folderResult.ok) {
          setFolders(refreshed.folderResult.data);
        }
        if (refreshed.sharedFolderResult.ok) {
          setSharedFolders(refreshed.sharedFolderResult.data);
        }
      } catch (reason: unknown) {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    }
  }

  function updateField(index: number, patch: Partial<DraftField>) {
    if (!draft) {
      return;
    }
    setDraft({
      ...draft,
      schema: draft.schema.map((field, i) =>
        i === index ? { ...field, ...patch } : field,
      ),
    });
  }
  if (!user) {
    return (
      <section>
        <h2 className="m-0 text-[1.5em] font-bold">サイト設定</h2>
        <ErrorText>サイト設定を変更するにはログインしてください。</ErrorText>
      </section>
    );
  }
  const editableShared = sharedFolders.filter((folder) => folder.canEdit);
  const managerDrives = drives.filter((drive) => drive.role === "manager");
  const canPickSourceFolder = driveSubject
    ? folders.length > 0
    : hasSelectableSourceFolders(folders) || editableShared.length > 0;
  const listed = [
    ...sources.map((source) => ({ shared: false, source })),
    ...(driveSubject
      ? []
      : sharedSources.map((source) => ({ shared: true, source }))),
  ];
  return (
    <section>
      <h2 className="m-0 text-[1.5em] font-bold">サイト設定</h2>
      {managerDrives.length > 0 && (
        <Field htmlFor="site-subject" label="主体">
          <Select
            className="w-full rounded-lg px-3 py-2.5"
            id="site-subject"
            onChange={(event) => {
              setSubjectId(event.target.value);
              setDraft(null);
            }}
            value={driveSubject?.id ?? user.id}
          >
            <option value={user.id}>マイドライブ</option>
            {managerDrives.map((drive) => (
              <option key={drive.id} value={drive.id}>
                {drive.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <p>
        ディレクトリを記事コレクションとして公開します。メタデータはノート先頭の
        YAML frontmatter です。Astro は PAT で{" "}
        <code className="font-mono">/api/articles</code> と{" "}
        <code className="font-mono">/openapi.json</code> を読めます。Webhook
        はヘッダーの「サイトを更新」から送ります。
        {driveSubject
          ? "実行できる人は、管理者だけか、管理者と編集者かをソースごとに選べます。設定を変えられるのは管理者です。ドライブ全体もソースにできます。"
          : "押せる人は、自分のみか、そのフォルダを編集できる人かをソースごとに選べます。閲覧だけの人は押せません。編集できる共有フォルダも選べます。"}
      </p>
      {error && <ErrorText>{error}</ErrorText>}
      {loading ? (
        <p>読み込み中…</p>
      ) : (
        <ul className="list-none p-0">
          {listed.length === 0 && (
            <li>
              <MutedText>記事ソースはまだありません。</MutedText>
            </li>
          )}
          {listed.map(({ shared, source }) => (
            <li
              className="flex justify-between gap-4 border-b border-border py-3 max-[640px]:flex-col max-[640px]:items-start"
              key={source.id}
            >
              <div>
                <strong>{source.name}</strong>
                <MutedText className="mt-1">
                  {sourcePlace(source, shared)}
                </MutedText>
              </div>
              <Row>
                <Button
                  onClick={() =>
                    setDraft(
                      draftFromSource(source, shared, Boolean(driveSubject)),
                    )
                  }
                  variant="outline"
                >
                  編集
                </Button>
                {!(driveSubject || shared) && managerDrives.length > 0 && (
                  <Button
                    onClick={() => setMigrating(source)}
                    variant="outline"
                  >
                    共有ドライブへ移す
                  </Button>
                )}
                <Button
                  onClick={() => void handleDelete(source.id)}
                  variant="ghost"
                >
                  削除
                </Button>
              </Row>
            </li>
          ))}
        </ul>
      )}
      {!draft && (
        <Button
          className="mt-4"
          disabled={!canPickSourceFolder}
          onClick={() =>
            setDraft({
              ...emptyDraft(),
              driveRoot: Boolean(driveSubject),
              updateAudience: driveSubject ? "managers" : "self",
            })
          }
          variant="accent"
        >
          ソースを追加
        </Button>
      )}
      {!(draft || canPickSourceFolder) && (
        <MutedText className="mt-2">先にフォルダを作成してください。</MutedText>
      )}
      {draft && (
        <form
          className="mt-6 grid gap-4"
          onSubmit={(event) => void handleSave(event)}
        >
          <h3 className="m-0 text-[1.15rem] font-semibold">
            {draft.id ? "ソースを編集" : "ソースを追加"}
          </h3>
          <Field htmlFor="source-name" label="名前">
            <Input
              id="source-name"
              onChange={(event) =>
                setDraft({ ...draft, name: event.target.value })
              }
              placeholder="お知らせ"
              value={draft.name}
            />
          </Field>
          {driveSubject ? (
            <DriveAudienceFields
              draft={draft}
              folders={folders}
              onChange={setDraft}
            />
          ) : (
            <SourceAudienceFields
              draft={draft}
              editableShared={editableShared}
              folders={folders}
              onChange={setDraft}
              sharedFolders={sharedFolders}
            />
          )}
          <div>
            <p className="m-0 mb-2 text-[0.85rem] text-muted">
              スキーマ（新規ノートの frontmatter と形式チェック）
            </p>
            <div className="grid gap-3">
              {draft.schema.map((field, index) => (
                <div
                  className="grid gap-2 rounded-xl border border-border p-3"
                  key={field.rowId}
                >
                  <Row className="max-[640px]:flex-col">
                    <Input
                      className="flex-1"
                      onChange={(event) =>
                        updateField(index, { key: event.target.value })
                      }
                      placeholder="key"
                      value={field.key}
                    />
                    <Select
                      className="rounded-lg px-3 py-2.5"
                      onChange={(event) =>
                        updateField(index, {
                          default: undefined,
                          type: event.target
                            .value as ArticleSchemaField["type"],
                        })
                      }
                      value={field.type}
                    >
                      {ARTICLE_FIELD_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ))}
                    </Select>
                    <Button
                      onClick={() =>
                        setDraft({
                          ...draft,
                          schema: draft.schema.filter((_, i) => i !== index),
                        })
                      }
                      variant="ghost"
                    >
                      削除
                    </Button>
                  </Row>
                  <Input
                    onChange={(event) =>
                      updateField(index, {
                        default: parseDefault(field.type, event.target.value),
                      })
                    }
                    placeholder={
                      field.type === "string[]"
                        ? "default（カンマ区切り）"
                        : "default"
                    }
                    value={defaultToInput(field.type, field.default)}
                  />
                  {field.type === "string" && (
                    <Input
                      onChange={(event) =>
                        updateField(index, {
                          enum: event.target.value
                            .split(",")
                            .map((item) => item.trim())
                            .filter(Boolean),
                        })
                      }
                      placeholder="enum（カンマ区切り、任意）"
                      value={(field.enum ?? []).join(", ")}
                    />
                  )}
                  <Row>
                    <CheckLabel>
                      <input
                        checked={Boolean(field.required)}
                        onChange={(event) =>
                          updateField(index, {
                            required: event.target.checked,
                          })
                        }
                        type="checkbox"
                      />
                      必須
                    </CheckLabel>
                    <CheckLabel>
                      <input
                        checked={Boolean(field.fixed)}
                        onChange={(event) =>
                          updateField(index, { fixed: event.target.checked })
                        }
                        type="checkbox"
                      />
                      固定
                    </CheckLabel>
                  </Row>
                </div>
              ))}
            </div>
            <Button
              className="mt-2"
              onClick={() =>
                setDraft({
                  ...draft,
                  schema: [
                    ...draft.schema,
                    {
                      default: defaultForType("string"),
                      key: "",
                      rowId: newRowId(),
                      type: "string",
                    },
                  ],
                })
              }
              variant="outline"
            >
              フィールドを追加
            </Button>
          </div>
          <Field htmlFor="webhook-url" label="Webhook URL">
            <Input
              id="webhook-url"
              onChange={(event) =>
                setDraft({ ...draft, webhookUrl: event.target.value })
              }
              placeholder="https://api.github.com/repos/org/repo/dispatches"
              type="url"
              value={draft.webhookUrl}
            />
            <MutedText>
              URL を変えたときは、Authorization
              を入れ直してください。空のまま保存すると消えます。
            </MutedText>
          </Field>
          <Field htmlFor="webhook-auth" label="Webhook Authorization">
            <Input
              autoComplete="off"
              id="webhook-auth"
              onChange={(event) =>
                setDraft({
                  ...draft,
                  webhookAuthorization: event.target.value,
                })
              }
              placeholder={
                draft.webhookAuthorizationSet
                  ? "設定済み（変更するときだけ入力）"
                  : "Bearer ghp_..."
              }
              type="password"
              value={draft.webhookAuthorization}
            />
          </Field>
          <Row>
            <Button disabled={saving} type="submit" variant="accent">
              {saving ? "保存中…" : "保存"}
            </Button>
            <Button onClick={() => setDraft(null)} variant="ghost">
              キャンセル
            </Button>
          </Row>
        </form>
      )}
      {migrating && managerDrives.length > 0 && (
        <SiteMigrateDialog
          drives={managerDrives}
          onClose={() => setMigrating(null)}
          onMoved={(driveId) => {
            setMigrating(null);
            setDraft(null);
            setSubjectId(driveId);
          }}
          source={migrating}
        />
      )}
    </section>
  );
}
