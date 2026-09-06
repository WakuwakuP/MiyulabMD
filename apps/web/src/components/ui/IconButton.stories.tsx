import type { Meta, StoryObj } from "@storybook/react-vite";
import { IconButton } from "./IconButton.tsx";
import { CloseIcon, MoreIcon, PlusIcon } from "./icons.tsx";

const meta = {
  component: IconButton,
  tags: ["autodocs"],
  title: "UI/IconButton",
} satisfies Meta<typeof IconButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Ghost: Story = {
  args: {
    "aria-label": "閉じる",
    children: <CloseIcon />,
    variant: "ghost",
  },
};

export const Surface: Story = {
  args: {
    "aria-label": "追加",
    children: <PlusIcon />,
    variant: "surface",
  },
};

export const Outline: Story = {
  args: {
    "aria-label": "メニュー",
    children: <MoreIcon />,
    variant: "outline",
  },
};

export const Small: Story = {
  args: {
    "aria-label": "閉じる",
    children: <CloseIcon />,
    size: "sm",
    variant: "outline",
  },
};
