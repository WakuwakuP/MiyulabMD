import {
  ACCESS_SCOPE_HINTS,
  ACCESS_SCOPE_LABELS,
  ACCESS_SCOPES,
  type AccessGrant,
  type AccessScope,
  clampWriteScope,
} from "@miyulabmd/shared";
import { type FormEvent, useState } from "react";
import { colorForEmail } from "../../lib/user-style.ts";
import { Avatar } from "../ui/Avatar.tsx";
import { Button } from "../ui/Button.tsx";
import { CheckLabel, Row } from "../ui/Field.tsx";
import { Input } from "../ui/Input.tsx";
import { Modal, ModalFooter, ModalHeader } from "../ui/Modal.tsx";
import { Select } from "../ui/Select.tsx";
import { ErrorText, MutedText, SectionTitle } from "../ui/Text.tsx";
import { type AccessDraft, accessScopeSelectClass } from "./AccessPanel.tsx";

type Props = {
  title: string;
  subtitle?: string;
  linkUrl: string;
  ownerLabel: string;
  value: AccessDraft;
  showInherit?: boolean;
  inheritLabel?: string;
  disabled?: boolean;
  saving?: boolean;
  error?: string | null;
  onChange: (next: AccessDraft) => void;
  onClose: () => void;
};

function writeOptions(readScope: AccessScope): AccessScope[] {
  return ACCESS_SCOPES.filter(
    (scope) => clampWriteScope(readScope, scope) === scope,
  );
}

export function ShareModal({
  title,
  subtitle,
  linkUrl,
  ownerLabel,
  value,
  showInherit = false,
  inheritLabel,
  disabled,
  saving,
  error,
  onChange,
  onClose,
}: Props) {
  const [email, setEmail] = useState("");
  const [copied, setCopied] = useState(false);

  function update(patch: Partial<AccessDraft>) {
    const next = { ...value, ...patch };
    next.writeScope = clampWriteScope(next.readScope, next.writeScope);
    onChange(next);
  }

  function handleAdd(event: FormEvent) {
    event.preventDefault();
    const nextEmail = email.trim().toLowerCase();
    if (!nextEmail || value.grants.some((grant) => grant.email === nextEmail)) {
      return;
    }
    update({
      grants: [
        ...value.grants,
        { canWrite: false, email: nextEmail, userId: null },
      ],
    });
    setEmail("");
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(linkUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Modal labelledBy="share-modal-title" onClose={onClose}>
      <ModalHeader id="share-modal-title" onClose={onClose} title="共有">
        <p className="mt-[0.15rem] mb-0">{title}</p>
        {subtitle && <MutedText className="mt-[0.15rem]">{subtitle}</MutedText>}
      </ModalHeader>

      {showInherit && (
        <CheckLabel className="mb-[0.85rem]">
          <input
            checked={value.inherit}
            disabled={disabled}
            onChange={(event) => update({ inherit: event.target.checked })}
            type="checkbox"
          />
          {inheritLabel ?? "親の設定に従う"}
        </CheckLabel>
      )}

      <form className="mb-[1.1rem]" onSubmit={handleAdd}>
        <Row className="max-[520px]:flex-col">
          <Input
            aria-label="共有するユーザーのメールアドレス"
            className="flex-1"
            disabled={disabled || value.inherit}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="ユーザーを追加"
            type="email"
            value={email}
            variant="pill"
          />
          <Button
            disabled={disabled || value.inherit || !email.trim()}
            type="submit"
          >
            送信
          </Button>
        </Row>
      </form>

      <section>
        <SectionTitle>アクセスできるユーザー</SectionTitle>
        <ul className="mb-4 list-none p-0">
          <li className="grid grid-cols-[2rem_minmax(0,1fr)_auto_auto] items-center gap-[0.65rem] py-[0.45rem] max-[520px]:grid-cols-[2rem_minmax(0,1fr)]">
            <Avatar
              color={colorForEmail(ownerLabel)}
              name={ownerLabel}
              variant="soft"
            />
            <div>
              <strong>{ownerLabel}</strong>
              <MutedText className="text-[0.8rem]">オーナー</MutedText>
            </div>
            <span className="text-[0.85rem] text-muted">オーナー</span>
          </li>
          {value.grants.map((grant: AccessGrant) => (
            <li
              className="grid grid-cols-[2rem_minmax(0,1fr)_auto_auto] items-center gap-[0.65rem] py-[0.45rem] max-[520px]:grid-cols-[2rem_minmax(0,1fr)]"
              key={grant.email}
            >
              <Avatar
                color={colorForEmail(grant.email)}
                name={grant.email}
                variant="soft"
              />
              <div>
                <strong>{grant.email}</strong>
                <MutedText className="text-[0.8rem]">
                  {grant.canWrite ? "編集者" : "閲覧者"}
                </MutedText>
              </div>
              <Select
                aria-label={`${grant.email} の役割`}
                disabled={disabled || value.inherit}
                onChange={(event) =>
                  update({
                    grants: value.grants.map((item) =>
                      item.email === grant.email
                        ? { ...item, canWrite: event.target.value === "write" }
                        : item,
                    ),
                  })
                }
                value={grant.canWrite ? "write" : "read"}
              >
                <option value="read">閲覧者</option>
                <option value="write">編集者</option>
              </Select>
              <button
                className="cursor-pointer border-0 bg-transparent text-muted disabled:cursor-default disabled:opacity-65"
                disabled={disabled || value.inherit}
                onClick={() =>
                  update({
                    grants: value.grants.filter(
                      (item) => item.email !== grant.email,
                    ),
                  })
                }
                type="button"
              >
                削除
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <SectionTitle>一般的なアクセス</SectionTitle>
        <div className="flex gap-3 rounded-[10px] border border-border bg-surface p-[0.85rem]">
          <span aria-hidden={true} className="text-xl">
            {value.readScope === "public" && "🌐"}
            {value.readScope === "link" && "🔗"}
            {value.readScope !== "public" && value.readScope !== "link" && "🔒"}
          </span>
          <div className="grid flex-1 gap-[0.45rem]">
            <label className="flex items-center justify-between gap-3">
              閲覧
              <Select
                className={accessScopeSelectClass}
                disabled={disabled || value.inherit}
                onChange={(event) =>
                  update({ readScope: event.target.value as AccessScope })
                }
                value={value.readScope}
              >
                {ACCESS_SCOPES.map((scope) => (
                  <option key={scope} value={scope}>
                    {ACCESS_SCOPE_LABELS[scope]}
                  </option>
                ))}
              </Select>
            </label>
            <label className="flex items-center justify-between gap-3">
              編集
              <Select
                className={accessScopeSelectClass}
                disabled={disabled || value.inherit}
                onChange={(event) =>
                  update({ writeScope: event.target.value as AccessScope })
                }
                value={value.writeScope}
              >
                {writeOptions(value.readScope).map((scope) => (
                  <option key={scope} value={scope}>
                    {ACCESS_SCOPE_LABELS[scope]}
                  </option>
                ))}
              </Select>
            </label>
            <MutedText className="mt-1 text-[0.8rem]">
              {ACCESS_SCOPE_HINTS[value.readScope]}
            </MutedText>
          </div>
        </div>
      </section>

      {error && <ErrorText>{error}</ErrorText>}

      <ModalFooter>
        <Button onClick={() => void copyLink()} variant="ghost">
          {copied ? "コピーしました" : "リンクをコピー"}
        </Button>
        <Button onClick={onClose} variant="accent">
          {saving ? "保存中…" : "完了"}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

export function accessSummary(
  readScope: AccessScope,
  writeScope: AccessScope,
): string {
  return `読み ${ACCESS_SCOPE_LABELS[readScope]} / 書き ${ACCESS_SCOPE_LABELS[writeScope]}`;
}
