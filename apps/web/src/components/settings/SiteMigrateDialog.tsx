import type {
  ArticleSource,
  FolderRecord,
  MoveFolderResult,
  SharedDriveSummary,
} from "@miyulabmd/shared";
import { useEffect, useState } from "react";
import { fetchFolderTree, migrateArticleSource } from "../../lib/api.ts";
import { Button } from "../ui/Button.tsx";
import { Field } from "../ui/Field.tsx";
import { Modal, ModalHeader } from "../ui/Modal.tsx";
import { Select } from "../ui/Select.tsx";
import { ErrorText, MutedText } from "../ui/Text.tsx";

type Props = {
  drives: SharedDriveSummary[];
  source: ArticleSource;
  onClose: () => void;
  onMoved: (driveId: string) => void;
};

function audienceLabel(value: string): string {
  if (value === "self") {
    return "自分のみ";
  }
  if (value === "editors") {
    return "編集できる人";
  }
  if (value === "managers") {
    return "管理者のみ";
  }
  if (value === "managers_or_editors") {
    return "管理者または編集者";
  }
  return value;
}

function folderLabel(folder: FolderRecord, driveName: string): string {
  return folder.folder ? folder.folder : `${driveName}（ルート）`;
}

export function SiteMigrateDialog({ drives, source, onClose, onMoved }: Props) {
  const [driveId, setDriveId] = useState(drives[0]?.id ?? "");
  const [folders, setFolders] = useState<FolderRecord[]>([]);
  const [destFolderId, setDestFolderId] = useState("");
  const [preview, setPreview] = useState<MoveFolderResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const drive = drives.find((item) => item.id === driveId) ?? null;

  useEffect(() => {
    if (!driveId) {
      return;
    }
    let current = true;
    setFolders([]);
    setDestFolderId("");
    setPreview(null);
    void fetchFolderTree({ ownerId: driveId }).then((result) => {
      if (!current) {
        return;
      }
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setFolders(result.data);
      const root = result.data.find((folder) => folder.folder === "");
      setDestFolderId(root?.id ?? result.data[0]?.id ?? "");
    });
    return () => {
      current = false;
    };
  }, [driveId]);

  async function run(dryRun: boolean) {
    if (!destFolderId) {
      setError("移動先を選んでください。");
      return;
    }
    setBusy(true);
    setError(null);
    const result = await migrateArticleSource(source.id, {
      destFolderId,
      dryRun,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (dryRun) {
      setPreview(result.data);
      return;
    }
    onMoved(driveId);
  }

  return (
    <Modal labelledBy="site-migrate-title" onClose={onClose}>
      <ModalHeader
        id="site-migrate-title"
        onClose={onClose}
        title="共有ドライブへ移す"
      />
      <p className="mt-2">
        「{source.name}」のフォルダとノート、Webhook
        を移します。公開範囲や共有は外れ、実行できる人は共有ドライブの役割に読み替わります。
      </p>
      {error && <ErrorText>{error}</ErrorText>}
      <div className="mt-4 grid gap-3">
        <Field htmlFor="migrate-drive" label="移行先">
          <Select
            className="w-full rounded-lg px-3 py-2.5"
            id="migrate-drive"
            onChange={(event) => setDriveId(event.target.value)}
            value={driveId}
          >
            {drives.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field htmlFor="migrate-folder" label="置き場所">
          <Select
            className="w-full rounded-lg px-3 py-2.5"
            id="migrate-folder"
            onChange={(event) => {
              setDestFolderId(event.target.value);
              setPreview(null);
            }}
            value={destFolderId}
          >
            {folders.map((folder) => (
              <option key={folder.id} value={folder.id}>
                {folderLabel(folder, drive?.name ?? "共有ドライブ")}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {preview && (
        <div className="mt-4 grid gap-1">
          <MutedText>
            {preview.from} を {preview.to} へ移します。ノート{" "}
            {preview.plan.notes}
            件、記事ソース {preview.plan.articleSources} 件。
          </MutedText>
          {(preview.audienceTranslations ?? []).map((item) => (
            <MutedText key={`${item.from}:${item.to}`}>
              実行できる人: {audienceLabel(item.from)} →{" "}
              {audienceLabel(item.to)}
            </MutedText>
          ))}
          {preview.plan.stripped && (
            <MutedText>
              外れるもの: 公開範囲 {preview.plan.stripped.policies}、共有{" "}
              {preview.plan.stripped.grants}、メダリオン{" "}
              {preview.plan.stripped.medallion}、PARA{" "}
              {preview.plan.stripped.para}
              、命名規則 {preview.plan.stripped.scheme}
            </MutedText>
          )}
        </div>
      )}
      <div className="mt-4 flex gap-2">
        <Button
          disabled={busy || !destFolderId}
          onClick={() => void run(true)}
          variant="outline"
        >
          内容を確認
        </Button>
        <Button
          disabled={busy || !preview}
          onClick={() => void run(false)}
          variant="accent"
        >
          {busy ? "移動中…" : "移す"}
        </Button>
        <Button onClick={onClose} variant="ghost">
          キャンセル
        </Button>
      </div>
    </Modal>
  );
}
