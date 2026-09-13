# MyDrive prefetch candidate decisions

This candidate implements the first D75 startup slice only. `AppShell` starts one
best-effort cycle after an authenticated viewer with a matching cache identity is
resolved. The cycle acquires the real root and each folder response, stores the
full notes-list response, and fetches bodies only for notes owned by that viewer
and contained in the owned folder tree.

The folder tree is only a set of ownership IDs: it is never converted into
`FolderAccess`. Folder API responses provide the saved permissions and crumbs.
The existing note cache's ordering token prevents an older body request from
reviving a durable denial. Existing bodies are skipped when their `updatedAt` is
at least the list summary's value.

This intentionally does not add retry triggers, cross-tab coordination,
coalescing with foreground reads, image acquisition, or a completion model.
Stopping is best effort and is represented by the public `stopped` result rather
than a download-complete claim.

## D77: Capture the prefetch ownership snapshot at the public entry point

The public `prefetchMyDrive` entry point now synchronously clones the
`ViewerContext` and its nested user before any await. Mode validation, cache
opening, and note target filtering all use that owned snapshot. This prevents a
caller mutation of `cacheViewerId` or `user.id` after entry from switching an
in-flight Alice prefetch to Bob, without mutating or freezing the caller and
without introducing mutable global ownership state.
