import {
  ACCESS_SCOPE_HINTS,
  ACCESS_SCOPE_LABELS,
  ACCESS_SCOPES,
  clampWriteScope,
  type AccessGrant,
  type AccessScope,
} from "@miyulabmd/shared";
import { useEffect, useState, type FormEvent } from "react";
import type { AccessDraft } from "./AccessPanel.tsx";

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
  return ACCESS_SCOPES.filter((scope) => clampWriteScope(readScope, scope) === scope);
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

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  function update(patch: Partial<AccessDraft>) {
    const next = { ...value, ...patch };
    next.writeScope = clampWriteScope(next.readScope, next.writeScope);
    onChange(next);
  }

  function handleAdd(event: FormEvent) {
    event.preventDefault();
    const nextEmail = email.trim().toLowerCase();
    if (!nextEmail || value.grants.some((grant) => grant.email === nextEmail)) return;
    update({
      grants: [...value.grants, { email: nextEmail, userId: null, canWrite: false }],
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
    <div className="share-backdrop" role="presentation" onClick={onClose}>
      <div
        className="share-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="share-modal-header">
          <div>
            <h2 id="share-modal-title">共有</h2>
            <p>{title}</p>
            {subtitle && <p className="share-modal-sub">{subtitle}</p>}
          </div>
          <button type="button" className="share-modal-close" onClick={onClose} aria-label="閉じる">
            ×
          </button>
        </header>

        {showInherit && (
          <label className="share-inherit">
            <input
              type="checkbox"
              checked={value.inherit}
              disabled={disabled}
              onChange={(event) => update({ inherit: event.target.checked })}
            />
            {inheritLabel ?? "親の設定に従う"}
          </label>
        )}

        <form className="share-add" onSubmit={handleAdd}>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="ユーザーを追加"
            disabled={disabled || value.inherit}
            aria-label="共有するユーザーのメールアドレス"
          />
          <button type="submit" disabled={disabled || value.inherit || !email.trim()}>
            送信
          </button>
        </form>

        <section className="share-people">
          <h3>アクセスできるユーザー</h3>
          <ul>
            <li>
              <span className="share-avatar" aria-hidden>
                {ownerLabel.slice(0, 1).toUpperCase()}
              </span>
              <div>
                <strong>{ownerLabel}</strong>
                <p>オーナー</p>
              </div>
              <span className="share-role-static">オーナー</span>
            </li>
            {value.grants.map((grant: AccessGrant) => (
              <li key={grant.email}>
                <span className="share-avatar" aria-hidden>
                  {grant.email.slice(0, 1).toUpperCase()}
                </span>
                <div>
                  <strong>{grant.email}</strong>
                  <p>{grant.canWrite ? "編集者" : "閲覧者"}</p>
                </div>
                <select
                  value={grant.canWrite ? "write" : "read"}
                  disabled={disabled || value.inherit}
                  aria-label={`${grant.email} の役割`}
                  onChange={(event) =>
                    update({
                      grants: value.grants.map((item) =>
                        item.email === grant.email
                          ? { ...item, canWrite: event.target.value === "write" }
                          : item,
                      ),
                    })
                  }
                >
                  <option value="read">閲覧者</option>
                  <option value="write">編集者</option>
                </select>
                <button
                  type="button"
                  className="share-remove"
                  disabled={disabled || value.inherit}
                  onClick={() =>
                    update({ grants: value.grants.filter((item) => item.email !== grant.email) })
                  }
                >
                  削除
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="share-general">
          <h3>一般的なアクセス</h3>
          <div className="share-general-card">
            <span className="share-general-icon" aria-hidden>
              {value.readScope === "public" ? "🔗" : "🔒"}
            </span>
            <div className="share-general-fields">
              <label>
                閲覧
                <select
                  value={value.readScope}
                  disabled={disabled || value.inherit}
                  onChange={(event) => update({ readScope: event.target.value as AccessScope })}
                >
                  {ACCESS_SCOPES.map((scope) => (
                    <option key={scope} value={scope}>
                      {ACCESS_SCOPE_LABELS[scope]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                編集
                <select
                  value={value.writeScope}
                  disabled={disabled || value.inherit}
                  onChange={(event) => update({ writeScope: event.target.value as AccessScope })}
                >
                  {writeOptions(value.readScope).map((scope) => (
                    <option key={scope} value={scope}>
                      {ACCESS_SCOPE_LABELS[scope]}
                    </option>
                  ))}
                </select>
              </label>
              <p>{ACCESS_SCOPE_HINTS[value.readScope]}</p>
            </div>
          </div>
        </section>

        {error && <p className="page-error">{error}</p>}

        <footer className="share-modal-footer">
          <button type="button" className="share-copy" onClick={() => void copyLink()}>
            {copied ? "コピーしました" : "リンクをコピー"}
          </button>
          <button type="button" className="share-done" onClick={onClose}>
            {saving ? "保存中…" : "完了"}
          </button>
        </footer>
      </div>
    </div>
  );
}

export function accessSummary(readScope: AccessScope, writeScope: AccessScope): string {
  return `読み ${ACCESS_SCOPE_LABELS[readScope]} / 書き ${ACCESS_SCOPE_LABELS[writeScope]}`;
}
