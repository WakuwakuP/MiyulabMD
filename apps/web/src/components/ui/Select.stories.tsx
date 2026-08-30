import type { Meta, StoryObj } from "@storybook/react-vite";
import { Select } from "./Select.tsx";

const meta = {
  title: "UI/Select",
  component: Select,
  tags: ["autodocs"],
} satisfies Meta<typeof Select>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    className: "rounded-lg px-3 py-2",
    defaultValue: "signed_in",
    children: (
      <>
        <option value="public">公開</option>
        <option value="signed_in">ログイン済みのみ</option>
        <option value="users">指定ユーザーのみ</option>
        <option value="self">自分のみ</option>
      </>
    ),
  },
};
