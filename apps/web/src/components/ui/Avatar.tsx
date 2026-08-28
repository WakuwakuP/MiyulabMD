import { initialFromName } from "../../lib/user-style.ts";
import styles from "./avatar.module.css";

type Size = "sm" | "md" | "lg";

type Props = {
  name: string;
  color: string;
  size?: Size;
  title?: string;
};

export function Avatar({ name, color, size = "md", title }: Props) {
  return (
    <span className={`${styles.avatar} ${styles[size]}`} style={{ backgroundColor: color }} title={title ?? name}>
      {initialFromName(name)}
    </span>
  );
}
