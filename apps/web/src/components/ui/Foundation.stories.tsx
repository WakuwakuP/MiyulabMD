import type { Meta, StoryObj } from "@storybook/react-vite";

const COLORS = [
  { name: "canvas", className: "bg-canvas border border-border" },
  { name: "surface", className: "bg-surface" },
  { name: "fill", className: "bg-fill" },
  { name: "accent", className: "bg-accent" },
  { name: "error", className: "bg-error" },
  { name: "folder", className: "bg-folder" },
  { name: "note", className: "bg-note" },
  { name: "code", className: "bg-code" },
] as const;

function Foundation() {
  return (
    <div className="grid gap-8 text-ink">
      <section className="grid gap-3">
        <h2 className="m-0 text-lg font-semibold">Color</h2>
        <div className="grid grid-cols-4 gap-3">
          {COLORS.map((color) => (
            <div key={color.name} className="grid gap-1">
              <div className={`h-16 rounded-lg ${color.className}`} />
              <p className="m-0 text-[0.85rem] text-muted">{color.name}</p>
            </div>
          ))}
        </div>
      </section>
      <section className="grid gap-2">
        <h2 className="m-0 font-sans text-lg font-semibold">Font</h2>
        <p className="m-0 font-sans">M PLUS 2 — 本文サンセリフ</p>
        <p className="m-0 font-mono text-[0.9rem]">
          IBM Plex Mono — const token = true;
        </p>
      </section>
      <section className="grid gap-3">
        <h2 className="m-0 text-lg font-semibold">Shadow</h2>
        <div className="flex gap-6">
          <div className="rounded-xl bg-canvas p-6 shadow-menu">
            shadow-menu
          </div>
          <div className="rounded-xl bg-canvas p-6 shadow-modal">
            shadow-modal
          </div>
        </div>
      </section>
    </div>
  );
}

const meta = {
  title: "Foundation/Tokens",
  component: Foundation,
  tags: ["autodocs"],
} satisfies Meta<typeof Foundation>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Black: Story = {
  globals: { colorScheme: "black" },
};
