import type { FormEventHandler, ReactNode } from "react";
import { useEffect } from "react";
import { cn } from "../../lib/cn.ts";
import { IconButton } from "./IconButton.tsx";
import { CloseIcon } from "./icons.tsx";

type ModalProps = {
  children: ReactNode;
  labelledBy: string;
  className?: string;
  as?: "div" | "form";
  onClose: () => void;
  onSubmit?: FormEventHandler<HTMLFormElement>;
};

export function Modal({
  children,
  labelledBy,
  className,
  as = "div",
  onClose,
  onSubmit,
}: ModalProps) {
  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const bodyClass = cn(
    "max-h-[min(40rem,calc(var(--app-height,100dvh)*0.9))] w-[min(32rem,100%)] overflow-auto rounded-xl bg-canvas px-[1.35rem] pt-5 pb-4 shadow-modal",
    className,
  );

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-overlay p-4"
      role="presentation"
      onClick={onClose}
    >
      {as === "form" ? (
        <form
          className={bodyClass}
          role="dialog"
          aria-modal="true"
          aria-labelledby={labelledBy}
          onClick={(event) => event.stopPropagation()}
          onSubmit={onSubmit}
        >
          {children}
        </form>
      ) : (
        <div
          className={bodyClass}
          role="dialog"
          aria-modal="true"
          aria-labelledby={labelledBy}
          onClick={(event) => event.stopPropagation()}
        >
          {children}
        </div>
      )}
    </div>
  );
}

export function ModalHeader({
  id,
  title,
  children,
  onClose,
}: {
  id: string;
  title: string;
  children?: ReactNode;
  onClose?: () => void;
}) {
  return (
    <header className="mb-4 flex justify-between gap-4">
      <div>
        <h2 id={id} className="m-0 text-xl">
          {title}
        </h2>
        {children}
      </div>
      {onClose && (
        <IconButton variant="surface" aria-label="閉じる" onClick={onClose}>
          <CloseIcon />
        </IconButton>
      )}
    </header>
  );
}

export function ModalFooter({ children }: { children: ReactNode }) {
  return (
    <footer className="mt-[1.1rem] flex justify-between gap-3">
      {children}
    </footer>
  );
}
