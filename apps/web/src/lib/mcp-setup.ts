export const MCP_TOKEN_PLACEHOLDER = "YOUR_TOKEN";

export const MCP_AGENT_IDS = [
  "cursor",
  "claude-code",
  "claude-desktop",
  "vscode",
  "codex",
  "windsurf",
] as const;

export type McpAgentId = (typeof MCP_AGENT_IDS)[number];

export type McpAgentSnippet = {
  label: string;
  value: string;
};

export type McpAgentGuide = {
  id: McpAgentId;
  label: string;
  intro: string;
  paths: string[];
  snippets: McpAgentSnippet[];
};

function prettyJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function mcpEndpointUrl(origin: string): string {
  return `${origin.replace(/\/$/, "")}/mcp`;
}

export function mcpAuthorizationHeader(token: string): string {
  return `Bearer ${token}`;
}

function remoteHttpServer(origin: string, token: string) {
  return {
    url: mcpEndpointUrl(origin),
    headers: {
      Authorization: mcpAuthorizationHeader(token),
    },
  };
}

export function mcpCursorConfig(origin: string, token: string): string {
  return prettyJson({
    mcpServers: {
      miyulabmd: remoteHttpServer(origin, token),
    },
  });
}

export function mcpClaudeCodeCommand(origin: string, token: string): string {
  return [
    "claude mcp add --transport http miyulabmd \\",
    `  ${mcpEndpointUrl(origin)} \\`,
    `  --header "Authorization: ${mcpAuthorizationHeader(token)}"`,
    "",
  ].join("\n");
}

export function mcpClaudeCodeConfig(origin: string, token: string): string {
  return prettyJson({
    mcpServers: {
      miyulabmd: {
        type: "http",
        ...remoteHttpServer(origin, token),
      },
    },
  });
}

export function mcpClaudeDesktopConfig(origin: string, token: string): string {
  return prettyJson({
    mcpServers: {
      miyulabmd: {
        command: "npx",
        args: [
          "-y",
          "mcp-remote",
          mcpEndpointUrl(origin),
          "--header",
          `Authorization:\${AUTH_HEADER}`,
        ],
        env: {
          AUTH_HEADER: mcpAuthorizationHeader(token),
        },
      },
    },
  });
}

export function mcpVsCodeConfig(origin: string, token: string): string {
  return prettyJson({
    servers: {
      miyulabmd: {
        type: "http",
        ...remoteHttpServer(origin, token),
      },
    },
  });
}

export function mcpCodexConfig(origin: string, token: string): string {
  return [
    "[mcp_servers.miyulabmd]",
    `url = "${mcpEndpointUrl(origin)}"`,
    "",
    "[mcp_servers.miyulabmd.http_headers]",
    `Authorization = "${mcpAuthorizationHeader(token)}"`,
    "",
  ].join("\n");
}

export function mcpWindsurfConfig(origin: string, token: string): string {
  return prettyJson({
    mcpServers: {
      miyulabmd: {
        serverUrl: mcpEndpointUrl(origin),
        headers: {
          Authorization: mcpAuthorizationHeader(token),
        },
      },
    },
  });
}

const builders: Record<
  McpAgentId,
  (origin: string, token: string) => McpAgentSnippet[]
> = {
  cursor: (origin, token) => [
    { label: "mcp.json", value: mcpCursorConfig(origin, token) },
  ],
  "claude-code": (origin, token) => [
    { label: "コマンド", value: mcpClaudeCodeCommand(origin, token) },
    { label: ".mcp.json", value: mcpClaudeCodeConfig(origin, token) },
  ],
  "claude-desktop": (origin, token) => [
    {
      label: "claude_desktop_config.json",
      value: mcpClaudeDesktopConfig(origin, token),
    },
  ],
  vscode: (origin, token) => [
    { label: "mcp.json", value: mcpVsCodeConfig(origin, token) },
  ],
  codex: (origin, token) => [
    { label: "config.toml", value: mcpCodexConfig(origin, token) },
  ],
  windsurf: (origin, token) => [
    { label: "mcp_config.json", value: mcpWindsurfConfig(origin, token) },
  ],
};

const catalog: Record<McpAgentId, Omit<McpAgentGuide, "snippets">> = {
  cursor: {
    id: "cursor",
    label: "Cursor",
    intro:
      "設定 → MCP に追加するか、次のファイルに貼って MCP を再読み込みしてください。",
    paths: ["~/.cursor/mcp.json", ".cursor/mcp.json"],
  },
  "claude-code": {
    id: "claude-code",
    label: "Claude Code",
    intro:
      "ターミナルでコマンドを実行するか、プロジェクトの .mcp.json / ユーザー設定に貼ってください。接続後は /mcp で確認できます。",
    paths: [".mcp.json", "~/.claude.json"],
  },
  "claude-desktop": {
    id: "claude-desktop",
    label: "Claude Desktop",
    intro:
      "設定 → Developer → Edit Config で開き、次を追加して Claude を再起動してください。リモート HTTP は mcp-remote 経由です（npx が必要）。",
    paths: [
      "~/Library/Application Support/Claude/claude_desktop_config.json",
      "%APPDATA%\\Claude\\claude_desktop_config.json",
    ],
  },
  vscode: {
    id: "vscode",
    label: "VS Code",
    intro:
      "コマンドパレットの「MCP: Add Server」を使うか、次のファイルに貼ってください。Copilot は Agent モードで使います。ルートキーは servers です。",
    paths: [".vscode/mcp.json"],
  },
  codex: {
    id: "codex",
    label: "Codex",
    intro:
      "~/.codex/config.toml またはプロジェクトの .codex/config.toml に追記し、Codex を再起動してください。CLI / IDE / ChatGPT デスクトップで共有されます。",
    paths: ["~/.codex/config.toml", ".codex/config.toml"],
  },
  windsurf: {
    id: "windsurf",
    label: "Windsurf",
    intro:
      "Cascade → Manage MCPs から追加するか、次のファイルに貼って Refresh してください。リモートは serverUrl です（url ではありません）。",
    paths: ["~/.codeium/windsurf/mcp_config.json"],
  },
};

export function mcpAgentLabel(id: McpAgentId): string {
  return catalog[id].label;
}

export function mcpAgentGuide(
  id: McpAgentId,
  origin: string,
  token = MCP_TOKEN_PLACEHOLDER,
): McpAgentGuide {
  return {
    ...catalog[id],
    snippets: builders[id](origin, token),
  };
}
