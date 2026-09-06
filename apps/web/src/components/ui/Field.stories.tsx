import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "./Button.tsx";
import { CheckLabel, Field, Row } from "./Field.tsx";
import { Input } from "./Input.tsx";

const meta = {
  component: Field,
  tags: ["autodocs"],
  title: "UI/Field",
} satisfies Meta<typeof Field>;

export default meta;
type Story = StoryObj<typeof meta>;

export const LabeledInput: Story = {
  args: {
    children: <Input defaultValue="Waku" id="display-name" />,
    htmlFor: "display-name",
    label: "表示名",
  },
};

export const CheckboxRow: StoryObj = {
  render: () => (
    <CheckLabel>
      <input defaultChecked={true} type="checkbox" />
      フォルダの権限を継承する
    </CheckLabel>
  ),
};

export const ButtonRow: StoryObj = {
  render: () => (
    <Row>
      <Button variant="outline">キャンセル</Button>
      <Button variant="accent">保存</Button>
    </Row>
  ),
};
