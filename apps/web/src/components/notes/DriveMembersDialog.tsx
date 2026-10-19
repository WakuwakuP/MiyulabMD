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
import { colorForEmail } from "../../lib/user-style.ts";
import { Avatar } from "../ui/Avatar.tsx";
import { Button } from "../ui/Button.tsx";
import { Field, Row } from "../ui/Field.tsx";
import { Input } from "../ui/Input.tsx";
import { Modal, ModalHeader } from "../ui/Modal.tsx";
import { Select } from "../ui/Select.tsx";
import { ErrorText, MutedText } from "../ui/Text.tsx";

const ROLE_LABEL: Record<DriveRole, string> = {
  editor: "編集者",
  manager: "管理者",
  viewer: "閲覧者",
};

const selectClass = "h-9 shrink-0 rounded-lg px-2 text-sm";

type Panel = "domains" | "drive" | "members";

function RoleSelect({
  disabled,
  label,
  onChange,
  value,
}: {
  disabled?: boolean;
  label: string;
  onChange: (role: DriveRole) => void;
  value: DriveRole;
}) {
  return (
    <Select
      aria-label={label}
      className={selectClass}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value as DriveRole)}
      value={value}
    >
      <option value="manager">管理者</option>
      <option value="editor">編集者</option>
      <option value="viewer">閲覧者</option>
    </Select>
  );
}

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
  const label = member.displayName ?? member.email;

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
    <li className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-2 py-2 max-[520px]:grid-cols-[2rem_minmax(0,1fr)]">
      <Avatar
        color={colorForEmail(member.email)}
        name={label}
        size="sm"
        variant="soft"
      />
      <span className="min-w-0">
        <span className="flex min-w-0 items-center gap-1.5">
          <strong className="truncate text-sm">{label}</strong>
          {member.pending && (
            <span className="shrink-0 rounded-full bg-chip px-1.5 py-0.5 text-[0.7rem] text-muted">
              未参加
            </span>
          )}
        </span>
        {member.displayName && (
          <span className="block truncate text-[0.8rem] text-muted">
            {member.email}
          </span>
        )}
      </span>
      {canManage && !lastManager ? (
        <span className="flex items-center gap-1 max-[520px]:col-span-2 max-[520px]:justify-end">
          <RoleSelect
            disabled={busy}
            label={`${member.email}の役割`}
            onChange={(next) => {
              setBusy(true);
              void updateDriveMemberRole(driveId, member.id, next).then(apply);
            }}
            value={member.role}
          />
          <button
            className="cursor-pointer border-0 bg-transparent px-1 text-muted text-sm disabled:cursor-default disabled:opacity-65"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void removeDriveMember(driveId, member.id).then(apply);
            }}
            type="button"
          >
            外す
          </button>
        </span>
      ) : (
        <span className="justify-self-end text-muted text-sm max-[520px]:col-span-2">
          {ROLE_LABEL[member.role]}
        </span>
      )}
    </li>
  );
}

function MemberListBody({
  busy,
  canManage,
  driveId,
  lastManagerId,
  loadError,
  onError,
  onMembers,
  query,
  ready,
  setBusy,
  visible,
}: {
  busy: boolean;
  canManage: boolean;
  driveId: string;
  lastManagerId: string | null;
  loadError: string | null;
  onError: (error: string | null) => void;
  onMembers: (members: SharedDriveMember[]) => void;
  query: string;
  ready: boolean;
  setBusy: (busy: boolean) => void;
  visible: SharedDriveMember[];
}) {
  if (!ready) {
    return <li className="py-6 text-center text-muted text-sm">読み込み中…</li>;
  }
  if (visible.length === 0 && !loadError) {
    return (
      <li className="py-6 text-center text-muted text-sm">
        {query ? "一致するメンバーはいません" : "メンバーはいません"}
      </li>
    );
  }
  return visible.map((member) => (
    <DriveMemberRow
      busy={busy}
      canManage={canManage}
      driveId={driveId}
      key={member.id}
      lastManager={member.id === lastManagerId}
      member={member}
      onError={onError}
      onMembers={onMembers}
      setBusy={setBusy}
    />
  ));
}

function MembersPanel({
  canManage,
  driveId,
  loadError,
  members,
  onMembers,
  ready,
}: {
  canManage: boolean;
  driveId: string;
  loadError: string | null;
  members: SharedDriveMember[];
  onMembers: (members: SharedDriveMember[]) => void;
  ready: boolean;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<DriveRole>("editor");
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const showFilter = members.length > 6;
  const query = showFilter ? filter.trim().toLowerCase() : "";

  useEffect(() => {
    if (!showFilter) {
      setFilter("");
    }
  }, [showFilter]);
  const visible = query
    ? members.filter((member) => {
        const name = member.displayName?.toLowerCase() ?? "";
        const pending = member.pending ? "未参加" : "";
        return (
          name.includes(query) ||
          member.email.includes(query) ||
          ROLE_LABEL[member.role].includes(query) ||
          pending.includes(query)
        );
      })
    : members;
  const managerIds = members
    .filter((member) => member.role === "manager" && !member.pending)
    .map((member) => member.id);
  const lastManagerId =
    managerIds.length === 1 ? (managerIds[0] ?? null) : null;

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
    onMembers(result.data);
    setError(null);
  }

  return (
    <div>
      {(error ?? loadError) && (
        <ErrorText className="mt-0">{error ?? loadError}</ErrorText>
      )}
      {showFilter && (
        <Input
          aria-label="メンバーを絞り込む"
          className="mb-2 w-full"
          onChange={(event) => setFilter(event.target.value)}
          placeholder="絞り込む"
          value={filter}
          variant="pill"
        />
      )}
      <ul className="m-0 max-h-[min(18rem,42dvh)] list-none divide-y divide-border overflow-y-auto py-0 ps-0 pe-2">
        <MemberListBody
          busy={busy}
          canManage={canManage}
          driveId={driveId}
          lastManagerId={lastManagerId}
          loadError={loadError}
          onError={setError}
          onMembers={onMembers}
          query={query}
          ready={ready}
          setBusy={setBusy}
          visible={visible}
        />
      </ul>
      {canManage && (
        <form className="mt-3" onSubmit={onInvite}>
          <Row className="max-[520px]:flex-col">
            <Input
              aria-label="招待するメールアドレス"
              className="min-w-0 flex-1"
              onChange={(event) => setEmail(event.target.value)}
              placeholder="メールアドレスで招待"
              type="email"
              value={email}
              variant="pill"
            />
            <RoleSelect label="招待する役割" onChange={setRole} value={role} />
            <Button
              disabled={busy || email.trim() === ""}
              type="submit"
              variant="accent"
            >
              招待
            </Button>
          </Row>
        </form>
      )}
    </div>
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
    <li className="flex items-center justify-between gap-2 py-2">
      <span className="min-w-0 truncate text-sm">@{domain.domain}</span>
      {canManage ? (
        <span className="flex items-center gap-1">
          <RoleSelect
            disabled={busy}
            label={`${domain.domain}の役割`}
            onChange={(next) => {
              setBusy(true);
              void updateDriveDomainRole(driveId, domain.id, next).then(apply);
            }}
            value={domain.role}
          />
          <button
            className="cursor-pointer border-0 bg-transparent px-1 text-muted text-sm disabled:cursor-default disabled:opacity-65"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void removeDriveDomain(driveId, domain.id).then(apply);
            }}
            type="button"
          >
            外す
          </button>
        </span>
      ) : (
        <span className="text-sm text-muted">{ROLE_LABEL[domain.role]}</span>
      )}
    </li>
  );
}

function DomainsPanel({
  canManage,
  domains,
  driveId,
  loadError,
  onDomains,
}: {
  canManage: boolean;
  domains: SharedDriveDomain[];
  driveId: string;
  loadError: string | null;
  onDomains: (domains: SharedDriveDomain[]) => void;
}) {
  const [domain, setDomain] = useState("");
  const [role, setRole] = useState<DriveRole>("editor");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
    onDomains(result.data);
    setError(null);
  }

  return (
    <div>
      <MutedText className="mb-3">
        ログインすると、このドメインの人がメンバーになります。招待済みの役割は変わりません。外した人は、再招待するまで戻りません。
      </MutedText>
      {(error ?? loadError) && <ErrorText>{error ?? loadError}</ErrorText>}
      <ul className="m-0 max-h-[min(14rem,32dvh)] list-none divide-y divide-border overflow-y-auto p-0">
        {domains.length === 0 && !loadError ? (
          <li className="py-6 text-center text-muted text-sm">
            ドメインは未登録です
          </li>
        ) : (
          domains.map((item) => (
            <DriveDomainRow
              busy={busy}
              canManage={canManage}
              domain={item}
              driveId={driveId}
              key={item.id}
              onDomains={onDomains}
              onError={setError}
              setBusy={setBusy}
            />
          ))
        )}
      </ul>
      {canManage && (
        <form className="mt-3" onSubmit={onAdd}>
          <Row className="max-[520px]:flex-col">
            <Input
              aria-label="追加するドメイン"
              className="min-w-0 flex-1"
              onChange={(event) => setDomain(event.target.value)}
              placeholder="example.com"
              value={domain}
              variant="pill"
            />
            <RoleSelect
              label="ドメインの役割"
              onChange={setRole}
              value={role}
            />
            <Button
              disabled={busy || domain.trim() === ""}
              type="submit"
              variant="accent"
            >
              追加
            </Button>
          </Row>
        </form>
      )}
    </div>
  );
}

function DriveSettings({
  driveId,
  name,
  onRenamed,
}: {
  driveId: string;
  name: string;
  onRenamed: (name: string) => void;
}) {
  const navigate = useNavigate();
  const [draft, setDraft] = useState(name);
  const [deleteName, setDeleteName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setDraft(name);
  }, [name]);

  async function onRename(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    const result = await renameSharedDrive(driveId, draft);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onRenamed(result.data.name);
    setDraft(result.data.name);
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
    <div className="grid gap-5">
      {error && <ErrorText className="mt-0">{error}</ErrorText>}
      <form className="grid gap-2" onSubmit={onRename}>
        <Field htmlFor="drive-rename" label="ドライブ名">
          <Input
            id="drive-rename"
            onChange={(event) => setDraft(event.target.value)}
            value={draft}
          />
        </Field>
        <div>
          <Button disabled={busy || draft.trim() === ""} type="submit">
            名前を変更
          </Button>
        </div>
      </form>
      <form
        className="grid gap-2 rounded-xl border border-border p-3"
        onSubmit={onDelete}
      >
        <p className="m-0 text-sm">ドライブを削除</p>
        <MutedText>
          中のノートとフォルダも消えます。確認のため、ドライブ名を入力してください。
        </MutedText>
        <Field htmlFor="drive-delete" label="ドライブ名">
          <Input
            id="drive-delete"
            onChange={(event) => setDeleteName(event.target.value)}
            value={deleteName}
          />
        </Field>
        <div>
          <Button
            disabled={busy || name === "" || deleteName !== name}
            type="submit"
            variant="danger"
          >
            ドライブを削除
          </Button>
        </div>
      </form>
    </div>
  );
}

function memberDialogTabs({
  canManage,
  domainLoadError,
  domains,
  domainsReady,
  members,
  membersLoadError,
  membersReady,
}: {
  canManage: boolean;
  domainLoadError: string | null;
  domains: SharedDriveDomain[];
  domainsReady: boolean;
  members: SharedDriveMember[];
  membersLoadError: string | null;
  membersReady: boolean;
}): Array<{ count?: number; id: Panel; label: string }> {
  const tabs: Array<{ count?: number; id: Panel; label: string }> = [
    {
      count: membersReady && !membersLoadError ? members.length : undefined,
      id: "members",
      label: "メンバー",
    },
  ];
  if (canManage || domains.length > 0) {
    tabs.push({
      count: domainsReady && !domainLoadError ? domains.length : undefined,
      id: "domains",
      label: "ドメイン",
    });
  }
  if (canManage) {
    tabs.push({ id: "drive", label: "ドライブ" });
  }
  return tabs;
}

function applyLoadedDrive(
  drive: Awaited<ReturnType<typeof fetchSharedDrive>>,
  listed: Awaited<ReturnType<typeof fetchDriveMembers>>,
  domainList: Awaited<ReturnType<typeof fetchDriveDomains>>,
  update: {
    setCanManage: (value: boolean) => void;
    setDomainLoadError: (value: string | null) => void;
    setDomains: (value: SharedDriveDomain[]) => void;
    setDomainsReady: (value: boolean) => void;
    setError: (value: string | null) => void;
    setMembers: (value: SharedDriveMember[]) => void;
    setMembersLoadError: (value: string | null) => void;
    setMembersReady: (value: boolean) => void;
    setName: (value: string) => void;
  },
) {
  if (drive.ok) {
    update.setName(drive.data.name);
    update.setCanManage(drive.data.role === "manager");
  } else {
    update.setError(drive.error);
  }
  if (listed.ok) {
    update.setMembers(listed.data);
    update.setMembersLoadError(null);
  } else {
    update.setMembersLoadError(listed.error);
  }
  update.setMembersReady(true);
  if (domainList.ok) {
    update.setDomains(domainList.data);
    update.setDomainLoadError(null);
  } else {
    update.setDomainLoadError(domainList.error);
  }
  update.setDomainsReady(true);
}

export function DriveMembersDialog({
  driveId,
  onClose,
}: {
  driveId: string;
  onClose: () => void;
}) {
  const titleId = useId();
  const membersTabId = useId();
  const domainsTabId = useId();
  const driveTabId = useId();
  const [name, setName] = useState("");
  const [canManage, setCanManage] = useState(false);
  const [members, setMembers] = useState<SharedDriveMember[]>([]);
  const [membersReady, setMembersReady] = useState(false);
  const [membersLoadError, setMembersLoadError] = useState<string | null>(null);
  const [domains, setDomains] = useState<SharedDriveDomain[]>([]);
  const [domainsReady, setDomainsReady] = useState(false);
  const [domainLoadError, setDomainLoadError] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>("members");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      fetchSharedDrive(driveId),
      fetchDriveMembers(driveId),
      fetchDriveDomains(driveId),
    ]).then(([drive, listed, domainList]) => {
      if (cancelled) {
        return;
      }
      applyLoadedDrive(drive, listed, domainList, {
        setCanManage,
        setDomainLoadError,
        setDomains,
        setDomainsReady,
        setError,
        setMembers,
        setMembersLoadError,
        setMembersReady,
        setName,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [driveId]);

  const tabs = memberDialogTabs({
    canManage,
    domainLoadError,
    domains,
    domainsReady,
    members,
    membersLoadError,
    membersReady,
  });
  const active = tabs.some((tab) => tab.id === panel) ? panel : "members";
  const tabIds: Record<Panel, string> = {
    domains: domainsTabId,
    drive: driveTabId,
    members: membersTabId,
  };

  return (
    <Modal labelledBy={titleId} onClose={onClose}>
      <ModalHeader id={titleId} onClose={onClose} title="メンバー">
        <MutedText className="mt-1">
          {name ? `${name} · メンバーのみ` : "メンバーのみ"}
        </MutedText>
      </ModalHeader>
      {tabs.length > 1 && (
        <div className="mb-3 flex gap-1 border-border border-b" role="tablist">
          {tabs.map((tab) => (
            <button
              aria-selected={active === tab.id}
              className={
                active === tab.id
                  ? "-mb-px border-accent border-b-2 px-3 py-1.5 text-sm"
                  : "-mb-px border-transparent border-b-2 px-3 py-1.5 text-muted text-sm"
              }
              id={tabIds[tab.id]}
              key={tab.id}
              onClick={() => setPanel(tab.id)}
              role="tab"
              type="button"
            >
              {tab.label}
              {tab.count !== undefined && (
                <span className="ml-1 text-muted text-xs">{tab.count}</span>
              )}
            </button>
          ))}
        </div>
      )}
      {error && <ErrorText>{error}</ErrorText>}
      {active === "members" && (
        <div aria-labelledby={membersTabId} role="tabpanel">
          <MembersPanel
            canManage={canManage}
            driveId={driveId}
            loadError={membersLoadError}
            members={members}
            onMembers={(next) => {
              setMembers(next);
              setMembersLoadError(null);
            }}
            ready={membersReady}
          />
        </div>
      )}
      {active === "domains" && (
        <div aria-labelledby={domainsTabId} role="tabpanel">
          {domainsReady ? (
            <DomainsPanel
              canManage={canManage}
              domains={domains}
              driveId={driveId}
              loadError={domainLoadError}
              onDomains={(next) => {
                setDomains(next);
                setDomainLoadError(null);
              }}
            />
          ) : (
            <MutedText>読み込み中…</MutedText>
          )}
        </div>
      )}
      {active === "drive" && canManage && (
        <div aria-labelledby={driveTabId} role="tabpanel">
          <DriveSettings driveId={driveId} name={name} onRenamed={setName} />
        </div>
      )}
    </Modal>
  );
}
