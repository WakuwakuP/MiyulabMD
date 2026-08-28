import { folderUrl } from "@miyulabmd/shared";
import { useRef, useState } from "react";
import { Link } from "react-router";
import { useDismiss } from "../../hooks/use-dismiss.ts";
import { Button } from "../ui/Button.tsx";
import { MenuPanel } from "../ui/Menu.tsx";

type Props = {
  folder: string;
  folderId: string | null;
  isOwner: boolean;
  onFolderChange: (value: string) => void;
  onFolderBlur: () => void;
};

export function FolderPopover({ folder, folderId, isOwner, onFolderChange, onFolderBlur }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useDismiss(open, () => setOpen(false), rootRef);

  return (
    <div className="relative" ref={rootRef}>
      <Button variant="outline" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((value) => !value)}>
        フォルダ
      </Button>
      {open && (
        <MenuPanel role="dialog" width="16rem">
          <div className="grid gap-2 px-3 py-2">
            {isOwner ? (
              <>
                <input
                  className="w-full rounded-full border border-[var(--border)] px-3 py-2"
                  type="text"
                  value={folder}
                  onChange={(event) => onFolderChange(event.target.value)}
                  onBlur={onFolderBlur}
                  placeholder="例: work/infra"
                  aria-label="ノートのフォルダ"
                />
                {folderId && (
                  <Link className="text-[var(--accent)] no-underline" to={folderUrl(folderId)}>
                    開く
                  </Link>
                )}
              </>
            ) : folderId ? (
              <Link className="text-[var(--accent)] no-underline" to={folderUrl(folderId)}>
                フォルダを開く
              </Link>
            ) : (
              <span className="text-[var(--muted)]">なし</span>
            )}
          </div>
        </MenuPanel>
      )}
    </div>
  );
}
