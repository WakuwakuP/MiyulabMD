import type { FolderCrumb } from "@miyulabmd/shared";
import { folderUrl, MY_DRIVE_NAME } from "@miyulabmd/shared";
import type { MouseEvent } from "react";
import { Link } from "react-router";
import { cn } from "../../lib/cn.ts";
import { prefetchFolder } from "../../lib/list-cache.ts";

export type FolderBreadcrumbMenuTarget = {
  id: string;
  kind: "folder";
  name: string;
};

type Props = {
  crumbs: FolderCrumb[];
  /** Mute the last crumb as the current folder (folder list). Notes leave all clickable. */
  currentIsLast?: boolean;
  isDriveRoot?: boolean;
  onItemMenu?: (event: MouseEvent, target: FolderBreadcrumbMenuTarget) => void;
  readonly?: boolean;
  showRootCrumb?: boolean;
  /** Extra classes on the nav (e.g. editor padding). */
  className?: string;
};

/**
 * Folder path crumbs with the same discoverability as folder access.
 * Used on drive lists and note views (`/n/:id`, `/s/:id`).
 */
export function FolderBreadcrumbs({
  crumbs,
  currentIsLast = false,
  isDriveRoot = false,
  onItemMenu,
  readonly = false,
  showRootCrumb = false,
  className,
}: Props) {
  if (!(showRootCrumb || crumbs.length > 0)) {
    return null;
  }

  return (
    <nav
      aria-label="フォルダ"
      className={cn(
        "mb-3 flex flex-wrap items-center gap-[0.15rem] text-[0.9rem]",
        className,
      )}
    >
      {showRootCrumb && (
        <Link
          className={cn(
            "border-0 bg-transparent p-0 font-inherit text-inherit no-underline",
            isDriveRoot ? "cursor-default text-muted" : "cursor-pointer",
          )}
          onPointerEnter={() => {
            if (!readonly) {
              prefetchFolder();
            }
          }}
          to="/"
        >
          {MY_DRIVE_NAME}
        </Link>
      )}
      {crumbs.map((crumb, index) => {
        const current = currentIsLast && index === crumbs.length - 1;
        return (
          <span key={crumb.id}>
            {(showRootCrumb || index > 0) && (
              <span aria-hidden={true}> / </span>
            )}
            <Link
              className={cn(
                "border-0 bg-transparent p-0 font-inherit text-inherit no-underline",
                current ? "cursor-default text-muted" : "cursor-pointer",
              )}
              onContextMenu={
                readonly || !onItemMenu
                  ? undefined
                  : (event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      onItemMenu(event, {
                        id: crumb.id,
                        kind: "folder",
                        name: crumb.name,
                      });
                    }
              }
              onPointerEnter={() => {
                if (!readonly) {
                  prefetchFolder(crumb.id);
                }
              }}
              to={folderUrl(crumb.id)}
            >
              {crumb.name}
            </Link>
          </span>
        );
      })}
    </nav>
  );
}
