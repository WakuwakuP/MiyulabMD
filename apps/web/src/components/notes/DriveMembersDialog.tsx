import type {
  DriveRole,
  SharedDriveDomain,
  SharedDriveMember,
} from "@miyulabmd/shared";
import { type FormEvent, useEffect, useId, useState } from "react";
import { useNavigate } from "react-router";
import {
  addDriveDomain,
  deleteSharedDrive,
  fetchDriveDomains,
  fetchDriveMembers,
  fetchSharedDrive,
  inviteDriveMember,
  removeDriveDomain,
  removeDriveMember,
  renameSharedDrive,
  updateDriveDomainRole,
  updateDriveMemberRole,
} from "../../lib/api.ts";
import { Button } from "../ui/Button.tsx";
import { Field } from "../ui/Field.tsx";
import { Input } from "../ui/Input.tsx";
import { Modal, ModalHeader } from "../ui/Modal.tsx";
import { Select } from "../ui/Select.tsx";
import { ErrorText } from "../ui/Text.tsx";

const ROLE_LABEL: Record<DriveRole, string> = {
  editor: "編集者",
  manager: "管理者",
  viewer: "閲覧者",
};

function DriveMemberRow({
  busy,
  canManage,
  driveId,
  lastManager,
  member,
  onError,
  onMembers,
  setBusy,
}: {
  busy: boolean;
  canManage: boolean;
  driveId: string;
  lastManager: boolean;
  member: SharedDriveMember;
  onError: (error: string | null) => void;
  onMembers: (members: SharedDriveMember[]) => void;
  setBusy: (busy: boolean) => void;
}) {
  function apply(result: Awaited<ReturnType<typeof updateDriveMemberRole>>) {
    setBusy(false);
    if (!result.ok) {
      onError(result.error);
      return;
    }
    onMembers(result.data);
    onError(null);
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-2">
      <span className="min-w-0">
        <span className="block truncate">
          {member.displayName ?? member.email}
        </span>
        <span className="text-muted text-xs">
          {member.email}
          {member.pending ? "（未参加）" : ""}
        </span>
      </span>
      {canManage && !lastManager ? (
        <span className="flex items-center gap-2">
          <Select
            aria-label={`${member.email}の役割`}
            onChange={(event) => {
              const next = event.target.value as DriveRole;
              setBusy(true);
              void updateDriveMemberRole(driveId, member.id, next).then(apply);
            }}
            value={member.role}
          >
            <option value="manager">管理者</option>
            <option value="editor">編集者</option>
            <option value="viewer">閲覧者</option>
          </Select>
          <Button
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void removeDriveMember(driveId, member.id).then(apply);
            }}
            variant="danger"
          >
            外す
          </Button>
        </span>
      ) : (
        <span className="text-sm">{ROLE_LABEL[member.role]}</span>
      )}
    </li>
  );
}

function DriveDomainRow({
  busy,
  canManage,
  domain,
  driveId,
  onDomains,
  onError,
  setBusy,
}: {
  busy: boolean;
  canManage: boolean;
  domain: SharedDriveDomain;
  driveId: string;
  onDomains: (domains: SharedDriveDomain[]) => void;
  onError: (error: string | null) => void;
  setBusy: (busy: boolean) => void;
}) {
  function apply(result: Awaited<ReturnType<typeof updateDriveDomainRole>>) {
    setBusy(false);
    if (!result.ok) {
      onError(result.error);
      return;
    }
    onDomains(result.data);
    onError(null);
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-2">
      <span className="min-w-0 truncate">@{domain.domain}</span>
      {canManage ? (
        <span className="flex items-center gap-2">
          <Select
            aria-label={`${domain.domain}の役割`}
            onChange={(event) => {
              const next = event.target.value as DriveRole;
              setBusy(true);
              void updateDriveDomainRole(driveId, domain.id, next).then(apply);
            }}
            value={domain.role}
          >
            <option value="manager">管理者</option>
            <option value="editor">編集者</option>
            <option value="viewer">閲覧者</option>
          </Select>
          <Button
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void removeDriveDomain(driveId, domain.id).then(apply);
            }}
            variant="danger"
          >
            外す
          </Button>
        </span>
      ) : (
        <span className="text-sm">{ROLE_LABEL[domain.role]}</span>
      )}
    </li>
  );
}

function DriveDomainRules({
  canManage,
  driveId,
}: {
  canManage: boolean;
  driveId: string;
}) {
  const [domains, setDomains] = useState<SharedDriveDomain[]>([]);
  const [domain, setDomain] = useState("");
  const [role, setRole] = useState<DriveRole>("editor");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetchDriveDomains(driveId).then((listed) => {
      if (cancelled || !listed.ok) {
        return;
      }
      setDomains(listed.data);
    });
    return () => {
      cancelled = true;
    };
  }, [driveId]);

  if (!canManage && domains.length === 0) {
    return null;
  }

  async function onAdd(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    const result = await addDriveDomain(driveId, domain, role);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setDomain("");
    setDomains(result.data);
    setError(null);
  }

  return (
    <section className="mt-4 grid gap-2">
      <h3 className="m-0 text-sm">ドメイン</h3>
      <p className="m-0 text-muted text-xs">
        このドメインのメールアドレスは、ログインするとメンバーになります。すでに招待している人の役割は変わりません。外した人は、もう一度招待するまで自動では戻りません。
      </p>
      {error && <ErrorText>{error}</ErrorText>}
      <ul className="m-0 grid list-none gap-2 p-0">
        {domains.map((item) => (
          <DriveDomainRow
            busy={busy}
            canManage={canManage}
            domain={item}
            driveId={driveId}
            key={item.id}
            onDomains={setDomains}
            onError={setError}
            setBusy={setBusy}
          />
        ))}
      </ul>
      {canManage && (
        <form className="grid gap-2" onSubmit={onAdd}>
          <Field htmlFor="member-domain" label="ドメインを追加">
            <Input
              id="member-domain"
              onChange={(event) => setDomain(event.target.value)}
              placeholder="example.com"
              value={domain}
            />
          </Field>
          <Select
            aria-label="ドメインの役割"
            onChange={(event) => setRole(event.target.value as DriveRole)}
            value={role}
          >
            <option value="manager">管理者</option>
            <option value="editor">編集者</option>
            <option value="viewer">閲覧者</option>
          </Select>
          <Button
            disabled={busy || domain.trim() === ""}
            type="submit"
            variant="accent"
          >
            追加
          </Button>
        </form>
      )}
    </section>
  );
}

export function DriveMembersDialog({
  driveId,
  onClose,
}: {
  driveId: string;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const titleId = useId();
  const [name, setName] = useState("");
  const [canManage, setCanManage] = useState(false);
  const [members, setMembers] = useState<SharedDriveMember[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<DriveRole>("editor");
  const [deleteName, setDeleteName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      fetchSharedDrive(driveId),
      fetchDriveMembers(driveId),
    ]).then(([drive, listed]) => {
      if (cancelled) {
        return;
      }
      if (drive.ok) {
        setName(drive.data.name);
        setCanManage(drive.data.role === "manager");
      } else {
        setError(drive.error);
      }
      if (listed.ok) {
        setMembers(listed.data);
      } else {
        setError(listed.error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [driveId]);

  const managerIds = members
    .filter((member) => member.role === "manager" && !member.pending)
    .map((member) => member.id);
  const lastManagerId = managerIds.length === 1 ? managerIds[0] : null;

  async function onInvite(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    const result = await inviteDriveMember(driveId, email, role);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setEmail("");
    setMembers(result.data);
    setError(null);
  }

  async function onRename(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    const result = await renameSharedDrive(driveId, name);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setName(result.data.name);
    setError(null);
  }

  async function onDelete(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    const result = await deleteSharedDrive(driveId, deleteName);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    navigate("/");
  }

  return (
    <Modal labelledBy={titleId} onClose={onClose}>
      <ModalHeader id={titleId} onClose={onClose} title="メンバー" />
      <p className="mt-0 text-muted text-sm">メンバーのみ</p>
      {error && <ErrorText>{error}</ErrorText>}
      <ul className="m-0 grid list-none gap-2 p-0">
        {members.map((member) => (
          <DriveMemberRow
            busy={busy}
            canManage={canManage}
            driveId={driveId}
            key={member.id}
            lastManager={member.id === lastManagerId}
            member={member}
            onError={setError}
            onMembers={setMembers}
            setBusy={setBusy}
          />
        ))}
      </ul>
      <DriveDomainRules canManage={canManage} driveId={driveId} />
      {canManage && (
        <>
          <form className="mt-4 grid gap-2" onSubmit={onInvite}>
            <Field htmlFor="member-email" label="招待">
              <Input
                id="member-email"
                onChange={(event) => setEmail(event.target.value)}
                placeholder="email@example.com"
                type="email"
                value={email}
              />
            </Field>
            <Select
              aria-label="招待する役割"
              onChange={(event) => setRole(event.target.value as DriveRole)}
              value={role}
            >
              <option value="manager">管理者</option>
              <option value="editor">編集者</option>
              <option value="viewer">閲覧者</option>
            </Select>
            <Button
              disabled={busy || email.trim() === ""}
              type="submit"
              variant="accent"
            >
              招待
            </Button>
          </form>
          <form className="mt-4 grid gap-2" onSubmit={onRename}>
            <Field htmlFor="drive-rename" label="ドライブ名">
              <Input
                id="drive-rename"
                onChange={(event) => setName(event.target.value)}
                value={name}
              />
            </Field>
            <Button disabled={busy} type="submit">
              名前を変更
            </Button>
          </form>
          <form className="mt-4 grid gap-2" onSubmit={onDelete}>
            <Field htmlFor="drive-delete" label="削除するにはドライブ名を入力">
              <Input
                id="drive-delete"
                onChange={(event) => setDeleteName(event.target.value)}
                value={deleteName}
              />
            </Field>
            <Button
              disabled={busy || deleteName !== name}
              type="submit"
              variant="danger"
            >
              ドライブを削除
            </Button>
          </form>
        </>
      )}
    </Modal>
  );
}
