import type { SessionUser } from "@miyulabmd/shared";
import { useCallback, useEffect, useState } from "react";
import {
  dispatchArticleSource,
  fetchArticleSourceStatus,
} from "../../lib/api.ts";
import { HeaderButton } from "../ui/HeaderButton.tsx";
import { RefreshIcon } from "../ui/icons.tsx";

export function SitePublishButton({ user }: { user: SessionUser | null }) {
  const [dirtyIds, setDirtyIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!user) {
      setDirtyIds([]);
      return;
    }
    const result = await fetchArticleSourceStatus();
    if (!result.ok) {
      setDirtyIds([]);
      return;
    }
    setDirtyIds(
      result.data.sources
        .filter((source) => source.dirty)
        .map((source) => source.id),
    );
  }, [user]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === "visible") void reload();
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [reload]);

  if (!user || dirtyIds.length === 0) return null;

  async function handleClick() {
    setBusy(true);
    setError(null);
    for (const id of dirtyIds) {
      const result = await dispatchArticleSource(id);
      if (!result.ok) {
        setError(result.error);
        setBusy(false);
        return;
      }
    }
    await reload();
    setBusy(false);
  }

  return (
    <span className="relative">
      <HeaderButton
        variant="outline"
        icon={<RefreshIcon />}
        label={busy ? "更新中…" : "サイトを更新"}
        disabled={busy}
        onClick={() => void handleClick()}
      />
      {error && (
        <span className="absolute top-full right-0 z-50 mt-1 max-w-[16rem] rounded-md bg-canvas px-2 py-1 text-[0.75rem] text-error shadow-modal">
          {error}
        </span>
      )}
    </span>
  );
}
