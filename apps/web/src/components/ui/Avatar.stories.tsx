import type { Meta, StoryObj } from "@storybook/react-vite";
import { Avatar } from "./Avatar.tsx";

const meta = {
  title: "UI/Avatar",
  component: Avatar,
  tags: ["autodocs"],
} satisfies Meta<typeof Avatar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Medium: Story = {
  args: {
    name: "Waku",
    color: "#2563eb",
    size: "md",
  },
};

export const LargeSoft: Story = {
  args: {
    name: "Miyu",
    color: "#7c3aed",
    size: "lg",
    variant: "soft",
  },
};

export const Small: Story = {
  args: {
    name: "Dev User",
    color: "#059669",
    size: "sm",
  },
};
