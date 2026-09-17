import type {
  ParaBucketKey,
  ParaBucketResolution,
  ParaPlan,
} from "@miyulabmd/shared";
import { PARA_BUCKETS } from "@miyulabmd/shared";
import { useCallback, useEffect, useState } from "react";
import { ParaConflictModal } from "../../components/notes/ParaConflictModal.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { CheckLabel } from "../../components/ui/Field.tsx";
import { ErrorText, MutedText } from "../../components/ui/Text.tsx";
import { enablePara, fetchParaPlan } from "../../lib/api.ts";
import {
  KNOWLEDGE_FEATURES,
  useKnowledgeFeatureToggle,
} from "../../lib/knowledge-features.ts";
import { paraPlanConflicts } from "../../lib/para-conflict.ts";

const feature = KNOWLEDGE_FEATURES.para;

const BUCKET_LABELS: Record<ParaBucketKey, string> = {
  archives: "Archives（アーカイブ）",
  areas: "Areas（継続領域）",
  projects: "Projects（進行中のプロジェクト）",
  resources: "Resources（参照資料）",
};

function bucketStatusText(bucket: ParaPlan["buckets"][number]): string {
  switch (bucket.status) {
    case "assigned":
      return `割当済み: ${bucket.existing?.name ?? ""}`;
    case "vacant":
      return "未作成（セットアップで作成されます）";
    case "collision":
      return `「${bucket.existing?.name ?? ""}」が未割当で存在 — 要解決`;
  }
}

function BucketStatus({ plan }: { plan: ParaPlan }) {
  return (
    <ul className="m-0 list-none p-0">
      {PARA_BUCKETS.map((def) => {
        const bucket = plan.buckets.find((entry) => entry.bucket === def.key);
        return (
          <li
            className="flex items-baseline justify-between gap-3 border-b border-border py-1.5 text-[0.9rem] last:border-b-0"
            key={def.key}
          >
            <span>{BUCKET_LABELS[def.key]}</span>
            <MutedText className="text-[0.8rem]">
              {bucket ? bucketStatusText(bucket) : "未作成"}
            </MutedText>
          </li>
        );
      })}
    </ul>
  );
}

export function KnowledgeParaPage() {
  const { enabled, error, saving, setEnabled } =
    useKnowledgeFeatureToggle("para");
  const [plan, setPlan] = useState<ParaPlan | null>(null);
  const [conflictPlan, setConflictPlan] = useState<ParaPlan | null>(null);
  const [setupBusy, setSetupBusy] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);

  const refreshPlan = useCallback(async () => {
    const result = await fetchParaPlan();
    if (result.ok) {
      setPlan(result.data);
    }
  }, []);

  // バケツ充足状況は有効時のみ表示。ミラーではなくサーバーの実在を見る。
  useEffect(() => {
    if (enabled) {
      void refreshPlan();
    } else {
      setPlan(null);
    }
  }, [enabled, refreshPlan]);

  /**
   * POST /api/para/enable。残り衝突があればモーダルを開き直してループ。
   * 全バケツが assigned か skip 済みになったら true。
   */
  const runEnable = useCallback(
    async (
      resolutions?: Partial<Record<ParaBucketKey, ParaBucketResolution>>,
    ): Promise<boolean> => {
      setSetupBusy(true);
      setSetupError(null);
      const result = await enablePara({ resolutions });
      setSetupBusy(false);
      if (!result.ok) {
        setSetupError(result.error);
        return false;
      }
      setPlan(result.data.plan);
      if (result.data.pending.length > 0) {
        setConflictPlan(result.data.plan);
        return false;
      }
      setConflictPlan(null);
      return true;
    },
    [],
  );

  const onToggle = useCallback(
    async (next: boolean) => {
      setSetupError(null);
      if (!next) {
        await setEnabled(false);
        return;
      }
      // ON: まず副作用のない plan で衝突を検査する。
      setSetupBusy(true);
      const planResult = await fetchParaPlan();
      setSetupBusy(false);
      if (!planResult.ok) {
        setSetupError(planResult.error);
        return;
      }
      setPlan(planResult.data);
      if (paraPlanConflicts(planResult.data).length > 0) {
        setConflictPlan(planResult.data);
        return;
      }
      if (await runEnable()) {
        await setEnabled(true);
      }
    },
    [runEnable, setEnabled],
  );

  const busy = saving || setupBusy;
  const needsSetup =
    enabled === true && plan?.buckets.some((b) => b.status !== "assigned");

  return (
    <section>
      <h2 className="m-0 text-[1.5em] font-bold">{feature.label}</h2>
      <p>{feature.description}</p>
      <CheckLabel>
        <input
          checked={enabled}
          disabled={busy}
          onChange={(event) => void onToggle(event.target.checked)}
          type="checkbox"
        />
        {feature.label}を有効にする
      </CheckLabel>
      {(error || setupError) && <ErrorText>{error ?? setupError}</ErrorText>}
      {busy && <MutedText className="mt-1">処理中…</MutedText>}

      {enabled && (
        <>
          <h3 className="mt-6 text-[1.1em] font-bold">バケツ充足状況</h3>
          {plan ? (
            <BucketStatus plan={plan} />
          ) : (
            <MutedText>読み込み中…</MutedText>
          )}
          {needsSetup && (
            <Button
              className="mt-3"
              disabled={busy}
              onClick={() => void onToggle(true)}
              variant="outline"
            >
              不足バケツをセットアップ
            </Button>
          )}
          <MutedText className="mt-4">
            無効化してもフォルダや割当は残り、ホームの PARA
            セクションとアーカイブメニューが隠れるだけです。
          </MutedText>
        </>
      )}

      {conflictPlan && (
        <ParaConflictModal
          busy={setupBusy || saving}
          error={setupError}
          onClose={() => setConflictPlan(null)}
          onSubmit={(resolutions) => {
            void (async () => {
              if (await runEnable(resolutions)) {
                await setEnabled(true);
              }
            })();
          }}
          plan={conflictPlan}
        />
      )}
    </section>
  );
}
