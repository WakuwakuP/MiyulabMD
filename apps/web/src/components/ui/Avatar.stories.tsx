import type { Meta, StoryObj } from "@storybook/react-vite";
import { Avatar } from "./Avatar.tsx";

const meta = {
  component: Avatar,
  tags: ["autodocs"],
  title: "UI/Avatar",
} satisfies Meta<typeof Avatar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Medium: Story = {
  args: {
    color: "#2563eb",
    name: "Waku",
    size: "md",
  },
};

export const LargeSoft: Story = {
  args: {
    color: "#7c3aed",
    name: "Miyu",
    size: "lg",
    variant: "soft",
  },
};

export const Small: Story = {
  args: {
    color: "#059669",
    name: "Dev User",
    size: "sm",
  },
};
