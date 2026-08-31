# Weekly package upgrade

Upgrade outdated dependencies in this pnpm workspace, leaving all successful
changes in the working tree. Read `AGENTS.md` (if present), every `package.json`,
`pnpm-lock.yaml`, `pnpm-workspace.yaml`, and relevant implementation before
editing.

Use `pnpm outdated || true` to inspect available updates. Upgrade packages
one at a time or in tightly related groups, and keep only upgrades that can be
made compatible with the application. Upgrade coupled packages together
(workspace members, shared version pins, or ecosystem pairs such as `react` /
`react-dom`, `@types/*` with the matching runtime package, and families that
share a version line). Keep `pnpm.overrides` in sync when a pin changes.

Take special care with framework, compiler, linter, and major-version changes.
Do not force an incompatible major upgrade just because it is newer.

After each package group, run `pnpm check:fix` if needed, then verify with:

1. `pnpm check`
2. `pnpm typecheck`
3. `pnpm test`
4. `pnpm build`

If a group fails verification, undo only that group by restoring the previous
`package.json` files and `pnpm-lock.yaml` you observed before the upgrade, then
reinstall with `pnpm install --frozen-lockfile`. Leave the working tree passing
the verification sequence. Never leave a broken tree for the workflow to sort
out.

Hard constraints:

- Do not run `git`, `gh`, or any command that commits, pushes, or creates a pull
  request. The workflow performs those operations after verification.
- Do not read or write secrets, credentials, `.env*`, `.git/**`, or key files.
- Do not edit `.agents/**`, `.github/**`, `.claude/**`, `.cursor/**`,
  `.cursorignore`, `.cursorrules`, `.codex/**`, `.husky/**`, `AGENTS.md`,
  `CLAUDE.md`, `scripts/**`, or generated source trees named in the
  repository.
- Do not make product changes unrelated to compatibility with an upgrade.
- Do not switch package managers or toolchains. Stay on pnpm.

If everything is already current, leave the working tree unchanged and say so
in the final response. Otherwise, make the upgrades and compatibility fixes;
do not merely describe them. End with a short list of upgraded packages and
any groups you reverted.
