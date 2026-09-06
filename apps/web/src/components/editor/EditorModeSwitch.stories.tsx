import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import type { EditorMode } from "../../lib/editor-mode.ts";
import { EditorModeSwitch } from "./EditorModeSwitch.tsx";

const meta = {
  parameters: { layout: "centered" },
  tags: ["autodocs"],
  title: "Editor/EditorModeSwitch",
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Interactive: Story = {
  render: function Render() {
    const [mode, setMode] = useState<EditorMode>("preview");
    return <EditorModeSwitch canEdit={true} onChange={setMode} value={mode} />;
  },
};

export const HiddenWhenReadOnly: Story = {
  render: () => (
    <EditorModeSwitch
      canEdit={false}
      onChange={() => undefined}
      value="preview"
    />
  ),
};
