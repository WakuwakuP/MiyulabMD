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
  tags: ["autodocs"],
  title: "UI/Menu",
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Account: Story = {
  render: () => (
    <div className="relative h-80">
      <MenuPanel width="20rem">
        <MenuHeader email="waku@example.com" name="Waku">
          <Avatar color="#2563eb" name="Waku" size="lg" />
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

export const Guest: Story = {
  render: () => (
    <div className="relative h-80">
      <MenuPanel width="20rem">
        <MenuHeader name="ゲスト">
          <Avatar color="#0d9488" name="ゲスト" size="lg" />
        </MenuHeader>
        <MenuSeparator />
        <MenuRow>
          <span className="text-[0.85rem] text-muted">テーマ</span>
          <ThemeSwitch />
        </MenuRow>
        <MenuSeparator />
        <MenuItem href="#login">ログイン</MenuItem>
      </MenuPanel>
    </div>
  ),
};

export const Items: Story = {
  render: () => (
    <div className="relative h-40">
      <MenuPanel>
        <MenuItem active={true}>分割</MenuItem>
        <MenuItem>テキスト</MenuItem>
        <MenuItem>リッチ</MenuItem>
        <MenuSeparator />
        <MenuItem danger={true}>削除</MenuItem>
      </MenuPanel>
    </div>
  ),
};
