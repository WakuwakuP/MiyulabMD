import type { Meta, StoryObj } from "@storybook/react-vite";
import { Input } from "./Input.tsx";

const meta = {
  component: Input,
  tags: ["autodocs"],
  title: "UI/Input",
} satisfies Meta<typeof Input>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    defaultValue: "",
    placeholder: "ノートタイトル",
  },
};

export const Pill: Story = {
  args: {
    defaultValue: "dev@example.com",
    placeholder: "email",
    type: "email",
    variant: "pill",
  },
};

export const Disabled: Story = {
  args: {
    disabled: true,
    placeholder: "編集不可",
  },
};
