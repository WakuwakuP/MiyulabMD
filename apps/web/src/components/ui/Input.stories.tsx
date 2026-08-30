import type { Meta, StoryObj } from "@storybook/react-vite";
import { Input } from "./Input.tsx";

const meta = {
  title: "UI/Input",
  component: Input,
  tags: ["autodocs"],
} satisfies Meta<typeof Input>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    placeholder: "ノートタイトル",
    defaultValue: "",
  },
};

export const Pill: Story = {
  args: {
    variant: "pill",
    type: "email",
    placeholder: "email",
    defaultValue: "dev@example.com",
  },
};

export const Disabled: Story = {
  args: {
    placeholder: "編集不可",
    disabled: true,
  },
};
