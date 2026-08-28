import type { CSSProperties, ReactNode } from "react";
import { Link } from "react-router";
import styles from "./menu.module.css";

type PanelProps = {
  children: ReactNode;
  align?: "start" | "end";
  role?: "menu" | "dialog";
  labelledBy?: string;
  width?: string;
  style?: CSSProperties;
};

export function MenuPanel({ children, align = "end", role = "menu", labelledBy, width, style }: PanelProps) {
  return (
    <div
      className={`${styles.panel} ${styles.anchored} ${styles[align]}`}
      role={role}
      aria-labelledby={labelledBy}
      style={{ minWidth: width, ...style }}
    >
      {children}
    </div>
  );
}

export function MenuFixed({
  children,
  x,
  y,
  role = "menu",
}: {
  children: ReactNode;
  x: number;
  y: number;
  role?: "menu";
}) {
  return (
    <div className={`${styles.panel} ${styles.fixed}`} role={role} style={{ left: x, top: y }}>
      {children}
    </div>
  );
}

type ItemProps = {
  children: ReactNode;
  active?: boolean;
  danger?: boolean;
  onClick?: () => void;
  to?: string;
  href?: string;
};

export function MenuItem({ children, active, danger, onClick, to, href }: ItemProps) {
  const className = `${styles.item} ${active ? styles.itemActive : ""} ${danger ? styles.danger : ""}`;

  if (to) {
    return (
      <Link to={to} role="menuitem" className={className} onClick={onClick}>
        {children}
      </Link>
    );
  }

  if (href) {
    return (
      <a href={href} role="menuitem" className={className}>
        {children}
      </a>
    );
  }

  return (
    <button type="button" role="menuitem" className={className} onClick={onClick}>
      {children}
    </button>
  );
}

export function MenuSeparator() {
  return <hr className={styles.separator} />;
}

export function MenuHeader({ name, email, children }: { name: string; email: string; children: ReactNode }) {
  return (
    <div className={styles.header}>
      {children}
      <p className={styles.headerName}>{name}</p>
      <p className={styles.headerEmail}>{email}</p>
    </div>
  );
}
