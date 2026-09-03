import type { Meta, StoryObj } from "@storybook/react-vite";
import { MarkdownPreview } from "./MarkdownPreview.tsx";
import { EDITOR_STORY_SAMPLE } from "./storySample.ts";

const meta = {
  title: "Editor/MarkdownPreview",
  tags: ["autodocs"],
  parameters: { layout: "padded" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

function Preview() {
  return (
    <div className="max-w-3xl bg-canvas text-ink">
      <MarkdownPreview markdown={EDITOR_STORY_SAMPLE} documentScroll />
    </div>
  );
}

export const Default: Story = {
  globals: { colorScheme: "light" },
  render: () => <Preview />,
};

export const Dark: Story = {
  globals: { colorScheme: "dark" },
  render: () => <Preview />,
};

export const Black: Story = {
  globals: { colorScheme: "black" },
  render: () => <Preview />,
};
