import type { DriveRole, SharedDriveSummary } from "@miyulabmd/shared";
import { SHARED_PATH } from "@miyulabmd/shared";
import {
  type LucideIcon,
  Settings2,
  UserRound,
  UsersRound,
} from "lucide-react";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { createSharedDrive, fetchSharedDrives } from "../../lib/api.ts";
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
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [drives, setDrives] = useState<SharedDriveSummary[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const drivePressed = selection.kind === "mine" || selection.kind === "drive";
  const current = drives.find(
    (drive) => selection.kind === "drive" && drive.id === selection.id,
  );
  const driveLabel =
    selection.kind === "drive"
      ? (current?.name ?? "共有ドライブ")
      : "マイドライブ";

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

  useEffect(() => {
    if (!open) {
      return;
    }
    function onPointer(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    window.addEventListener("pointerdown", onPointer);
    return () => window.removeEventListener("pointerdown", onPointer);
  }, [open]);

  return (
    <div className="relative" ref={rootRef}>
      <Switch
        items={[
          {
            ariaLabel: "ドライブ",
            expanded: open,
            hasPopup: true,
            label: (
              <>
                <UserRound aria-hidden={true} className="size-4" />
                <span className="whitespace-nowrap max-[900px]:hidden">
                  {driveLabel}
                </span>
                <ChevronDownIcon className="size-3.5" />
              </>
            ),
            onClick: () => setOpen((value) => !value),
            pressed: drivePressed,
            value: "drive",
          },
          ...grantPlaces.map(({ icon: Icon, ...place }) => ({
            ariaLabel: place.ariaLabel,
            label: (
              <>
                <Icon aria-hidden={true} className="size-4" />
                <span className="whitespace-nowrap max-[900px]:hidden">
                  {place.label}
                </span>
              </>
            ),
            onClick: () => {
              setOpen(false);
              navigate(place.path);
            },
            pressed: selection.kind === place.value,
            value: place.value,
          })),
        ]}
        label="場所"
        size="md"
      />
      {open && (
        <MenuPanel align="start">
          <MenuItem
            active={selection.kind === "mine"}
            onClick={() => {
              setOpen(false);
              navigate("/");
            }}
          >
            マイドライブ
          </MenuItem>
          {drives.map((drive) => (
            <MenuItem
              active={selection.kind === "drive" && selection.id === drive.id}
              key={drive.id}
              onClick={() => {
                setOpen(false);
                navigate(`/d/${drive.id}`);
              }}
            >
              <span className="flex min-w-0 items-baseline justify-between gap-3">
                <span className="truncate">{drive.name}</span>
                <span className="shrink-0 text-muted text-xs">
                  {ROLE_LABEL[drive.role]}
                </span>
              </span>
            </MenuItem>
          ))}
          <MenuItem
            onClick={() => {
              setOpen(false);
              setCreateOpen(true);
            }}
          >
            作成
          </MenuItem>
        </MenuPanel>
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
