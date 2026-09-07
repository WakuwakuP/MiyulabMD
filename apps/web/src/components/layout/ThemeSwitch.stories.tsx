import type { Meta, StoryObj } from "@storybook/react-vite";
import { ThemeSwitch } from "./ThemeSwitch.tsx";

const meta = {
  component: ThemeSwitch,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
  title: "Composite/ThemeSwitch",
} satisfies Meta<typeof ThemeSwitch>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Black: Story = {
  globals: { colorScheme: "black" },
};
