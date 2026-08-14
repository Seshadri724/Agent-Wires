# canarywatch — Claude Code plugin

Registers the canarywatch hook on `PreToolUse` (blocking) and `PostToolUse`
(for write-count tracking used by the mass-modification detector, D4).

## Current status: bundled, standalone

`hooks/hooks.json` invokes `node "${CLAUDE_PLUGIN_ROOT}/bin/hook.cjs"` — a
single-file, dependency-free CommonJS bundle built from `src/hook/hook.ts`
by `scripts/build-plugin.mjs` (`npm run build:plugin`, powered by esbuild).
It needs nothing from the rest of this repo at runtime: no `src/`, no
`node_modules`, no TypeScript. Verified byte-identical decisions against
the source `hook.ts` for the same input (canary read → deny, normal
read → allow) — see the smoke test in the Phase 1 build session.

**`bin/hook.cjs` is a generated file, but it is committed to the repo.**
Claude Code plugins have no install-time build step — Claude just runs the
command in `hooks.json` — so the bundle has to already exist as a static
file for the plugin to work once distributed. If you change anything under
`src/hook/`, `src/core/`, or `src/seeder/` (the hook's transitive
dependencies), **you must run `npm run build:plugin` and commit the
resulting `bin/hook.cjs` before the plugin will reflect the change.**
CI rebuilds the bundle and fails on any diff, so a stale commit is caught
rather than shipped (`.github/workflows/ci.yml`).

Output format is `.cjs` (not `.js`) deliberately: a bundled `.js` file's
module format (ESM vs CommonJS) depends on the nearest `package.json` once
the file is copied somewhere else. `.cjs` is unambiguous to Node regardless
of what surrounds it.

## Manual install (today)

From a project you want protected, add the equivalent of `hooks/hooks.json`
to that project's `.claude/settings.json` — or simpler, run:

```bash
node "<path-to-this-repo>/src/cli/cli.ts" init
```

which seeds canaries and prints the exact hook JSON to paste in.
