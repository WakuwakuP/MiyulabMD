import type { Meta, StoryObj } from "@storybook/react-vite";
import { ErrorText, MutedText, SectionTitle } from "./Text.tsx";

const meta = {
  title: "UI/Text",
  tags: ["autodocs"],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const All: Story = {
  render: () => (
    <div className="grid gap-3">
      <SectionTitle>プロフィール</SectionTitle>
      <MutedText>設定はこのデバイスにだけ保存されます。</MutedText>
      <ErrorText>メールアドレスを確認してください。</ErrorText>
    </div>
  ),
};
