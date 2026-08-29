import { useEffect, useRef, useState } from "react";
import { normalizeHttpUrl } from "../../lib/http-url.ts";
import { Button } from "../ui/Button.tsx";
import { Field } from "../ui/Field.tsx";
import { Input } from "../ui/Input.tsx";
import { Modal, ModalFooter, ModalHeader } from "../ui/Modal.tsx";
import { ErrorText } from "../ui/Text.tsx";

type Props = {
  title: string;
  initial?: string;
  submitLabel?: string;
  onSubmit: (url: string) => void;
  onClose: () => void;
};

export function LinkModal({
  title,
  initial = "",
  submitLabel = "挿入",
  onSubmit,
  onClose,
}: Props) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <Modal
      as="form"
      labelledBy="link-modal-title"
      className="w-[min(26rem,100%)]"
      onClose={onClose}
      onSubmit={(event) => {
        event.preventDefault();
        const url = normalizeHttpUrl(value);
        if (!url) {
          setError("http(s) の URL を入力してください");
          return;
        }
        onSubmit(url);
      }}
    >
      <ModalHeader id="link-modal-title" title={title} onClose={onClose} />
      <Field label="URL">
        <Input
          ref={inputRef}
          className="w-full"
          type="url"
          inputMode="url"
          placeholder="https://example.com"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setError(null);
          }}
        />
      </Field>
      {error && <ErrorText>{error}</ErrorText>}
      <ModalFooter>
        <Button variant="ghost" onClick={onClose}>
          キャンセル
        </Button>
        <Button variant="accent" type="submit">
          {submitLabel}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
