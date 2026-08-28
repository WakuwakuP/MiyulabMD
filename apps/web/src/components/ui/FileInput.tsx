import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "../../lib/cn.ts";

type Props = InputHTMLAttributes<HTMLInputElement>;

export const FileInput = forwardRef<HTMLInputElement, Props>(function FileInput({ className, ...props }, ref) {
  return (
    <input
      ref={ref}
      type="file"
      className={cn("pointer-events-none absolute size-px opacity-0", className)}
      {...props}
    />
  );
});
