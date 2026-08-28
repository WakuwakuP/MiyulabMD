import { useEffect, useRef, useState } from "react";
import { normalizeHttpUrl } from "../../lib/http-url.ts";

type Props = {
  title: string;
  initial?: string;
  submitLabel?: string;
  onSubmit: (url: string) => void;
  onClose: () => void;
};

export function LinkModal({ title, initial = "", submitLabel = "挿入", onSubmit, onClose }: Props) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="share-backdrop" role="presentation" onClick={onClose}>
      <form
        className="share-modal link-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="link-modal-title"
        onClick={(event) => event.stopPropagation()}
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
        <header className="share-modal-header">
          <h2 id="link-modal-title">{title}</h2>
          <button type="button" className="share-modal-close" onClick={onClose} aria-label="閉じる">
            ×
          </button>
        </header>
        <label className="link-modal-field">
          <span>URL</span>
          <input
            ref={inputRef}
            type="url"
            inputMode="url"
            placeholder="https://example.com"
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              setError(null);
            }}
          />
        </label>
        {error && <p className="page-error">{error}</p>}
        <footer className="share-modal-footer">
          <button type="button" className="share-copy" onClick={onClose}>
            キャンセル
          </button>
          <button type="submit" className="share-done">
            {submitLabel}
          </button>
        </footer>
      </form>
    </div>
  );
}
