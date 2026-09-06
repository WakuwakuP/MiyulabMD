import type { Meta, StoryObj } from "@storybook/react-vite";
import { MarkdownPreview } from "./MarkdownPreview.tsx";
import { EDITOR_STORY_SAMPLE } from "./storySample.ts";

const meta = {
  parameters: { layout: "padded" },
  tags: ["autodocs"],
  title: "Editor/MarkdownPreview",
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

function Preview() {
  return (
    <div className="max-w-3xl bg-canvas text-ink">
      <MarkdownPreview documentScroll={true} markdown={EDITOR_STORY_SAMPLE} />
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
