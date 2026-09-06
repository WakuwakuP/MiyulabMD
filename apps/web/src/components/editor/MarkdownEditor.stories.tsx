import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useState } from "react";
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";
import { MarkdownEditor } from "./MarkdownEditor.tsx";
import { EDITOR_STORY_SAMPLE } from "./storySample.ts";

function StoryMarkdownEditor({
  lineNumbers = true,
}: {
  lineNumbers?: boolean;
}) {
  const [session] = useState(() => {
    const doc = new Y.Doc();
    const yText = doc.getText("markdown");
    yText.insert(0, EDITOR_STORY_SAMPLE);
    const provider = new WebsocketProvider(
      "ws://127.0.0.1",
      "storybook-markdown-editor",
      doc,
      { connect: false },
    );
    return { doc, provider, yText };
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
        awareness={session.provider.awareness}
        lineNumbers={lineNumbers}
        noteId="storybook"
        yText={session.yText}
      />
    </div>
  );
}

const meta = {
  parameters: { layout: "padded" },
  tags: ["autodocs"],
  title: "Editor/MarkdownEditor",
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

export const LineNumbersBlack: Story = {
  globals: { colorScheme: "black" },
  render: () => <StoryMarkdownEditor />,
};
