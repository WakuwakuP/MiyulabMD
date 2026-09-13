# D52 Home metadata reader decisions

- **Status:** Candidate vertical slice only; not adopted into `apps/web/src`.
- **Choice:** `readHomeMetadata` owns the captured viewer's required folder/public
  folder and full notes reads, then performs awaited best-effort metadata writes.
  Home publishes only results still owned by its `AbortController`.
- **Alternatives rejected:** Per-setter saves would scatter viewer, cancellation,
  and storage-failure policy. The existing global list cache remains for legacy
  callers but is not used to initialize this network Home.
- **Bounded cost:** Folder visits refetch the complete `/api/notes` list. No
  prefetch/coalescing or 503 fallback is included in D52.
- **Cancellation:** API signals and metadata transaction signals are threaded
  through. Transaction completion remains authoritative; pending transactions
  abort and clean their listeners and user-operation registry entries.

## D53 viewer-lifetime fix

- Candidate-only fix: `HomePage` derives a structured NetworkHomePage key from
  viewer mode, the current user ID (or `null`), and `cacheViewerId`.
- The key is applied in both the `userLoading` and normal network returns.
  It intentionally excludes `folderId`, so same-viewer folder navigation keeps
  existing UI state and create-to-share behavior.
- A viewer association change remounts `NetworkHomePage`; its existing effect
  cleanup aborts the previous metadata read and discards all local display
  state before the new viewer's request resolves.
- CachedDriveView's existing folder-and-viewer key and all live application
  sources remain unchanged. This is a review candidate, not an adoption.

## D54 viewer snapshot capture

- Candidate-only implementation: `readHomeMetadata` synchronously copies the
  incoming `ViewerContext` and its nested `user` before starting network work.
  All branch selection and `saveHomeMetadata` ownership checks use that owned
  snapshot.
- This prevents a caller that reuses and mutates the original viewer object
  while requests are pending from redirecting Alice's completed metadata save
  into Bob's cache. The snapshot does not freeze or mutate caller state, and
  existing signal/current-owner cancellation checks remain unchanged.
- Scope is limited to `src/lib/home-metadata-reader.ts`; mode gating, warning UI,
  and cancellation-reason behavior remain later review items. The candidate is
  not adopted into live `apps/web/src`.
