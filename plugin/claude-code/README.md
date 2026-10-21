# canarywatch — Claude Code plugin

Registers the canarywatch hook on `PreToolUse` (blocking). Write attempts
are counted before execution by the mass-modification detector (D4), so a
post-execution hook is not installed: it cannot prevent the action and could
count the same write twice.

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

## Install

From Claude Code, via the repo's marketplace (`.claude-plugin/marketplace.json`):

```text
/plugin marketplace add Seshadri724/Agent-Wires
/plugin install canarywatch@canarywatch
```

This installs the hook only. Plant bait with `canarywatch seed`; don't run
`canarywatch init` or `install-hook` alongside the plugin, or the hook is
registered twice.

The plugin manifest lives at `.claude-plugin/plugin.json`. It deliberately has
no `hooks` field: `hooks/hooks.json` is loaded automatically, and naming it
again is rejected as a duplicate.

`bin/canarywatch.mjs` (the npm `bin` entry) is built next to `hook.cjs` by the
same `npm run build:plugin`, but is gitignored: only `hook.cjs` has to be
committed for the plugin to work.
