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
  title: "UI/Switch",
  tags: ["autodocs"],
  parameters: { layout: "centered" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const ViewEdit: Story = {
  render: () => {
    const [mode, setMode] = useState<"preview" | "edit">("preview");
    return (
      <Switch
        label="表示モード"
        items={[
          {
            value: "preview",
            label: (
              <>
                <EyeIcon />
                View
              </>
            ),
            pressed: mode === "preview",
            onClick: () => setMode("preview"),
          },
          {
            value: "edit",
            label: (
              <>
                <PencilIcon />
                Edit
              </>
            ),
            pressed: mode === "edit",
            onClick: () => setMode("edit"),
          },
        ]}
      />
    );
  },
};

export const ThemeIcons: Story = {
  render: () => {
    const [theme, setTheme] = useState("system");
    return (
      <Switch
        label="テーマ"
        size="sm"
        items={[
          {
            value: "light",
            label: <SunIcon />,
            ariaLabel: "ライト",
            pressed: theme === "light",
            onClick: () => setTheme("light"),
          },
          {
            value: "dark",
            label: <MoonIcon />,
            ariaLabel: "ダーク",
            pressed: theme === "dark",
            onClick: () => setTheme("dark"),
          },
          {
            value: "black",
            label: <BlackIcon />,
            ariaLabel: "ブラック",
            pressed: theme === "black",
            onClick: () => setTheme("black"),
          },
          {
            value: "system",
            label: <MonitorIcon />,
            ariaLabel: "システム",
            pressed: theme === "system",
            onClick: () => setTheme("system"),
          },
        ]}
      />
    );
  },
};
