# Mounted denial propagation: parent RED

Baseline: live `311802e`. Durable note/folder cache fencing and late-response
rejection are implemented, but their denial methods do not yet publish target
events to already-mounted consumers. Image-specific invalidation is separate.

Actual command:

```sh
pnpm --filter @miyulabmd/web test:browser mounted-note-denial.spec.ts --workers=1
```

**4 failed** at the expected mounted-body removal assertion:

- authenticated network note, canonical route;
- authenticated network note, short route;
- cached readonly note, canonical route;
- cached readonly note, short route.

In each case a separate same-context page's public `NoteReadSession` observed
same-actor HTTP403 and completed denial. The first page still contained the
private body (expected0, actual1). An independent note is also mounted in a
third page; the test requires preserving it and forbids a refetch loop once
target removal is implemented. Existing assertions are retained.

Next rule: propagate a typed, user-scoped target denial to current consumers,
without using identity-wide logout/purge or replacing unrelated editor buffers.
Preserve canonical/short matching, parent-note attachment revocation, and
independent folder descendants. Durable success and storage-failure warnings
must not be conflated: a failed marker write is not a successful purge, but
known permission denial must not authorize continued display of the target.

This regression is deliberately kept RED pending the separate C2 UI slice.
The prior198-pass live suite predates these four new acceptance cases.
