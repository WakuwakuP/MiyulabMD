import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import type { EditorMode } from "../../lib/editor-mode.ts";
import { EditorModeSwitch } from "./EditorModeSwitch.tsx";

const meta = {
  title: "Composite/EditorModeSwitch",
  tags: ["autodocs"],
  parameters: { layout: "centered" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Interactive: Story = {
  render: function Render() {
    const [mode, setMode] = useState<EditorMode>("preview");
    return <EditorModeSwitch value={mode} canEdit onChange={setMode} />;
  },
};

export const HiddenWhenReadOnly: Story = {
  render: () => (
    <EditorModeSwitch
      value="preview"
      canEdit={false}
      onChange={() => undefined}
    />
  ),
};
