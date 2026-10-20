import type { DriveRole, SharedDriveSummary } from "@miyulabmd/shared";
import { SHARED_PATH } from "@miyulabmd/shared";
import {
  HardDrive,
  type LucideIcon,
  Settings2,
  UserRound,
  UsersRound,
} from "lucide-react";
import {
  type FormEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation, useNavigate } from "react-router";
import { useDismiss } from "../../hooks/use-dismiss.ts";
import { createSharedDrive, fetchSharedDrives } from "../../lib/api.ts";
import {
  type DrivePlace,
  drivePlaceFromSelection,
  drivePlacePath,
  readDrivePlace,
  replaceDrivePlace,
  writeDrivePlace,
} from "../../lib/drive-place.ts";
import { Button } from "../ui/Button.tsx";
import { Field } from "../ui/Field.tsx";
import { Input } from "../ui/Input.tsx";
import { ChevronDownIcon } from "../ui/icons.tsx";
import { MenuItem, MenuPanel } from "../ui/Menu.tsx";
import { Modal, ModalFooter, ModalHeader } from "../ui/Modal.tsx";
import { Switch } from "../ui/Switch.tsx";
import { ErrorText } from "../ui/Text.tsx";

export type DriveSelection =
  | { kind: "mine" }
  | { kind: "drive"; id: string }
  | { kind: "shared" }
  | { kind: "shared-by-me" };

const ROLE_LABEL: Record<DriveRole, string> = {
  editor: "編集者",
  manager: "管理者",
  viewer: "閲覧者",
};

const grantPlaces: {
  value: "shared" | "shared-by-me";
  label: string;
  ariaLabel: string;
  path: string;
  icon: LucideIcon;
}[] = [
  {
    ariaLabel: "共有（共有されているアイテム）",
    icon: UsersRound,
    label: "共有",
    path: SHARED_PATH,
    value: "shared",
  },
  {
    ariaLabel: "管理（自分が共有済みのアイテム）",
    icon: Settings2,
    label: "管理",
    path: "/shared-by-me",
    value: "shared-by-me",
  },
];

export function DrivePlaceNav({ selection }: { selection: DriveSelection }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const rootRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [drives, setDrives] = useState<SharedDriveSummary[]>([]);
  const [drivesLoaded, setDrivesLoaded] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [place, setPlace] = useState<DrivePlace>(
    () => drivePlaceFromSelection(selection, pathname) ?? readDrivePlace(),
  );
  const onDrivePage = selection.kind === "mine" || selection.kind === "drive";
  const displayed = useMemo(
    () => drivePlaceFromSelection(selection, pathname) ?? place,
    [pathname, place, selection],
  );
  const current = drives.find(
    (drive) => displayed.kind === "drive" && drive.id === displayed.id,
  );
  const driveLabel =
    displayed.kind === "drive"
      ? (current?.name ?? "共有ドライブ")
      : "マイドライブ";
  const DriveIcon = displayed.kind === "drive" ? HardDrive : UserRound;
  useDismiss(menuOpen, () => setMenuOpen(false), rootRef);

  useEffect(() => {
    const next = drivePlaceFromSelection(selection, pathname);
    if (!next) {
      return;
    }
    setPlace((currentPlace) => replaceDrivePlace(currentPlace, next));
    writeDrivePlace(next);
  }, [pathname, selection]);

  useEffect(() => {
    let cancelled = false;
    void fetchSharedDrives().then((result) => {
      if (cancelled || !result.ok) {
        return;
      }
      setDrives(result.data);
      setDrivesLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!(drivesLoaded && displayed.kind === "drive")) {
      return;
    }
    if (drives.some((drive) => drive.id === displayed.id)) {
      return;
    }
    if (selection.kind === "drive" && selection.id === displayed.id) {
      return;
    }
    const next: DrivePlace = { kind: "mine", path: "/" };
    setPlace(next);
    writeDrivePlace(next);
  }, [displayed, drives, drivesLoaded, selection]);

  function remember(next: DrivePlace) {
    setPlace(next);
    writeDrivePlace(next);
    setMenuOpen(false);
    navigate(drivePlacePath(next));
  }

  function onDriveClick() {
    if (!onDrivePage) {
      setMenuOpen(false);
      navigate(drivePlacePath(displayed));
      return;
    }
    setMenuOpen((open) => !open);
  }

  function selectPlace(path: string) {
    setMenuOpen(false);
    navigate(path);
  }

  return (
    <div className="flex items-center gap-1.5">
      <div className="relative" ref={rootRef}>
        <Switch
          items={[
            {
              ariaLabel: "ドライブ",
              expanded: onDrivePage && menuOpen,
              hasPopup: onDrivePage,
              label: (
                <>
                  <DriveIcon aria-hidden={true} className="size-4" />
                  <span className="whitespace-nowrap max-[900px]:hidden">
                    {driveLabel}
                  </span>
                  {onDrivePage && <ChevronDownIcon className="size-3.5" />}
                </>
              ),
              onClick: onDriveClick,
              pressed: true,
              value: "drive",
            },
          ]}
          label="ドライブ"
          size="md"
        />
        {menuOpen && onDrivePage && (
          <DriveMenu
            drives={drives}
            onCreate={() => {
              setMenuOpen(false);
              setCreateOpen(true);
            }}
            onSelectDrive={(id) =>
              remember({ id, kind: "drive", path: `/d/${id}` })
            }
            onSelectMine={() => remember({ kind: "mine", path: "/" })}
            selection={displayed}
          />
        )}
      </div>
      <Switch
        items={grantPlaces.map(({ icon: Icon, ...grant }) => ({
          ariaLabel: grant.ariaLabel,
          label: (
            <>
              <Icon aria-hidden={true} className="size-4" />
              <span className="whitespace-nowrap max-[900px]:hidden">
                {grant.label}
              </span>
            </>
          ),
          onClick: () => selectPlace(grant.path),
          pressed: selection.kind === grant.value,
          value: grant.value,
        }))}
        label="共有と管理"
        size="md"
      />
      {createOpen && (
        <CreateDriveModal
          onClose={() => setCreateOpen(false)}
          onCreated={(id) => {
            setCreateOpen(false);
            const next: DrivePlace = {
              id,
              kind: "drive",
              path: `/d/${id}`,
            };
            setPlace(next);
            writeDrivePlace(next);
            void fetchSharedDrives().then((result) => {
              if (result.ok) {
                setDrives(result.data);
                setDrivesLoaded(true);
              }
            });
            navigate(next.path);
          }}
        />
      )}
    </div>
  );
}

function DriveMenu({
  drives,
  onCreate,
  onSelectDrive,
  onSelectMine,
  selection,
}: {
  drives: SharedDriveSummary[];
  onCreate: () => void;
  onSelectDrive: (id: string) => void;
  onSelectMine: () => void;
  selection: DriveSelection;
}) {
  return (
    <MenuPanel align="start">
      <MenuItem active={selection.kind === "mine"} onClick={onSelectMine}>
        <span className="flex items-center gap-2">
          <UserRound aria-hidden={true} className="size-4 shrink-0" />
          マイドライブ
        </span>
      </MenuItem>
      {drives.map((drive) => (
        <MenuItem
          active={selection.kind === "drive" && selection.id === drive.id}
          key={drive.id}
          onClick={() => onSelectDrive(drive.id)}
        >
          <span className="flex min-w-0 items-center gap-2">
            <HardDrive aria-hidden={true} className="size-4 shrink-0" />
            <span className="truncate">{drive.name}</span>
            <span className="ml-auto shrink-0 pl-3 text-muted text-xs">
              {ROLE_LABEL[drive.role]}
            </span>
          </span>
        </MenuItem>
      ))}
      <MenuItem onClick={onCreate}>作成</MenuItem>
    </MenuPanel>
  );
}

function CreateDriveModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const titleId = useId();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await createSharedDrive(name);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onCreated(result.data.id);
  }

  return (
    <Modal as="form" labelledBy={titleId} onClose={onClose} onSubmit={onSubmit}>
      <ModalHeader id={titleId} onClose={onClose} title="共有ドライブを作成" />
      <Field htmlFor="drive-name" label="名前">
        <Input
          id="drive-name"
          onChange={(event) => setName(event.target.value)}
          required={true}
          value={name}
        />
      </Field>
      {error && <ErrorText>{error}</ErrorText>}
      <ModalFooter>
        <Button onClick={onClose} type="button">
          キャンセル
        </Button>
        <Button disabled={busy} type="submit" variant="accent">
          {busy ? "作成中…" : "作成"}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
