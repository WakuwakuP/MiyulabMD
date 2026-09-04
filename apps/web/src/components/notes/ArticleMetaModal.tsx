import type {
  ArticleMeta,
  ArticleSchemaField,
  ArticleSource,
} from "@miyulabmd/shared";
import { coerceArticleValue } from "@miyulabmd/shared";
import { type FormEvent, useState } from "react";
import { Button } from "../ui/Button.tsx";
import { Field } from "../ui/Field.tsx";
import { Input } from "../ui/Input.tsx";
import { Modal, ModalFooter, ModalHeader } from "../ui/Modal.tsx";
import { Select } from "../ui/Select.tsx";
import { ErrorText, MutedText } from "../ui/Text.tsx";

type Props = {
  source: ArticleSource;
  value: ArticleMeta;
  saving?: boolean;
  error?: string | null;
  disabled?: boolean;
  onSave: (meta: ArticleMeta) => void;
  onClose: () => void;
};

function fieldValue(field: ArticleSchemaField, meta: ArticleMeta): string {
  const raw = meta[field.key];
  if (raw === undefined || raw === null) {
    if (field.default !== undefined) {
      return Array.isArray(field.default)
        ? field.default.join(", ")
        : String(field.default);
    }
    if (field.enum && field.enum.length > 0) return field.enum[0] ?? "";
    return "";
  }
  if (Array.isArray(raw)) return raw.join(", ");
  if (typeof raw === "boolean") return raw ? "true" : "false";
  return String(raw);
}

function parseField(
  field: ArticleSchemaField,
  raw: string,
): unknown | undefined {
  if (field.type === "string[]") {
    return raw
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (field.type === "boolean") return raw === "true";
  if (field.type === "number") {
    const trimmed = raw.trim();
    if (!trimmed) return undefined;
    const value = Number(trimmed);
    return Number.isFinite(value) ? value : undefined;
  }
  return raw.trim() || undefined;
}

export function ArticleMetaModal({
  source,
  value,
  saving,
  error,
  disabled,
  onSave,
  onClose,
}: Props) {
  const [draft, setDraft] = useState<ArticleMeta>({ ...value });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const next: ArticleMeta = {};
    for (const field of source.schema) {
      if (field.fixed) continue;
      const parsed = parseField(field, fieldValue(field, draft));
      const coerced = coerceArticleValue(field.type, parsed, field.enum);
      if (coerced !== undefined) next[field.key] = coerced;
    }
    onSave(next);
  }

  return (
    <Modal
      as="form"
      labelledBy="article-meta-title"
      onClose={onClose}
      onSubmit={handleSubmit}
    >
      <ModalHeader id="article-meta-title" title="記事メタ" onClose={onClose}>
        <MutedText>
          {source.name}（{source.folder}）
        </MutedText>
      </ModalHeader>

      {source.schema.length === 0 && (
        <MutedText>このソースにスキーマはありません。</MutedText>
      )}

      <div className="grid gap-3">
        {source.schema.map((field) => (
          <Field
            key={field.key}
            label={field.key}
            htmlFor={`meta-${field.key}`}
          >
            {field.enum && field.enum.length > 0 ? (
              <Select
                id={`meta-${field.key}`}
                className="w-full rounded-lg px-3 py-2.5"
                value={fieldValue(field, draft)}
                disabled={disabled || field.fixed || saving}
                onChange={(event) =>
                  setDraft({ ...draft, [field.key]: event.target.value })
                }
              >
                {field.enum.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </Select>
            ) : field.type === "boolean" ? (
              <Select
                id={`meta-${field.key}`}
                className="w-full rounded-lg px-3 py-2.5"
                value={fieldValue(field, draft) || "false"}
                disabled={disabled || field.fixed || saving}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    [field.key]: event.target.value === "true",
                  })
                }
              >
                <option value="true">true</option>
                <option value="false">false</option>
              </Select>
            ) : (
              <Input
                id={`meta-${field.key}`}
                value={fieldValue(field, draft)}
                disabled={disabled || field.fixed || saving}
                placeholder={
                  field.type === "string[]" ? "カンマ区切り" : field.type
                }
                onChange={(event) =>
                  setDraft({ ...draft, [field.key]: event.target.value })
                }
              />
            )}
            {field.fixed && <MutedText>このフィールドは固定です。</MutedText>}
          </Field>
        ))}
      </div>

      {error && <ErrorText>{error}</ErrorText>}

      <ModalFooter>
        <Button variant="ghost" type="button" onClick={onClose}>
          閉じる
        </Button>
        <Button variant="accent" type="submit" disabled={disabled || saving}>
          {saving ? "保存中…" : "保存"}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
