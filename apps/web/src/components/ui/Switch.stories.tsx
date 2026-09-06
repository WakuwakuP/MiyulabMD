import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import {
  BlackIcon,
  EyeIcon,
  MonitorIcon,
  MoonIcon,
  PencilIcon,
  SunIcon,
} from "./icons.tsx";
import { Switch } from "./Switch.tsx";

const meta = {
  parameters: { layout: "centered" },
  tags: ["autodocs"],
  title: "UI/Switch",
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const ViewEdit: Story = {
  render: () => {
    const [mode, setMode] = useState<"preview" | "edit">("preview");
    return (
      <Switch
        items={[
          {
            label: (
              <>
                <EyeIcon />
                View
              </>
            ),
            onClick: () => setMode("preview"),
            pressed: mode === "preview",
            value: "preview",
          },
          {
            label: (
              <>
                <PencilIcon />
                Edit
              </>
            ),
            onClick: () => setMode("edit"),
            pressed: mode === "edit",
            value: "edit",
          },
        ]}
        label="表示モード"
      />
    );
  },
};

export const ThemeIcons: Story = {
  render: () => {
    const [theme, setTheme] = useState("system");
    return (
      <Switch
        items={[
          {
            ariaLabel: "ライト",
            label: <SunIcon />,
            onClick: () => setTheme("light"),
            pressed: theme === "light",
            value: "light",
          },
          {
            ariaLabel: "ダーク",
            label: <MoonIcon />,
            onClick: () => setTheme("dark"),
            pressed: theme === "dark",
            value: "dark",
          },
          {
            ariaLabel: "ブラック",
            label: <BlackIcon />,
            onClick: () => setTheme("black"),
            pressed: theme === "black",
            value: "black",
          },
          {
            ariaLabel: "システム",
            label: <MonitorIcon />,
            onClick: () => setTheme("system"),
            pressed: theme === "system",
            value: "system",
          },
        ]}
        label="テーマ"
        size="sm"
      />
    );
  },
};
