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
