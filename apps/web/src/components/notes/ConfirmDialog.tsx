import { useEffect } from "react";

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
  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [busy, onClose]);

  return (
    <div className="share-backdrop" role="presentation" onClick={() => !busy && onClose()}>
      <div
        className="share-modal confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="share-modal-header">
          <h2 id="confirm-dialog-title">{title}</h2>
        </header>
        <p className="confirm-dialog-message">{message}</p>
        {error && <p className="page-error">{error}</p>}
        <footer className="share-modal-footer">
          <button type="button" className="share-copy" disabled={busy} onClick={onClose}>
            {cancelLabel}
          </button>
          <button type="button" className="confirm-dialog-danger" disabled={busy} onClick={onConfirm}>
            {busy ? "削除中…" : confirmLabel}
          </button>
        </footer>
      </div>
    </div>
  );
}
