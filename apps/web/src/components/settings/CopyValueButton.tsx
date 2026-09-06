import { useState } from "react";
import { Button } from "../ui/Button.tsx";

export function CopyValueButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <Button
      onClick={() => {
        void navigator.clipboard.writeText(value).then(
          () => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          },
          () => setCopied(false),
        );
      }}
      variant="ghost"
    >
      {copied ? "コピー済み" : "コピー"}
    </Button>
  );
}
