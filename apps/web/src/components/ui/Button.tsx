import type { ButtonHTMLAttributes, ReactNode } from "react";
import styles from "./button.module.css";

type Variant = "outline" | "accent";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  children: ReactNode;
};

export function Button({ variant = "outline", className, type = "button", children, ...props }: Props) {
  return (
    <button type={type} className={`${styles.button} ${styles[variant]} ${className ?? ""}`} {...props}>
      {children}
    </button>
  );
}
