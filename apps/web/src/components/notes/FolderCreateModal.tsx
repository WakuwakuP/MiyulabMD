import { useEffect, useRef, useState } from "react";
import { Button } from "../ui/Button.tsx";
import { Field } from "../ui/Field.tsx";
import { Input } from "../ui/Input.tsx";
import { Modal, ModalFooter, ModalHeader } from "../ui/Modal.tsx";
import { ErrorText } from "../ui/Text.tsx";

type Props = {
  title?: string;
  submitLabel?: string;
  busyLabel?: string;
  initialName?: string;
  busy?: boolean;
  error?: string | null;
  onSubmit: (name: string) => void;
  onClose: () => void;
};

export function FolderCreateModal({
  title = "フォルダを作成",
  submitLabel = "作成",
  busyLabel = "作成中…",
  initialName = "",
  busy = false,
  error,
  onSubmit,
  onClose,
}: Props) {
  const [name, setName] = useState(initialName);
  const [localError, setLocalError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    if (initialName) input.select();
  }, [initialName]);

  function close() {
    if (!busy) onClose();
  }

  return (
    <Modal
      as="form"
      labelledBy="folder-name-title"
      className="w-[min(26rem,100%)]"
      onClose={close}
      onSubmit={(event) => {
        event.preventDefault();
        const next = name.trim();
        if (!next) {
          setLocalError("フォルダ名を入力してください。");
          return;
        }
        onSubmit(next);
      }}
    >
      <ModalHeader id="folder-name-title" title={title} onClose={close} />
      <Field label="フォルダ名">
        <Input
          ref={inputRef}
          className="w-full"
          type="text"
          value={name}
          placeholder="例: work"
          disabled={busy}
          onChange={(event) => {
            setName(event.target.value);
            setLocalError(null);
          }}
        />
      </Field>
      {(localError || error) && <ErrorText>{localError ?? error}</ErrorText>}
      <ModalFooter>
        <Button variant="ghost" disabled={busy} onClick={close}>
          キャンセル
        </Button>
        <Button variant="accent" type="submit" disabled={busy || !name.trim()}>
          {busy ? busyLabel : submitLabel}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
