import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useState } from "react";
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";
import { RichMarkdownEditor } from "./RichMarkdownEditor.tsx";
import { EDITOR_STORY_SAMPLE } from "./storySample.ts";

function StoryRichEditor() {
  const [session] = useState(() => {
    const doc = new Y.Doc();
    const yText = doc.getText("markdown");
    yText.insert(0, EDITOR_STORY_SAMPLE);
    const provider = new WebsocketProvider(
      "ws://127.0.0.1",
      "storybook-rich-editor",
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
    <div className="min-h-[28rem] max-w-3xl bg-canvas text-ink">
      <RichMarkdownEditor
        awareness={session.provider.awareness}
        noteId="storybook"
        yText={session.yText}
      />
    </div>
  );
}

const meta = {
  parameters: { layout: "padded" },
  tags: ["autodocs"],
  title: "Editor/RichMarkdownEditor",
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  globals: { colorScheme: "light" },
  render: () => <StoryRichEditor />,
};

export const Dark: Story = {
  globals: { colorScheme: "dark" },
  render: () => <StoryRichEditor />,
};

export const Black: Story = {
  globals: { colorScheme: "black" },
  render: () => <StoryRichEditor />,
};
