import {
  GOLD_UNLOCK_DEFAULT_MINUTES,
  LAYER_RANK,
  NOTE_LAYER_LABELS,
  type Note,
  type NoteLayer,
  type NoteSummary,
  nextLayer,
  type PromoteGateFailure,
} from "@miyulabmd/shared";
import { useRef, useState } from "react";
import { useDismiss } from "../../hooks/use-dismiss.ts";
import {
  changeNoteLayer,
  type LayerChangeResult,
  unlockNoteForEdit,
} from "../../lib/api.ts";
import { Button } from "../ui/Button.tsx";
import { HeaderButton } from "../ui/HeaderButton.tsx";
import { Input } from "../ui/Input.tsx";
import { LockIcon, LockOpenIcon, MedalIcon } from "../ui/icons.tsx";
import { MenuPanel, MenuSeparator } from "../ui/Menu.tsx";
import { ErrorText, MutedText } from "../ui/Text.tsx";

type Props = {
  isOwner: boolean;
  note: Note;
  onChanged: (note: NoteSummary) => void;
};

type BusyAction = "demote" | "promote" | "unlock" | null;

function GateFailures({ failures }: { failures: PromoteGateFailure[] }) {
  if (failures.length === 0) {
    return null;
  }
  return (
    <ul className="m-0 grid gap-1 pl-4">
      {failures.map((failure) => (
        <li className="text-[0.8rem] text-error" key={failure.code}>
          {failure.message}
        </li>
      ))}
    </ul>
  );
}

export function LayerMenu({ isOwner, note, onChanged }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<BusyAction>(null);
  const [error, setError] = useState<string | null>(null);
  const [failures, setFailures] = useState<PromoteGateFailure[]>([]);
  const [demoteReason, setDemoteReason] = useState("");
  const [demoteOpen, setDemoteOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useDismiss(open, () => setOpen(false), rootRef);

  const up = nextLayer(note.layer);
  const down =
    LAYER_RANK[note.layer] > 0
      ? (Object.keys(LAYER_RANK) as NoteLayer[]).find(
          (key) => LAYER_RANK[key] === LAYER_RANK[note.layer] - 1,
        )
      : null;
  const needsConfirm = failures.some((f) => f.code === "needs_confirm");
  const unlockLeft = note.goldUnlockedUntil
    ? Math.max(0, note.goldUnlockedUntil - Date.now())
    : 0;

  function apply(result: LayerChangeResult) {
    if (result.ok) {
      onChanged(result.note);
      setFailures([]);
      setError(null);
      setDemoteOpen(false);
      setDemoteReason("");
      return;
    }
    setFailures(result.failures ?? []);
    setError(result.error ?? (result.failures ? null : "操作に失敗しました"));
  }

  async function run(
    action: BusyAction,
    call: () => Promise<LayerChangeResult>,
  ) {
    setBusy(action);
    setError(null);
    try {
      apply(await call());
    } catch {
      setError("通信に失敗しました");
    } finally {
      setBusy(null);
    }
  }

  function promote(confirm: boolean) {
    if (!up) {
      return;
    }
    const to = up;
    run("promote", () => changeNoteLayer(note.id, { confirm, to }));
  }

  function demote() {
    if (!(down && demoteReason.trim())) {
      return;
    }
    const to = down;
    run("demote", () =>
      changeNoteLayer(note.id, { reason: demoteReason.trim(), to }),
    );
  }

  function unlock() {
    run("unlock", () =>
      unlockNoteForEdit(note.id, GOLD_UNLOCK_DEFAULT_MINUTES),
    );
  }

  return (
    <div className="relative" ref={rootRef}>
      <HeaderButton
        aria-expanded={open}
        aria-haspopup="dialog"
        icon={note.goldLocked ? <LockIcon /> : <MedalIcon />}
        label={note.layer}
        onClick={() => setOpen((value) => !value)}
        title={NOTE_LAYER_LABELS[note.layer]}
      />
      {open && (
        <MenuPanel role="dialog" width="17rem">
          <div className="grid gap-2 px-3 py-2">
            <p className="m-0 text-[0.85rem] font-medium">
              {NOTE_LAYER_LABELS[note.layer]}
              {note.layer === "gold" &&
                (note.goldLocked ? (
                  <span className="ml-2 text-[0.75rem] font-normal text-muted">
                    ロック中
                  </span>
                ) : (
                  <span className="ml-2 text-[0.75rem] font-normal text-accent">
                    解除中（残り約{Math.ceil(unlockLeft / 60000)}分）
                  </span>
                ))}
            </p>
            {!isOwner && <MutedText>閲覧のみ</MutedText>}
            {isOwner && (
              <>
                {note.goldLocked && (
                  <Button
                    className="w-full"
                    disabled={busy !== null}
                    onClick={unlock}
                    type="button"
                    variant="accent"
                  >
                    <LockOpenIcon />
                    解除して編集（{GOLD_UNLOCK_DEFAULT_MINUTES}分）
                  </Button>
                )}
                {up && (
                  <Button
                    className="w-full"
                    disabled={busy !== null}
                    onClick={() => promote(needsConfirm)}
                    type="button"
                  >
                    {needsConfirm ? "確認して" : ""}
                    {NOTE_LAYER_LABELS[up].replace(/（.*）/, "")} に昇格
                  </Button>
                )}
                <GateFailures failures={failures} />
                {down && (
                  <>
                    <MenuSeparator />
                    {demoteOpen ? (
                      <form
                        className="grid gap-2"
                        onSubmit={(event) => {
                          event.preventDefault();
                          demote();
                        }}
                      >
                        <Input
                          aria-label="降格理由"
                          className="w-full"
                          onChange={(event) =>
                            setDemoteReason(event.target.value)
                          }
                          placeholder="降格理由（必須）"
                          type="text"
                          value={demoteReason}
                          variant="pill"
                        />
                        <Button
                          className="w-full"
                          disabled={busy !== null || !demoteReason.trim()}
                          type="submit"
                        >
                          {NOTE_LAYER_LABELS[down].replace(/（.*）/, "")} に降格
                        </Button>
                      </form>
                    ) : (
                      <Button
                        className="w-full"
                        disabled={busy !== null}
                        onClick={() => setDemoteOpen(true)}
                        type="button"
                      >
                        降格…
                      </Button>
                    )}
                  </>
                )}
              </>
            )}
            {error && <ErrorText>{error}</ErrorText>}
          </div>
        </MenuPanel>
      )}
    </div>
  );
}
