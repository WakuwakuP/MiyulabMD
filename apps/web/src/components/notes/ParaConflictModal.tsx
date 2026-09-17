import type {
  ParaBucketKey,
  ParaBucketResolution,
  ParaPlan,
} from "@miyulabmd/shared";
import { useEffect, useState } from "react";
import {
  initParaConflicts,
  type ParaConflictItem,
  paraConflictResolutions,
  paraConflictsReady,
  paraPlanConflicts,
  setParaConflictChoice,
  setParaConflictNewName,
} from "../../lib/para-conflict.ts";
import { Button } from "../ui/Button.tsx";
import { Input } from "../ui/Input.tsx";
import { Modal, ModalFooter, ModalHeader } from "../ui/Modal.tsx";
import { ErrorText, MutedText } from "../ui/Text.tsx";

type Props = {
  /** Latest plan — the modal lists its collision rows and resets when it changes. */
  plan: ParaPlan;
  busy?: boolean;
  error?: string | null;
  onSubmit: (
    resolutions: Partial<Record<ParaBucketKey, ParaBucketResolution>>,
  ) => void;
  /** Cancel = back to OFF; nothing is created or renamed. */
  onClose: () => void;
};

function ConflictRow({
  item,
  busy,
  onChoice,
  onNewName,
}: {
  item: ParaConflictItem;
  busy: boolean;
  onChoice: (choice: ParaConflictItem["choice"]) => void;
  onNewName: (name: string) => void;
}) {
  const group = `para-conflict-${item.bucket}`;
  return (
    <div className="mb-3">
      <div className="flex items-baseline gap-2">
        <span className="font-semibold">{item.defaultName}</span>
        <span className="text-xs text-muted">
          既存フォルダ「{item.existingName}」と同名
        </span>
      </div>
      <div className="mt-1 grid gap-1 text-[0.85rem]">
        <label className="flex items-baseline gap-2">
          <input
            checked={item.choice === "rename"}
            disabled={busy}
            name={group}
            onChange={() => onChoice("rename")}
            type="radio"
          />
          <span className="flex flex-wrap items-center gap-1">
            既存フォルダを改名
            <Input
              className="w-40 px-1 py-0.5 text-[0.85rem]"
              disabled={busy || item.choice !== "rename"}
              onChange={(event) => onNewName(event.target.value)}
              onFocus={() => onChoice("rename")}
              type="text"
              value={item.newName}
            />
            して「{item.defaultName}」を新規作成
          </span>
        </label>
        <label className="flex items-baseline gap-2">
          <input
            checked={item.choice === "adopt"}
            disabled={busy}
            name={group}
            onChange={() => onChoice("adopt")}
            type="radio"
          />
          既存「{item.existingName}」を {item.defaultName} バケツとして使う
        </label>
        <label className="flex items-baseline gap-2">
          <input
            checked={item.choice === "skip"}
            disabled={busy}
            name={group}
            onChange={() => onChoice("skip")}
            type="radio"
          />
          {item.defaultName} バケツは作成しない
        </label>
      </div>
    </div>
  );
}

/**
 * §2.4 conflict-resolution modal. Submit sends resolutions to
 * POST /api/para/enable; if the response still has `pending` buckets the
 * caller re-opens this modal with the refreshed plan (loop).
 */
export function ParaConflictModal({
  plan,
  busy = false,
  error,
  onSubmit,
  onClose,
}: Props) {
  const [items, setItems] = useState<ParaConflictItem[]>(() =>
    initParaConflicts(plan),
  );

  // The enable loop re-opens the modal with a fresh plan: rebuild its rows.
  useEffect(() => {
    setItems(initParaConflicts(plan));
  }, [plan]);

  const settled = plan.buckets.filter(
    (bucket) => bucket.status !== "collision",
  );
  const collisions = paraPlanConflicts(plan);

  function close() {
    if (!busy) {
      onClose();
    }
  }

  return (
    <Modal
      as="form"
      className="w-[min(30rem,100%)]"
      labelledBy="para-conflict-title"
      onClose={close}
      onSubmit={(event) => {
        event.preventDefault();
        if (paraConflictsReady(items)) {
          onSubmit(paraConflictResolutions(items));
        }
      }}
    >
      <ModalHeader
        id="para-conflict-title"
        onClose={close}
        title="PARA のセットアップ"
      />
      <MutedText className="mb-3">
        既存のフォルダと名前が重複しています。各項目の対処を選んでください。
      </MutedText>

      {settled.map((bucket) => (
        <p className="m-0 text-[0.8rem] text-muted" key={bucket.bucket}>
          ✓ {bucket.existing?.name ?? bucket.bucket} —{" "}
          {bucket.status === "assigned" ? "割当済み" : "新規作成できます"}
        </p>
      ))}

      {collisions.map((bucket) => {
        const item = items.find((entry) => entry.bucket === bucket.bucket);
        return item ? (
          <ConflictRow
            busy={busy}
            item={item}
            key={item.bucket}
            onChoice={(choice) =>
              setItems(setParaConflictChoice(items, item.bucket, choice))
            }
            onNewName={(name) =>
              setItems(setParaConflictNewName(items, item.bucket, name))
            }
          />
        ) : null;
      })}

      {error && <ErrorText>{error}</ErrorText>}
      <ModalFooter>
        <Button disabled={busy} onClick={close} variant="ghost">
          キャンセル
        </Button>
        <Button
          disabled={busy || !paraConflictsReady(items)}
          type="submit"
          variant="accent"
        >
          {busy ? "適用中…" : "解決して作成"}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
