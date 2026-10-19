import type { DriveRole, SharedDriveSummary } from "@miyulabmd/shared";
import { useEffect, useState } from "react";
import { fetchSharedDrives } from "../../lib/api.ts";
import { Button } from "../ui/Button.tsx";
import { Modal, ModalHeader } from "../ui/Modal.tsx";
import { ErrorText, MutedText } from "../ui/Text.tsx";

const ROLE_LABEL: Record<DriveRole, string> = {
  editor: "編集者",
  manager: "管理者",
  viewer: "閲覧者",
};

type Props = {
  name: string;
  busy?: boolean;
  error?: string | null;
  onClose: () => void;
  onMove: (destFolderId: string | null) => void;
};

export function DriveMoveDialog({
  name,
  busy = false,
  error,
  onClose,
  onMove,
}: Props) {
  const [drives, setDrives] = useState<SharedDriveSummary[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchSharedDrives().then((result) => {
      if (cancelled) {
        return;
      }
      if (!result.ok) {
        setLoadError(result.error);
        return;
      }
      setDrives(result.data.filter((drive) => drive.role !== "viewer"));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Modal labelledBy="drive-move-title" onClose={onClose}>
      <ModalHeader id="drive-move-title" onClose={onClose} title="移動" />
      <p className="mb-3">{name}</p>
      <MutedText>移動先</MutedText>
      {(error || loadError) && <ErrorText>{error ?? loadError}</ErrorText>}
      <div className="mt-3 flex flex-col items-stretch gap-2">
        <Button
          disabled={busy}
          onClick={() => onMove(null)}
          type="button"
          variant="outline"
        >
          マイドライブ
        </Button>
        {drives.map((drive) => (
          <Button
            disabled={busy}
            key={drive.id}
            onClick={() => onMove(drive.rootFolderId)}
            type="button"
            variant="outline"
          >
            {drive.name}（{ROLE_LABEL[drive.role]}）
          </Button>
        ))}
      </div>
    </Modal>
  );
}
