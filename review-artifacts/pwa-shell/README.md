# PWA shell candidate

This is the fixed candidate directory for production app-shell work.
Paths mirror `apps/web/`, including build configuration, public assets, and
the separate service-worker source. Markdown records are not overlaid.
An optional `deleted-files.json` array lists Web-relative files to omit from
the disposable tree; it never deletes live source files. Paths must be
normalized and cannot also be supplied as replacement files.

Validate without changing live sources:

```sh
node apps/web/scripts/check-pwa-candidate.mjs review-artifacts/pwa-shell
```

The runner builds a disposable tree, starts an owned production-preview server,
and runs `tests/pwa` with the project-local Chromium installation. It checks
that live inputs and candidate bytes did not change. Dependencies must already
be declared and installed in the web project; the runner does not install them.

The initial empty candidate is a baseline harness smoke test and is expected
to fail because the live application still removes service workers.
This directory is not an adopted implementation.
