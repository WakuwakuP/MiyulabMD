import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "./Button.tsx";

const meta = {
  component: Button,
  tags: ["autodocs"],
  title: "UI/Button",
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Outline: Story = {
  args: {
    children: "Outline",
    variant: "outline",
  },
};

export const Accent: Story = {
  args: {
    children: "Accent",
    variant: "accent",
  },
};

export const Ghost: Story = {
  args: {
    children: "Ghost",
    variant: "ghost",
  },
};

export const Danger: Story = {
  args: {
    children: "Danger",
    variant: "danger",
  },
};

export const Disabled: Story = {
  args: {
    children: "Disabled",
    disabled: true,
    variant: "outline",
  },
};

export const AllVariants: StoryObj = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline">Outline</Button>
      <Button variant="accent">Accent</Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="danger">Danger</Button>
      <Button disabled={true} variant="outline">
        Disabled
      </Button>
    </div>
  ),
};
