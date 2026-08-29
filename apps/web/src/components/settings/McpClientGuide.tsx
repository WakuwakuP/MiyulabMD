import { useState } from "react";
import {
  MCP_AGENT_IDS,
  MCP_TOKEN_PLACEHOLDER,
  type McpAgentId,
  mcpAgentGuide,
  mcpAgentLabel,
} from "../../lib/mcp-setup.ts";
import { Button } from "../ui/Button.tsx";
import { MutedText, SectionTitle } from "../ui/Text.tsx";
import { CopyValueButton } from "./CopyValueButton.tsx";

type Props = {
  origin: string;
  token?: string | null;
};

export function McpClientGuide({ origin, token }: Props) {
  const [agent, setAgent] = useState<McpAgentId>("cursor");
  const guide = mcpAgentGuide(agent, origin, token ?? MCP_TOKEN_PLACEHOLDER);

  return (
    <div className="mt-4">
      <SectionTitle>クライアント別セットアップ</SectionTitle>
      <div
        className="flex flex-wrap gap-1.5"
        role="tablist"
        aria-label="MCP クライアント"
      >
        {MCP_AGENT_IDS.map((id) => {
          const selected = id === agent;
          return (
            <Button
              key={id}
              variant={selected ? "outline" : "ghost"}
              aria-pressed={selected}
              onClick={() => setAgent(id)}
            >
              {mcpAgentLabel(id)}
            </Button>
          );
        })}
      </div>

      <MutedText className="mt-3">{guide.intro}</MutedText>
      {guide.paths.length > 0 && (
        <ul className="mt-2 list-none p-0">
          {guide.paths.map((path) => (
            <li key={path}>
              <code className="font-mono text-[0.8rem]">{path}</code>
            </li>
          ))}
        </ul>
      )}
      {!token && (
        <MutedText className="mt-2">
          トークンは発行直後に一度だけ表示されます。下の{" "}
          <code className="font-mono">{MCP_TOKEN_PLACEHOLDER}</code>{" "}
          をその値に置き換えてください。
        </MutedText>
      )}

      {guide.snippets.map((snippet) => (
        <div key={snippet.label} className="mt-3">
          <SectionTitle>{snippet.label}</SectionTitle>
          <pre className="m-0 overflow-x-auto rounded-md bg-code px-3 py-2 font-mono text-[0.8rem] whitespace-pre-wrap">
            {snippet.value}
          </pre>
          <div className="mt-2">
            <CopyValueButton value={snippet.value} />
          </div>
        </div>
      ))}
    </div>
  );
}
