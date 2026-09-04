import { type FormEvent, useEffect, useState } from "react";
import { useOutletContext } from "react-router";
import type { AppShellContext } from "../../components/layout/AppShellContext.ts";
import { Button } from "../../components/ui/Button.tsx";
import { Field, Row } from "../../components/ui/Field.tsx";
import { Input } from "../../components/ui/Input.tsx";
import { ErrorText, MutedText } from "../../components/ui/Text.tsx";
import { updateProfile } from "../../lib/api.ts";

export function ProfileSettingsPage() {
  const { user, setUser } = useOutletContext<AppShellContext>();
  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDisplayName(user?.displayName ?? "");
  }, [user?.displayName]);

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);

    const result = await updateProfile(displayName.trim() || null);
    if (!result.ok) {
      setError(
        result.status === 401
          ? "表示名を保存するにはログインが必要です。"
          : result.error,
      );
      setSaving(false);
      return;
    }

    setUser(result.data);
    setSaving(false);
    setSaved(true);
  }

  return (
    <section>
      <h2 className="m-0 text-[1.5em] font-bold">ユーザー設定</h2>
      <p>
        共同編集中のカーソル名に使います。空欄ならメールアドレスを表示します。必須ではありません。
      </p>
      {user ? (
        <form onSubmit={(event) => void handleSave(event)}>
          <Field label="表示名" htmlFor="display-name">
            <Row className="mt-[0.35rem] max-[640px]:flex-col">
              <Input
                id="display-name"
                className="flex-1"
                type="text"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder={user.email}
                disabled={saving}
              />
              <Button variant="outline" type="submit" disabled={saving}>
                {saving ? "保存中…" : "保存"}
              </Button>
            </Row>
          </Field>
          {saved && <MutedText className="mt-1">保存しました。</MutedText>}
          {error && <ErrorText>{error}</ErrorText>}
        </form>
      ) : (
        <ErrorText>表示名を設定するにはログインしてください。</ErrorText>
      )}
    </section>
  );
}
