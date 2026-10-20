import type { DriveRole, SharedDriveSummary } from "@miyulabmd/shared";
import { SHARED_PATH } from "@miyulabmd/shared";
import {
  HardDrive,
  type LucideIcon,
  Settings2,
  UserRound,
  UsersRound,
} from "lucide-react";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useDismiss } from "../../hooks/use-dismiss.ts";
import { createSharedDrive, fetchSharedDrives } from "../../lib/api.ts";
import { Button } from "../ui/Button.tsx";
import { Field } from "../ui/Field.tsx";
import { IconButton } from "../ui/IconButton.tsx";
import { Input } from "../ui/Input.tsx";
import { ChevronDownIcon, MoreIcon } from "../ui/icons.tsx";
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

type PlaceMenu = "drives" | "places";

export function DrivePlaceNav({ selection }: { selection: DriveSelection }) {
  const navigate = useNavigate();
  const rootRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<PlaceMenu | null>(null);
  const [drives, setDrives] = useState<SharedDriveSummary[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const drivePressed = selection.kind === "mine" || selection.kind === "drive";
  const placePressed =
    selection.kind === "shared" || selection.kind === "shared-by-me";
  const current = drives.find(
    (drive) => selection.kind === "drive" && drive.id === selection.id,
  );
  const driveLabel =
    selection.kind === "drive"
      ? (current?.name ?? "共有ドライブ")
      : "マイドライブ";
  const DriveIcon = selection.kind === "drive" ? HardDrive : UserRound;
  useDismiss(menu !== null, () => setMenu(null), rootRef);

  useEffect(() => {
    let cancelled = false;
    void fetchSharedDrives().then((result) => {
      if (!cancelled && result.ok) {
        setDrives(result.data);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function toggleMenu(next: PlaceMenu) {
    setMenu((currentMenu) => (currentMenu === next ? null : next));
  }

  function onDriveClick() {
    if (!drivePressed) {
      setMenu(null);
      navigate("/");
      return;
    }
    toggleMenu("drives");
  }

  function selectPlace(path: string) {
    setMenu(null);
    navigate(path);
  }

  return (
    <div className="relative" ref={rootRef}>
      <div className="flex items-center gap-1 min-[900px]:hidden">
        <IconButton
          aria-expanded={menu === "drives"}
          aria-haspopup="menu"
          aria-label={driveLabel}
          aria-pressed={drivePressed}
          onClick={onDriveClick}
          title={driveLabel}
          variant={drivePressed ? "outline" : "ghost"}
        >
          <DriveIcon aria-hidden={true} className="size-4" />
        </IconButton>
        <IconButton
          aria-expanded={menu === "places"}
          aria-haspopup="menu"
          aria-label="その他の場所"
          aria-pressed={placePressed}
          onClick={() => toggleMenu("places")}
          title="その他の場所"
          variant={placePressed ? "outline" : "ghost"}
        >
          <MoreIcon />
        </IconButton>
      </div>
      <div className="hidden min-[900px]:block">
        <Switch
          items={[
            {
              ariaLabel: "ドライブ",
              expanded: menu === "drives",
              hasPopup: true,
              label: (
                <>
                  <DriveIcon aria-hidden={true} className="size-4" />
                  <span className="whitespace-nowrap">{driveLabel}</span>
                  <ChevronDownIcon className="size-3.5" />
                </>
              ),
              onClick: onDriveClick,
              pressed: drivePressed,
              value: "drive",
            },
            ...grantPlaces.map(({ icon: Icon, ...place }) => ({
              ariaLabel: place.ariaLabel,
              label: (
                <>
                  <Icon aria-hidden={true} className="size-4" />
                  <span className="whitespace-nowrap">{place.label}</span>
                </>
              ),
              onClick: () => selectPlace(place.path),
              pressed: selection.kind === place.value,
              value: place.value,
            })),
          ]}
          label="場所"
          size="md"
        />
      </div>
      {menu === "drives" && drivePressed && (
        <DriveMenu
          drives={drives}
          onCreate={() => {
            setMenu(null);
            setCreateOpen(true);
          }}
          onSelectDrive={(id) => selectPlace(`/d/${id}`)}
          onSelectMine={() => selectPlace("/")}
          selection={selection}
        />
      )}
      {menu === "places" && (
        <div className="contents min-[900px]:hidden">
          <MenuPanel align="end">
            {grantPlaces.map(({ icon: Icon, ...place }) => (
              <MenuItem
                active={selection.kind === place.value}
                key={place.value}
                onClick={() => selectPlace(place.path)}
              >
                <span className="flex items-center gap-2">
                  <Icon aria-hidden={true} className="size-4 shrink-0" />
                  {place.label}
                </span>
              </MenuItem>
            ))}
          </MenuPanel>
        </div>
      )}
      {createOpen && (
        <CreateDriveModal
          onClose={() => setCreateOpen(false)}
          onCreated={(id) => {
            setCreateOpen(false);
            void fetchSharedDrives().then((result) => {
              if (result.ok) {
                setDrives(result.data);
              }
            });
            navigate(`/d/${id}`);
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
