import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "./Button.tsx";
import { CheckLabel, Field, Row } from "./Field.tsx";
import { Input } from "./Input.tsx";

const meta = {
  title: "UI/Field",
  component: Field,
  tags: ["autodocs"],
} satisfies Meta<typeof Field>;

export default meta;
type Story = StoryObj<typeof meta>;

export const LabeledInput: Story = {
  args: {
    label: "表示名",
    htmlFor: "display-name",
    children: <Input id="display-name" defaultValue="Waku" />,
  },
};

export const CheckboxRow: StoryObj = {
  render: () => (
    <CheckLabel>
      <input type="checkbox" defaultChecked />
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
