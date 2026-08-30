import {
  ACCESS_SCOPE_LABELS,
  ACCESS_SCOPES,
  type AccessGrant,
  type AccessScope,
  clampWriteScope,
} from "@miyulabmd/shared";
import { type FormEvent, useState } from "react";
import { cn } from "../../lib/cn.ts";
import { Button } from "../ui/Button.tsx";
import { CheckLabel, Row } from "../ui/Field.tsx";
import { Input } from "../ui/Input.tsx";
import { Select } from "../ui/Select.tsx";
import { MutedText } from "../ui/Text.tsx";

export type AccessDraft = {
  inherit: boolean;
  readScope: AccessScope;
  writeScope: AccessScope;
  grants: AccessGrant[];
};

/** Longest scope label is 指定ユーザーのみ / ログイン済みのみ. */
export const accessScopeSelectClass = "w-[11rem] shrink-0";

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
  return ACCESS_SCOPES.filter(
    (scope) => clampWriteScope(readScope, scope) === scope,
  );
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
  const needsUsers =
    value.readScope === "users" || value.writeScope === "users";

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
      grants: [
        ...value.grants,
        {
          email: nextEmail,
          userId: null,
          canWrite: value.writeScope !== "self",
        },
      ],
    });
    setEmail("");
  }

  return (
    <fieldset className="m-[0.75rem_0_0] border-0 p-0" disabled={disabled}>
      <legend className="p-0 font-semibold">{title}</legend>
      {showInherit && (
        <CheckLabel className="my-2">
          <input
            type="checkbox"
            checked={value.inherit}
            onChange={(event) => update({ inherit: event.target.checked })}
          />
          {inheritLabel}
        </CheckLabel>
      )}
      {value.inherit && sourceLabel && (
        <MutedText className="mb-2">{sourceLabel}</MutedText>
      )}
      <div className="flex flex-wrap gap-x-5 gap-y-3">
        <label className="flex items-center gap-[0.4rem]">
          読み取り
          <Select
            className={cn("ml-[0.35rem]", accessScopeSelectClass)}
            value={value.readScope}
            disabled={value.inherit}
            onChange={(event) =>
              update({ readScope: event.target.value as AccessScope })
            }
          >
            {ACCESS_SCOPES.map((scope) => (
              <option key={scope} value={scope}>
                {ACCESS_SCOPE_LABELS[scope]}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex items-center gap-[0.4rem]">
          書き込み
          <Select
            className={cn("ml-[0.35rem]", accessScopeSelectClass)}
            value={value.writeScope}
            disabled={value.inherit}
            onChange={(event) =>
              update({ writeScope: event.target.value as AccessScope })
            }
          >
            {writeOptions(value.readScope).map((scope) => (
              <option key={scope} value={scope}>
                {ACCESS_SCOPE_LABELS[scope]}
              </option>
            ))}
          </Select>
        </label>
      </div>
      {needsUsers && (
        <div className="mt-3">
          <p className="mb-[0.35rem] mt-0">指定ユーザー</p>
          <form className="mb-2" onSubmit={handleAddGrant}>
            <Row>
              <Input
                className="flex-1"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="user@example.com"
                disabled={disabled}
              />
              <Button type="submit" disabled={disabled || !email.trim()}>
                追加
              </Button>
            </Row>
          </form>
          {value.grants.length === 0 ? (
            <MutedText>まだ指定されていません。</MutedText>
          ) : (
            <ul className="m-0 list-none p-0">
              {value.grants.map((grant) => (
                <li
                  key={grant.email}
                  className="flex flex-wrap items-center gap-3 border-b border-border py-[0.35rem]"
                >
                  <span>{grant.email}</span>
                  <CheckLabel>
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
                  </CheckLabel>
                  <Button
                    variant="ghost"
                    onClick={() =>
                      update({
                        grants: value.grants.filter(
                          (item) => item.email !== grant.email,
                        ),
                      })
                    }
                  >
                    削除
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </fieldset>
  );
}

export function accessSummary(
  readScope: AccessScope,
  writeScope: AccessScope,
): string {
  return `読み ${ACCESS_SCOPE_LABELS[readScope]} / 書き ${ACCESS_SCOPE_LABELS[writeScope]}`;
}
