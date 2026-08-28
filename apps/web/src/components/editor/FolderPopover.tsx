import { folderUrl } from "@miyulabmd/shared";
import { useRef, useState } from "react";
import { Link } from "react-router";
import { useDismiss } from "../../hooks/use-dismiss.ts";
import { HeaderButton } from "../ui/HeaderButton.tsx";
import { FolderOutlineIcon } from "../ui/icons.tsx";
import { Input } from "../ui/Input.tsx";
import { MenuPanel } from "../ui/Menu.tsx";
import { MutedText } from "../ui/Text.tsx";

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
      <HeaderButton
        variant="outline"
        icon={<FolderOutlineIcon />}
        label="フォルダ"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
      />
      {open && (
        <MenuPanel role="dialog" width="16rem">
          <div className="grid gap-2 px-3 py-2">
            {isOwner ? (
              <>
                <Input
                  variant="pill"
                  className="w-full"
                  type="text"
                  value={folder}
                  onChange={(event) => onFolderChange(event.target.value)}
                  onBlur={onFolderBlur}
                  placeholder="例: work/infra"
                  aria-label="ノートのフォルダ"
                />
                {folderId && (
                  <Link className="text-accent no-underline" to={folderUrl(folderId)}>
                    開く
                  </Link>
                )}
              </>
            ) : folderId ? (
              <Link className="text-accent no-underline" to={folderUrl(folderId)}>
                フォルダを開く
              </Link>
            ) : (
              <MutedText>なし</MutedText>
            )}
          </div>
        </MenuPanel>
      )}
    </div>
  );
}
