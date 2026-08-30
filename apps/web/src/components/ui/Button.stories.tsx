import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "./Button.tsx";

const meta = {
  title: "UI/Button",
  component: Button,
  tags: ["autodocs"],
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Outline: Story = {
  args: {
    variant: "outline",
    children: "Outline",
  },
};

export const Accent: Story = {
  args: {
    variant: "accent",
    children: "Accent",
  },
};

export const Ghost: Story = {
  args: {
    variant: "ghost",
    children: "Ghost",
  },
};

export const Danger: Story = {
  args: {
    variant: "danger",
    children: "Danger",
  },
};

export const Disabled: Story = {
  args: {
    variant: "outline",
    children: "Disabled",
    disabled: true,
  },
};

export const AllVariants: StoryObj = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline">Outline</Button>
      <Button variant="accent">Accent</Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="danger">Danger</Button>
      <Button variant="outline" disabled>
        Disabled
      </Button>
    </div>
  ),
};
