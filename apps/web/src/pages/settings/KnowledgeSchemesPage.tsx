import { CheckLabel } from "../../components/ui/Field.tsx";
import { ErrorText, MutedText } from "../../components/ui/Text.tsx";
import {
  KNOWLEDGE_FEATURES,
  useKnowledgeFeatureToggle,
} from "../../lib/knowledge-features.ts";

const feature = KNOWLEDGE_FEATURES.schemes;

export function KnowledgeSchemesPage() {
  const { enabled, error, saving, setEnabled } =
    useKnowledgeFeatureToggle("schemes");

  return (
    <section>
      <h2 className="m-0 text-[1.5em] font-bold">{feature.label}</h2>
      <p>{feature.description}</p>
      <CheckLabel>
        <input
          checked={enabled}
          disabled={saving}
          onChange={(event) => void setEnabled(event.target.checked)}
          type="checkbox"
        />
        {feature.label}を有効にする
      </CheckLabel>
      {error && <ErrorText>{error}</ErrorText>}
      {saving && <MutedText className="mt-1">保存中…</MutedText>}
      <MutedText className="mt-3">
        命名規則の設定・解除はフォルダのコンテキストメニュー「命名規則…」から行います。
      </MutedText>
    </section>
  );
}
