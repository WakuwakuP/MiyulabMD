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
