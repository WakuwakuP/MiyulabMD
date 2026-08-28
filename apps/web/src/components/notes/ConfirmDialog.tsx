import { useCallback } from "react";
import { Button } from "../ui/Button.tsx";
import { Modal, ModalFooter, ModalHeader } from "../ui/Modal.tsx";
import { ErrorText } from "../ui/Text.tsx";

type Props = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onClose: () => void;
};

export function ConfirmDialog({
  title,
  message,
  confirmLabel = "削除",
  cancelLabel = "キャンセル",
  busy = false,
  error,
  onConfirm,
  onClose,
}: Props) {
  const close = useCallback(() => {
    if (!busy) onClose();
  }, [busy, onClose]);

  return (
    <Modal labelledBy="confirm-dialog-title" className="w-[min(26rem,100%)]" onClose={close}>
      <ModalHeader id="confirm-dialog-title" title={title} />
      <p className="mb-4 mt-0">{message}</p>
      {error && <ErrorText>{error}</ErrorText>}
      <ModalFooter>
        <Button variant="ghost" disabled={busy} onClick={close}>
          {cancelLabel}
        </Button>
        <Button variant="danger" disabled={busy} onClick={onConfirm}>
          {busy ? "削除中…" : confirmLabel}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
