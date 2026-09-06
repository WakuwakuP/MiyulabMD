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
      className="w-[min(26rem,100%)]"
      labelledBy="link-modal-title"
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
      <ModalHeader id="link-modal-title" onClose={onClose} title={title} />
      <Field label="URL">
        <Input
          className="w-full"
          inputMode="url"
          onChange={(event) => {
            setValue(event.target.value);
            setError(null);
          }}
          placeholder="https://example.com"
          ref={inputRef}
          type="url"
          value={value}
        />
      </Field>
      {error && <ErrorText>{error}</ErrorText>}
      <ModalFooter>
        <Button onClick={onClose} variant="ghost">
          キャンセル
        </Button>
        <Button type="submit" variant="accent">
          {submitLabel}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
