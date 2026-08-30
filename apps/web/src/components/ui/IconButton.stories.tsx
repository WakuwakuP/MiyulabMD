import type { Meta, StoryObj } from "@storybook/react-vite";
import { IconButton } from "./IconButton.tsx";
import { CloseIcon, MoreIcon, PlusIcon } from "./icons.tsx";

const meta = {
  title: "UI/IconButton",
  component: IconButton,
  tags: ["autodocs"],
} satisfies Meta<typeof IconButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Ghost: Story = {
  args: {
    variant: "ghost",
    "aria-label": "閉じる",
    children: <CloseIcon />,
  },
};

export const Surface: Story = {
  args: {
    variant: "surface",
    "aria-label": "追加",
    children: <PlusIcon />,
  },
};

export const Outline: Story = {
  args: {
    variant: "outline",
    "aria-label": "メニュー",
    children: <MoreIcon />,
  },
};

export const Small: Story = {
  args: {
    variant: "outline",
    size: "sm",
    "aria-label": "閉じる",
    children: <CloseIcon />,
  },
};
