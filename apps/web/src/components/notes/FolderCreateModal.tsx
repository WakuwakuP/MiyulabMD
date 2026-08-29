import { useEffect, useRef, useState } from "react";
import { Button } from "../ui/Button.tsx";
import { Field } from "../ui/Field.tsx";
import { Input } from "../ui/Input.tsx";
import { Modal, ModalFooter, ModalHeader } from "../ui/Modal.tsx";
import { ErrorText } from "../ui/Text.tsx";

type Props = {
  busy?: boolean;
  error?: string | null;
  onSubmit: (name: string) => void;
  onClose: () => void;
};

export function FolderCreateModal({
  busy = false,
  error,
  onSubmit,
  onClose,
}: Props) {
  const [name, setName] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function close() {
    if (!busy) onClose();
  }

  return (
    <Modal
      as="form"
      labelledBy="folder-create-title"
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
      <ModalHeader
        id="folder-create-title"
        title="フォルダを作成"
        onClose={close}
      />
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
          {busy ? "作成中…" : "作成"}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
