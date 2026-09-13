# D47 cached MyDrive navigation

## Decision

The cached drive reader uses the existing folder and note-list snapshots keyed
by the resolved cached viewer ID. A cached viewer has no `user` and is never
treated as the public/guest listing. Folder and note-list misses remain
distinguishable from empty results. Cached rows reuse the existing routes and
markup but pass an explicit readonly capability, which suppresses hover
prefetch and row menus.

## Alternatives rejected

- Calling the folder or notes APIs when a snapshot is missing: this violates
  best-effort readonly offline behavior.
- Treating a missing folder as empty: this hides incomplete cache coverage.
- Creating a second IndexedDB schema: the existing persistent snapshots already
  carry IDs, parent links, crumbs, and cached timestamps.

This candidate intentionally does not implement prefetch, service-worker
support, online persistence, schema changes, or note body loading.

## D48 repair plan

D47 is rejected for replacing the complete online HomePage with a cached-only
screen and for compressing the shared list components. The repair keeps the
complete live HomePage as `NetworkHomePage` and adds only a small route wrapper
that selects cached rendering after viewer resolution. Cached rendering remains
on the existing route and reuses `NoteTree`/`DriveList` with an explicit
readonly capability.

The rejected alternatives were (1) retaining the cached-only replacement,
which breaks authenticated and guest online behavior, and (2) duplicating the
drive tree in a separate offline route, which risks route and markup drift.
The chosen design preserves all normal dialogs and operations, suppresses
menus/context handlers/prefetch only for cached rows, and uses a
viewer-owned, abortable viewing scope for final publication.
