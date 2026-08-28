import type { FolderCrumb, FolderRecord, NoteSummary } from "@miyulabmd/shared";
import { folderUrl } from "@miyulabmd/shared";
import type { MouseEvent } from "react";
import { Link } from "react-router";

type Props = {
  notes: NoteSummary[];
  currentFolderId: string | null;
  crumbs: FolderCrumb[];
  parentId: string | null;
  childrenFolders: FolderRecord[];
  showRootCrumb?: boolean;
  openMenuId?: string | null;
  onItemMenu: (event: MouseEvent, target: MenuTarget) => void;
};

export type MenuTarget =
  | { kind: "folder"; id: string; name: string }
  | { kind: "note"; note: NoteSummary };

function notesInFolder(notes: NoteSummary[], currentFolderId: string | null): NoteSummary[] {
  return notes
    .filter((note) => (note.folderId ?? null) === currentFolderId)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

function FolderIcon() {
  return (
    <svg className="drive-row-icon drive-row-icon--folder" viewBox="0 0 24 24" width="22" height="22" aria-hidden>
      <path
        fill="currentColor"
        d="M3.75 6.25A2.25 2.25 0 0 1 6 4h4.1l1.7 1.8H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25H6A2.25 2.25 0 0 1 3.75 18V6.25Z"
      />
    </svg>
  );
}

function MarkdownIcon() {
  return (
    <svg className="drive-row-icon drive-row-icon--note" viewBox="0 0 24 24" width="22" height="22" aria-hidden>
      <path
        fill="currentColor"
        d="M7 3.5h7.3L19.5 8.7V19.5A1.75 1.75 0 0 1 17.75 21.25H6.25A1.75 1.75 0 0 1 4.5 19.5V5.25A1.75 1.75 0 0 1 6.25 3.5H7Z"
        opacity="0.92"
      />
      <path fill="Canvas" d="M14.1 3.7v5.1h5.1" />
      <path
        fill="Canvas"
        d="M7.4 13.1h1.5l1.15 2.35 1.15-2.35h1.5V18H11.3v-2.55L10.05 18h-.1L8.7 15.45V18H7.4Zm7.15 0h1.45l1.7 2.55V13.1H19.2V18h-1.45l-1.7-2.55V18h-1.5Z"
      />
    </svg>
  );
}

function MoreButton({
  label,
  open,
  onClick,
}: {
  label: string;
  open: boolean;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      className="drive-row-more"
      aria-label={`${label} の操作`}
      aria-haspopup="menu"
      aria-expanded={open}
      onClick={onClick}
      onContextMenu={onClick}
    >
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
        <circle cx="12" cy="6" r="1.7" fill="currentColor" />
        <circle cx="12" cy="12" r="1.7" fill="currentColor" />
        <circle cx="12" cy="18" r="1.7" fill="currentColor" />
      </svg>
    </button>
  );
}

export function NoteTree({
  notes,
  currentFolderId,
  crumbs,
  parentId,
  childrenFolders,
  showRootCrumb = false,
  openMenuId = null,
  onItemMenu,
}: Props) {
  const items = notesInFolder(notes, currentFolderId);
  const folders = [...childrenFolders].sort((a, b) => a.name.localeCompare(b.name, "ja"));

  function handleRowMenu(event: MouseEvent, target: MenuTarget) {
    event.preventDefault();
    event.stopPropagation();
    onItemMenu(event, target);
  }

  return (
    <div className="note-tree">
      <nav className="folder-crumb" aria-label="フォルダ">
        {showRootCrumb && (
          <Link to="/" className={!currentFolderId ? "is-current" : undefined}>
            ルート
          </Link>
        )}
        {crumbs.map((crumb, index) => {
          const current = index === crumbs.length - 1;
          return (
            <span key={crumb.id}>
              {(showRootCrumb || index > 0) && <span aria-hidden> / </span>}
              <Link
                to={folderUrl(crumb.id)}
                className={current ? "is-current" : undefined}
                onContextMenu={(event) =>
                  handleRowMenu(event, { kind: "folder", id: crumb.id, name: crumb.name })
                }
              >
                {crumb.name}
              </Link>
            </span>
          );
        })}
      </nav>

      {currentFolderId && (
        <Link className="folder-up" to={folderUrl(parentId)}>
          上のフォルダへ
        </Link>
      )}

      {folders.length === 0 && items.length === 0 ? (
        <p>このフォルダは空です。</p>
      ) : (
        <ul className="drive-list">
          {folders.map((folder) => {
            const target = { kind: "folder" as const, id: folder.id, name: folder.name };
            const open = openMenuId === folder.id;
            return (
              <li
                key={folder.id}
                className={open ? "drive-row is-menu-open" : "drive-row"}
                onContextMenu={(event) => handleRowMenu(event, target)}
              >
                <Link to={folderUrl(folder.id)} className="drive-row-main">
                  <FolderIcon />
                  <span className="drive-row-name">{folder.name}</span>
                </Link>
                <MoreButton
                  label={folder.name}
                  open={open}
                  onClick={(event) => handleRowMenu(event, target)}
                />
              </li>
            );
          })}
          {items.map((note) => {
            const target = { kind: "note" as const, note };
            const open = openMenuId === note.id;
            return (
              <li
                key={note.id}
                className={open ? "drive-row is-menu-open" : "drive-row"}
                onContextMenu={(event) => handleRowMenu(event, target)}
              >
                <Link to={`/n/${note.id}`} className="drive-row-main">
                  <MarkdownIcon />
                  <span className="drive-row-name">{note.title}</span>
                </Link>
                <MoreButton
                  label={note.title}
                  open={open}
                  onClick={(event) => handleRowMenu(event, target)}
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
