import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useState } from "react";
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";
import { MarkdownEditor } from "./MarkdownEditor.tsx";

const SAMPLE = `# 行番号の確認

ダークモードでは gutter が Canvas に揃う。

- リスト項目
- もう一行

\`\`\`ts
const ready = true;
\`\`\`

最終行。
`;

function StoryMarkdownEditor({
  lineNumbers = true,
}: {
  lineNumbers?: boolean;
}) {
  const [session] = useState(() => {
    const doc = new Y.Doc();
    const yText = doc.getText("markdown");
    yText.insert(0, SAMPLE);
    const provider = new WebsocketProvider(
      "ws://127.0.0.1",
      "storybook-markdown-editor",
      doc,
      { connect: false },
    );
    return { doc, yText, provider };
  });

  useEffect(() => {
    return () => {
      session.provider.destroy();
      session.doc.destroy();
    };
  }, [session]);

  return (
    <div className="max-w-3xl bg-canvas text-ink">
      <MarkdownEditor
        noteId="storybook"
        yText={session.yText}
        awareness={session.provider.awareness}
        lineNumbers={lineNumbers}
      />
    </div>
  );
}

const meta = {
  title: "Editor/MarkdownEditor",
  tags: ["autodocs"],
  parameters: { layout: "padded" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const LineNumbers: Story = {
  globals: { colorScheme: "light" },
  render: () => <StoryMarkdownEditor />,
};

export const LineNumbersDark: Story = {
  globals: { colorScheme: "dark" },
  render: () => <StoryMarkdownEditor />,
};
