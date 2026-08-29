import { cn } from "../../lib/cn.ts";
import { initialFromName } from "../../lib/user-style.ts";

type Size = "sm" | "md" | "lg";
type Variant = "solid" | "soft";

type Props = {
  name: string;
  color: string;
  size?: Size;
  variant?: Variant;
  title?: string;
};

const sizes: Record<Size, string> = {
  sm: "size-7 text-[0.7rem]",
  md: "size-8 text-[0.8rem]",
  lg: "size-16 text-2xl",
};

export function Avatar({
  name,
  color,
  size = "md",
  variant = "solid",
  title,
}: Props) {
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center rounded-full font-bold leading-none select-none",
        variant === "solid" ? "text-white" : "bg-chip text-[0.85rem] text-ink",
        sizes[size],
      )}
      style={variant === "solid" ? { backgroundColor: color } : undefined}
      title={title ?? name}
    >
      {initialFromName(name)}
    </span>
  );
}
