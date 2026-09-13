# D60 folder denial primitive

## Decision

Folder denial is represented by a user-scoped marker in the existing
`metadata` object store. `denyFolder(id)` writes the canonical ID and does not
delete or invalidate the cached folder record, so a later ordinary
`putFolder` cannot accidentally revive a denied snapshot. `getFolder` reads
the bounded metadata prefix for the current user once, then projects denial:
the denied target is a miss, denied children are removed, and a readable
descendant is detached from the denied ancestry.

## Alternatives rejected

- Deleting the folder record alone loses the distinction between a cache miss
  and a confirmed denial and is defeated by stale writes.
- Deleting a subtree would incorrectly deny independently authorized child
  folders and notes (D59).
- One metadata lookup per crumb would add avoidable IndexedDB round trips;
  scanning all metadata would risk crossing user boundaries.

This slice intentionally does not add schema/version changes, root-alias
handling, marker clearing, physical cleanup, or network integration.

## D62 nearest visible parent

The D60 projection now derives `parentId` from the second-to-last projected
crumb when at least two visible crumbs remain. This preserves an independently
allowed child's identity as the nearest visible parent of a deeper allowed
descendant, while retaining `null` for a direct child of a denied ancestor.
The projected crumbs are computed once and used for both the returned crumbs
and parent derivation. Denied target/children filtering, hidden path and
`sourceFolder` cleanup, user/sibling isolation, and original `cachedAt` values
are unchanged. The separate read-overlap denial race remains out of scope.

## D63 read-order correction

The folder record is now read before the user-scoped denial markers. The marker
scan is the final storage boundary before projection, so a denial committed
while the native folder read is pending hides the target or removes the
denied ancestor from a descendant's projected crumbs. Existing closed,
suspension, lifetime, null-root, nearest-visible-parent, and original
`cachedAt` behavior remains unchanged. A missing folder record returns `null`
without inventing a timestamp.

This is candidate-only and remains unadopted. Composite reader and HTTP denial
wiring are separate future slices.
