import {
  ACCESS_SCOPE_LABELS,
  ACCESS_SCOPES,
  clampWriteScope,
  type AccessGrant,
  type AccessScope,
} from "@miyulabmd/shared";
import { useState, type FormEvent } from "react";

export type AccessDraft = {
  inherit: boolean;
  readScope: AccessScope;
  writeScope: AccessScope;
  grants: AccessGrant[];
};

type Props = {
  title: string;
  inheritLabel: string;
  sourceLabel?: string;
  value: AccessDraft;
  disabled?: boolean;
  showInherit?: boolean;
  onChange: (next: AccessDraft) => void;
};

function writeOptions(readScope: AccessScope): AccessScope[] {
  return ACCESS_SCOPES.filter((scope) => clampWriteScope(readScope, scope) === scope);
}

export function AccessPanel({
  title,
  inheritLabel,
  sourceLabel,
  value,
  disabled,
  showInherit = true,
  onChange,
}: Props) {
  const [email, setEmail] = useState("");
  const needsUsers = value.readScope === "users" || value.writeScope === "users";

  function update(patch: Partial<AccessDraft>) {
    const next = { ...value, ...patch };
    next.writeScope = clampWriteScope(next.readScope, next.writeScope);
    onChange(next);
  }

  function handleAddGrant(event: FormEvent) {
    event.preventDefault();
    const nextEmail = email.trim().toLowerCase();
    if (!nextEmail || value.grants.some((grant) => grant.email === nextEmail)) {
      return;
    }
    update({
      grants: [...value.grants, { email: nextEmail, userId: null, canWrite: value.writeScope !== "self" }],
    });
    setEmail("");
  }

  return (
    <fieldset className="access-panel" disabled={disabled}>
      <legend>{title}</legend>
      {showInherit && (
        <label className="access-inherit">
          <input
            type="checkbox"
            checked={value.inherit}
            onChange={(event) => update({ inherit: event.target.checked })}
          />
          {inheritLabel}
        </label>
      )}
      {value.inherit && sourceLabel && <p className="access-source">{sourceLabel}</p>}
      <div className="access-scopes">
        <label>
          読み取り
          <select
            value={value.readScope}
            disabled={value.inherit}
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
          書き込み
          <select
            value={value.writeScope}
            disabled={value.inherit}
            onChange={(event) => update({ writeScope: event.target.value as AccessScope })}
          >
            {writeOptions(value.readScope).map((scope) => (
              <option key={scope} value={scope}>
                {ACCESS_SCOPE_LABELS[scope]}
              </option>
            ))}
          </select>
        </label>
      </div>
      {needsUsers && (
        <div className="access-grants">
          <p>指定ユーザー</p>
          <form className="access-grant-add" onSubmit={handleAddGrant}>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="user@example.com"
              disabled={disabled}
            />
            <button type="submit" disabled={disabled || !email.trim()}>
              追加
            </button>
          </form>
          {value.grants.length === 0 ? (
            <p className="token-meta">まだ指定されていません。</p>
          ) : (
            <ul>
              {value.grants.map((grant) => (
                <li key={grant.email}>
                  <span>{grant.email}</span>
                  <label>
                    <input
                      type="checkbox"
                      checked={grant.canWrite}
                      onChange={(event) =>
                        update({
                          grants: value.grants.map((item) =>
                            item.email === grant.email
                              ? { ...item, canWrite: event.target.checked }
                              : item,
                          ),
                        })
                      }
                    />
                    書き込み
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      update({ grants: value.grants.filter((item) => item.email !== grant.email) })
                    }
                  >
                    削除
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </fieldset>
  );
}

export function accessSummary(readScope: AccessScope, writeScope: AccessScope): string {
  return `読み ${ACCESS_SCOPE_LABELS[readScope]} / 書き ${ACCESS_SCOPE_LABELS[writeScope]}`;
}
