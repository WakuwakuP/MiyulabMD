import type { FolderCrumb, FolderRecord, NoteSummary } from "@miyulabmd/shared";
import { folderUrl, MY_DRIVE_NAME, SHARED_PATH } from "@miyulabmd/shared";
import type { MouseEvent } from "react";
import { Link } from "react-router";
import { FolderIcon, MarkdownIcon } from "../../components/ui/icons.tsx";
import { cn } from "../../lib/cn.ts";
import { prefetchFolder } from "../../lib/list-cache.ts";
import { prefetchNote } from "../../lib/note-cache.ts";
import { DriveList, DriveRow } from "../ui/DriveList.tsx";
import { AccessScopeMeta } from "./AccessScopeMeta.tsx";

type Props = {
  notes: NoteSummary[];
  currentFolderId: string | null;
  crumbs: FolderCrumb[];
  parentId: string | null;
  childrenFolders: FolderRecord[];
  showRootCrumb?: boolean;
  isDriveRoot?: boolean;
  showAllNotes?: boolean;
  rootHref?: string;
  readonly?: boolean;
  openMenuId?: string | null;
  pending?: boolean;
  placeholder?: boolean;
  onItemMenu: (event: MouseEvent, target: MenuTarget) => void;
};
export type MenuTarget =
  | { kind: "folder"; id: string; name: string }
  | { kind: "note"; note: NoteSummary };

const inFolder = (notes: NoteSummary[], id: string | null) =>
  notes.filter((note) => (note.folderId ?? null) === id).sort((a, b) => b.updatedAt - a.updatedAt);

export function NoteTree({
  notes, currentFolderId, crumbs, parentId, childrenFolders, showRootCrumb = false,
  isDriveRoot = false, showAllNotes = false, rootHref = SHARED_PATH, readonly = false,
  openMenuId = null, pending = false, placeholder = false, onItemMenu,
}: Props) {
  const items = showAllNotes ? [...notes].sort((a, b) => b.updatedAt - a.updatedAt) : inFolder(notes, currentFolderId);
  const folders = [...childrenFolders].sort((a, b) => a.name.localeCompare(b.name, "ja"));
  const menu = readonly ? undefined : onItemMenu;
  const prefetch = (action: () => void) => {
    if (!readonly) {
      action();
    }
  };
  const rowMenu = (event: MouseEvent, target: MenuTarget) => {
    if (!menu) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    menu(event, target);
  };
  return <div>
    <nav aria-label="フォルダ" className="mb-3 flex flex-wrap items-center gap-[0.15rem] text-[0.9rem]">
      {showRootCrumb && <Link className={cn("border-0 bg-transparent p-0 font-inherit text-inherit no-underline", isDriveRoot ? "cursor-default text-muted" : "cursor-pointer")} onPointerEnter={() => prefetch(() => prefetchFolder())} to="/">
        {MY_DRIVE_NAME}
      </Link>}
      {crumbs.map((crumb, index) => {
        const current = index === crumbs.length - 1;
        return <span key={crumb.id}>{(showRootCrumb || index > 0) && <span aria-hidden={true}> / </span>}
          <Link className={cn("border-0 bg-transparent p-0 font-inherit text-inherit no-underline", current ? "cursor-default text-muted" : "cursor-pointer")} onContextMenu={(event) => rowMenu(event, { id: crumb.id, kind: "folder", name: crumb.name })} onPointerEnter={() => prefetch(() => prefetchFolder(crumb.id))} to={folderUrl(crumb.id)}>{crumb.name}</Link>
        </span>;
      })}
    </nav>
    {currentFolderId && !isDriveRoot && <Link className="mb-3 block border-0 bg-transparent p-0 font-inherit text-accent no-underline" onPointerEnter={() => parentId && prefetch(() => prefetchFolder(parentId))} to={parentId ? folderUrl(parentId) : rootHref}>上のフォルダへ</Link>}
    {placeholder ? <DriveList>{null}</DriveList> : folders.length === 0 && items.length === 0 ? <p>このフォルダは空です。</p> :
      <DriveList className={cn(pending && "opacity-60 transition-opacity duration-150")}>
        {folders.map((folder) => <DriveRow href={folderUrl(folder.id)} icon={<FolderIcon />} key={folder.id} menuOpen={openMenuId === folder.id} meta={folder.readScope && folder.writeScope ? <AccessScopeMeta readScope={folder.readScope} writeScope={folder.writeScope} /> : undefined} name={folder.name} onMenu={(event) => rowMenu(event, { id: folder.id, kind: "folder", name: folder.name })} onPointerEnter={() => prefetch(() => prefetchFolder(folder.id))} readonly={readonly} />)}
        {items.map((note) => <DriveRow href={`/n/${note.id}`} icon={<MarkdownIcon />} key={note.id} menuOpen={openMenuId === note.id} meta={<AccessScopeMeta readScope={note.access.effectiveReadScope} writeScope={note.access.effectiveWriteScope} />} name={note.title} onMenu={(event) => rowMenu(event, { kind: "note", note })} onPointerEnter={() => prefetch(() => prefetchNote(note.id))} readonly={readonly} />)}
      </DriveList>}
  </div>;
}
