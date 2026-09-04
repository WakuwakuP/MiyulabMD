import type { FolderRecord } from "@miyulabmd/shared";
import { folderHierarchyLevels } from "../../lib/folder-tree.ts";
import { Select } from "../ui/Select.tsx";

type Props = {
  id?: string;
  folders: FolderRecord[];
  value: string;
  disabled?: boolean;
  onChange: (folder: string) => void;
};

export function FolderHierarchySelect({
  id,
  folders,
  value,
  disabled,
  onChange,
}: Props) {
  const levels = folderHierarchyLevels(folders, value);

  return (
    <div className="flex flex-col gap-2 min-[640px]:flex-row min-[640px]:flex-wrap">
      {levels.map((level, index) => (
        <Select
          key={level.parentId ?? "root"}
          id={index === 0 ? id : undefined}
          className="min-w-0 w-full flex-1 rounded-lg px-3 py-2.5 min-[640px]:min-w-[10rem]"
          value={level.selected}
          disabled={disabled}
          aria-label={
            index === 0 ? "ディレクトリ" : `${index + 1}階層目のディレクトリ`
          }
          onChange={(event) => {
            const next = event.target.value;
            onChange(next || level.parentPath);
          }}
        >
          <option value="">
            {index === 0 ? "選択してください" : "この階層まで"}
          </option>
          {level.options
            .filter((folder) => folder.folder)
            .map((folder) => (
              <option key={folder.id} value={folder.folder}>
                {folder.name}
              </option>
            ))}
        </Select>
      ))}
    </div>
  );
}
