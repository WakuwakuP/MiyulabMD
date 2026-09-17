import { CheckLabel } from "../../components/ui/Field.tsx";
import { ErrorText, MutedText } from "../../components/ui/Text.tsx";
import {
  KNOWLEDGE_FEATURES,
  useKnowledgeFeatureToggle,
} from "../../lib/knowledge-features.ts";

const feature = KNOWLEDGE_FEATURES.layers;

export function KnowledgeLayersPage() {
  const { enabled, error, saving, setEnabled } =
    useKnowledgeFeatureToggle("layers");

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
        無効化してもノート単位の編集ロックは残ります（層は表示ラベルのみで、ロックは別機能です）。
        層セットの管理とフォルダ一覧は後続の実装でここに表示されます。
      </MutedText>
    </section>
  );
}
