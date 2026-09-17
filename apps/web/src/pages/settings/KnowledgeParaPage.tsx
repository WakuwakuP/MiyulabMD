import { CheckLabel } from "../../components/ui/Field.tsx";
import { ErrorText, MutedText } from "../../components/ui/Text.tsx";
import {
  KNOWLEDGE_FEATURES,
  useKnowledgeFeatureToggle,
} from "../../lib/knowledge-features.ts";

const feature = KNOWLEDGE_FEATURES.para;

export function KnowledgeParaPage() {
  const { enabled, error, saving, setEnabled } =
    useKnowledgeFeatureToggle("para");

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

      <h3 className="mt-6 text-[1.1em] font-bold">スペース管理（後続実装）</h3>
      <MutedText>
        スペースの一覧・追加・バケツのセットアップは後続の実装でここに表示されます。
      </MutedText>
    </section>
  );
}
