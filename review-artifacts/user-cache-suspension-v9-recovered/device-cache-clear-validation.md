# Device private-cache clear validation (candidate)

The browser test plan is `manual-cache-clear.spec.ts` and
`manual-cache-clear-tabs.spec.ts`. It must use real IndexedDB, OPFS, Web Locks,
native `createWritable`/`close` gates, and a Cache Storage shell assertion.
The required cases are: complete multi-user deletion with viewer-id and shell
retained; fresh writes after success; stale scope/handle rejection; disabled
BroadcastChannel and held transport; unknown-user writes draining; held image
acquisition; OPFS failure with retry; IndexedDB failure before OPFS deletion;
lock-order progress; and abort with no implicit retry.

This change was implemented without the browser dependencies available in this
environment, so the browser matrix and candidate typecheck remain unexecuted.
UI, prefetch, editor, and live `apps/web/src/**` integration are intentionally
out of scope.
