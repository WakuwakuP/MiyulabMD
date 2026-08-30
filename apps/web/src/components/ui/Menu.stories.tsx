import type { Meta, StoryObj } from "@storybook/react-vite";
import { ThemeSwitch } from "../layout/ThemeSwitch.tsx";
import { Avatar } from "./Avatar.tsx";
import {
  MenuHeader,
  MenuItem,
  MenuPanel,
  MenuRow,
  MenuSeparator,
} from "./Menu.tsx";

const meta = {
  title: "UI/Menu",
  tags: ["autodocs"],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Account: Story = {
  render: () => (
    <div className="relative h-80">
      <MenuPanel width="18rem">
        <MenuHeader name="Waku" email="waku@example.com">
          <Avatar name="Waku" color="#2563eb" size="lg" />
        </MenuHeader>
        <MenuSeparator />
        <MenuRow>
          <span className="text-[0.85rem] text-muted">テーマ</span>
          <ThemeSwitch />
        </MenuRow>
        <MenuSeparator />
        <MenuItem to="/settings">設定</MenuItem>
        <MenuItem href="#logout">ログアウト</MenuItem>
      </MenuPanel>
    </div>
  ),
};

export const Items: Story = {
  render: () => (
    <div className="relative h-40">
      <MenuPanel>
        <MenuItem active>分割</MenuItem>
        <MenuItem>テキスト</MenuItem>
        <MenuItem>リッチ</MenuItem>
        <MenuSeparator />
        <MenuItem danger>削除</MenuItem>
      </MenuPanel>
    </div>
  ),
};
