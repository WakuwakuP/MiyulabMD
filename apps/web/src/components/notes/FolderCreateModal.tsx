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
    if (!input) {
      return;
    }
    input.focus();
    if (initialName) {
      input.select();
    }
  }, [initialName]);

  function close() {
    if (!busy) {
      onClose();
    }
  }

  return (
    <Modal
      as="form"
      className="w-[min(26rem,100%)]"
      labelledBy="folder-name-title"
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
      <ModalHeader id="folder-name-title" onClose={close} title={title} />
      <Field label="フォルダ名">
        <Input
          className="w-full"
          disabled={busy}
          onChange={(event) => {
            setName(event.target.value);
            setLocalError(null);
          }}
          placeholder="例: work"
          ref={inputRef}
          type="text"
          value={name}
        />
      </Field>
      {(localError || error) && <ErrorText>{localError ?? error}</ErrorText>}
      <ModalFooter>
        <Button disabled={busy} onClick={close} variant="ghost">
          キャンセル
        </Button>
        <Button disabled={busy || !name.trim()} type="submit" variant="accent">
          {busy ? busyLabel : submitLabel}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
