# MyDrive prefetch coordinator decisions

## D85

- **Scope:** Candidate-only coordinator for the authenticated `AppShell` viewer
  lifetime. The existing `prefetchMyDrive` implementation remains the sole
  acquisition, storage, and error-classification path.
- **Signals:** Startup, `online`, and `visibilitychange` while the document is
  visible share one debounced scheduler. Other triggers, auth refresh,
  cross-tab coordination, and merging with normal requests remain out of
  scope.
- **Eligibility:** The coordinator snapshots an authenticated viewer only when
  `cacheViewerId` matches the authenticated user's ID. Guest, cached, and
  unavailable viewers cannot start network acquisition.
- **Scheduling:** A 200 ms debounce coalesces bursts, and a 1000 ms minimum
  attempt interval prevents tight automatic retries. There is at most one
  active cycle; signals received during it retain one pending rerun so a
  recovery event is not lost when the old request fails.
- **Lifetime:** Disposal removes both listeners and any timer, aborts the
  active cycle, and prevents completion handlers from scheduling new work.
  This also makes React StrictMode's attach/dispose/reattach sequence safe.
- **Rejected alternatives:** Retrying continuously, retaining a persistent
  queue, starting for cached viewers, or copying the acquisition/error policy
  into the coordinator would broaden this slice and risk unauthorized or
  duplicate work.
