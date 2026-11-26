# canarywatch

**Tripwires for AI agents.** Deterministic, explainable runtime guardrails that catch autonomous agents the moment they touch files or run commands they should never touch.

## Overview

Autonomous coding agents operating on developer machines risk reading `.env` or credential files, modifying files outside their task scope, or exfiltrating sensitive data. Traditional EDR treats agent tool calls as trusted user process execution, while prompt-level guardrails live inside the untrusted LLM context.

`canarywatch` seeds realistic honeypot files ("canaries") into a workspace, evaluates tool calls deterministically before execution against a signed manifest and policy, **pauses the agent session** (rather than killing the host process) when a tripwire fires, and records every decision to a tamper-evident local hash chain.

## Supported Boundary

Canarywatch enforces policy across two local integration points:

1. **Claude Code `PreToolUse` hook (`plugin/claude-code/bin/hook.cjs`)**: Intercepts supported tool calls (`Read`, `Write`, `Edit`, `Glob`, `Grep`, `NotebookEdit`, `Bash`, and `mcp__*`) before execution. Policy violations deny the tool call and lock the session until a human reviews and runs `canarywatch resume <session-id>`.
2. **Optional MCP stdio proxy (`canarywatch mcp-proxy`)**: Wraps stdio Model Context Protocol (MCP) servers and inspects incoming JSON-RPC `tools/call` requests against the same policy engine and canary manifest.

> **Boundary limitation:** Canarywatch is **not** an OS sandbox or EDR. Shell command parsing is best effort, and actions outside these two integration points (direct OS/kernel syscalls, unsanctioned background processes, raw-socket network transfers, unproxied MCP servers, or other agent harnesses) are **unobserved**. Daemon mode and a centralized team control plane are not built. Do not rely on this as the sole security boundary for production systems.

## Detectors (`D1`–`D7`)

Every tool call is evaluated synchronously at the pre-execution boundary by seven deterministic detectors:

| ID | Detector | Blocks Before Execution? | Evidence Recorded | Known Gaps |
|---|---|---|---|---|
| **D1** | **Canary** | **Yes** on targeted `Read`, `Write`, `Delete`, or reuse of seeded canary token strings in later tool inputs.<br>*Broad directory sweeps (`list` access via `Glob` / directory `Grep`) are logged without blocking to prevent false positives.* | Session ID, tool name, touched path, timestamp, and violation reason. | Cannot detect access if no canaries are seeded or touched; broad directory listing is not blocked. |
| **D2** | **Sensitive Path** | **Yes** on targeted read/write/delete matching `policy.sensitivePaths` (e.g. `**/.env`, `**/.env.*`, `**/.ssh/**`, `**/.aws/credentials`, `**/id_rsa`, `**/id_ed25519`, `**/*.pem`), even without workspace canaries. | Session ID, tool name, matched path, timestamp, and reason. | Limited to configured glob patterns; non-standard credential paths must be added to `policy.json`. |
| **D3** | **Scope** | **Warns first, then blocks.** Warns on the first write/delete outside declared workspace scope roots (`d3.warnBeforePause: 1`), then pauses on subsequent violations. | Session ID, tool name, attempted write path, timestamp, and scope roots. | Reads outside scope are not restricted; requires `scopeEnforced: true` and scope roots (defaults to workspace root). |
| **D4** | **Mass Modification** | **Yes**, once writes/deletes exceed `massMod.threshold` inside `massMod.windowMs` (default: `> 50` writes in `10,000ms`). | Session ID, tool name, timestamps in window, threshold, and window duration. | Actions below the rate threshold or inside `massMod.allowlistDirs` (`node_modules`, `.git`, `dist`, `build`, `target`, `.next`, `coverage`) are excluded. |
| **D5** | **Dangerous Shell** | **Yes**, matches shell commands against configured `dangerousCommands` patterns (e.g. `rm -rf /`, `curl * \| bash`, `base64 -d \| bash`, `nc -e`, `ngrok`). | Session ID, tool name, matched pattern, and timestamp. | Pattern-based matching; novel shell obfuscation, variable indirection, or compiled binaries can evade lexing. |
| **D6** | **MCP Authorization** | **Yes**, checks resolved MCP server (`mcp__<server>__<tool>` or proxy `--server`) and tool name against `policy.mcp` allow/block lists. | Session ID, tool name, resolved MCP server name, and timestamp. | Depends on Claude Code's `mcp__<server>__<tool>` naming convention or running through `canarywatch mcp-proxy`. |
| **D7** | **Exfiltration** | **Yes**, detects outbound network commands (`curl`, `wget`, `nc`, `ncat`, `socat`, `scp`, `rsync`, `ssh`) referencing canary or sensitive paths. | Session ID, tool name, protected path, and timestamp. | Heuristic argument matching; raw-socket or in-memory exfiltration (e.g. via Python/Node scripts) is unobserved. |

## Installation

**Requirements:** Node.js `>= 22.18.0`.

Everything runs 100% locally: canary files are written to your workspace, state and tamper-evident logs are stored in `~/.canarywatch` (or `$CANARYWATCH_HOME`), and hooks are registered in `~/.claude/settings.json`. Nothing is sent over the network.

### Option 1: Source checkout (hook + CLI + bait)

```bash
git clone https://github.com/Seshadri724/Agent-Wires.git
cd Agent-Wires
npm install         # installs devDependencies and builds plugin/CLI bundles
npm link            # exposes `canarywatch` globally
canarywatch init    # seeds default canaries, initializes policy, and registers the Claude Code hook
canarywatch doctor  # read-only preflight check of setup, state integrity, and unobserved surfaces
```

### Option 2: Claude Code Plugin (hook only)

From Claude Code, add the marketplace and install the plugin:

```text
/plugin marketplace add Seshadri724/Agent-Wires
/plugin install canarywatch@canarywatch
```

> **Important:** The plugin registers the `PreToolUse` hook only—it does **not** automatically plant canary bait. Because the hook **fails closed** when the canary manifest is missing or empty, you must seed at least one workspace before using Claude Code:
>
> ```bash
> canarywatch seed [workspace]
> ```
>
> Do **not** run `canarywatch init` or `canarywatch install-hook` when using the Claude Code plugin, as that will register the hook twice.

### Using the MCP Stdio Proxy

To enforce policy on any stdio MCP server outside or alongside Claude Code:

```bash
canarywatch mcp-proxy --session=my-session --cwd=/path/to/workspace --server=filesystem npx -y @modelcontextprotocol/server-filesystem /path/to/workspace
```

## Diagnostics, Evaluation & Audit Evidence

### Preflight & Self-Test

* **`canarywatch doctor [--json]`**: Strictly read-only diagnostic check. Reports `READY`, `MISSING`, `NOT SEEDED`, or `FAIL` across hook registration, hook bundle version parity, state directory permissions, `policy.json` schema, workspace manifest HMACs, hash-chain integrity, and Node version—plus explicit `UNOBSERVED` surfaces.
* **`canarywatch test`**: Runs an isolated subprocess self-test against the actual hook script (`bin/hook.cjs` or `src/hook/hook.ts`) in a temporary directory.

### Boundary Contract Evaluation

```bash
canarywatch evaluate        # human-readable boundary contract report
canarywatch evaluate --json # machine-readable JSON conforming to schemas/evaluation-v1.schema.json
```

`canarywatch evaluate` runs **13 isolated scenarios** (9 blocked across `D1`–`D7` and session lock, 3 allowed baseline cases including `Glob` directory listing and first `D3` scope warning, and 1 explicitly `unobserved` raw-socket scenario) without modifying your workspace or `~/.canarywatch` state.

> Passing `evaluate` verifies the deterministic hook contract on fixed scenarios; it is **not** a security score and does not measure recall, precision, or real-world false-positive rates.

### Tamper-Evident Logs, Replay & Export

Every decision is appended to `~/.canarywatch/events.jsonl` as a SHA-256 hash chain anchored by an HMAC-signed `head.anchor.json`:

```bash
canarywatch events --verify                                      # verify full hash chain and view recent events
canarywatch events --pending                                     # view blocked events for currently locked sessions
canarywatch replay <session-id>                                  # step-by-step redacted timeline for one session
canarywatch export --session <session-id> --format json          # export redacted JSON bundle
canarywatch export --session <session-id> --format ocsf --out evidence.json
```

`events`, `replay`, and `export` scrub known secret patterns (API keys, private keys, JWTs, bearer tokens) and redact workspace/home/state directory paths.

## CLI Reference

| Command | Description |
|---|---|
| `canarywatch init [workspace]` | Create default policy, seed `standard` canaries, and register Claude Code hook. |
| `canarywatch seed [workspace] [--density=light\|standard\|paranoid]` | Seed decoy files and update `.gitignore` (never overwrites existing files). |
| `canarywatch unseed [workspace]` | Remove unmodified seeded canaries from workspace and manifest (preserves user-modified files). |
| `canarywatch doctor [workspace] [--json]` | Read-only check of hook setup, bundle parity, policy, manifest, log integrity, and blind spots. |
| `canarywatch status [workspace]` | Summarize workspace canary counts, policy settings, locked sessions, and log chain health. |
| `canarywatch events [N] [--pending] [--verify] [--session <id>] [--json]` | Inspect and verify the hash-chained event log. |
| `canarywatch replay <session-id>` | Print a redacted step-by-step decision timeline for a session. |
| `canarywatch export [--session <id>] [--format json\|ocsf] [--out <file>]` | Export redacted audit evidence in JSON or OCSF format. |
| `canarywatch scope add <path>` / `canarywatch scope list` | Add or view allowed write-scope roots for the current workspace. |
| `canarywatch exempt <path> [--access=...] [--session=<id>] [--ttl=<ms>]` | Grant a temporary or global path exemption. |
| `canarywatch resume <session-id>` | Unlock a paused/locked session after human review. |
| `canarywatch kill <session-id>` | Manually lock a session so all further tool calls are denied. |
| `canarywatch mcp-proxy [--session=ID] [--cwd=DIR] [--server=NAME] <cmd> [args...]` | Run an MCP server behind the stdio JSON-RPC policy proxy. |
| `canarywatch simulate <tool> [input]` | Dry-run `evaluate()` against mock tool input without locking sessions. |
| `canarywatch test` | Run the isolated subprocess self-test against the hook artifact. |
| `canarywatch evaluate [--json]` | Run the 13-scenario boundary contract suite. |
| `canarywatch install-hook [--dry-run]` / `canarywatch uninstall-hook` | Register or remove the managed hook in `~/.claude/settings.json`. |

## Local State Files

All local state lives in `~/.canarywatch` (overridable via `CANARYWATCH_HOME`):

* `key` — 32-byte random HMAC key (`0600` on POSIX) used to sign manifest entries and the log head anchor.
* `manifest.json` — HMAC-signed registry of seeded canary paths, SHA-256 file hashes, and token IDs.
* `policy.json` — Configurable detector rules (`sensitivePaths`, `scopeEnforced`, `massMod`, `d3`, `mcp`, `dangerousCommands`).
* `events.jsonl` & `head.anchor.json` — SHA-256 hash-chained decision log and signed tail-truncation anchor.
* `sessions/` & `scopes/` — Per-session lock/violation state and declared workspace scope roots.

## Development & Verification

```bash
npm run typecheck                  # tsc --noEmit
npm test                           # run full Node test suite (test/*.test.ts)
npm run selftest                   # run `canarywatch test`
npm run build:plugin               # bundle plugin/claude-code/bin/hook.cjs and canarywatch.mjs
npm run build:beta                 # build standalone tester artifact in dist/canarywatch-beta/
npm run check:evaluation-artifacts # verify evaluate --json across source, plugin, and beta builds
npm run smoke:beta-install         # end-to-end test of extracted beta bundle install/hook/unseed
npm run smoke:package-install      # end-to-end npm pack + install smoke test
npm run bench                      # measure hook latency (in-process vs subprocess cold start)
```

> **Note for contributors:** `plugin/claude-code/bin/hook.cjs` is generated by `npm run build:plugin` and **must be committed** whenever `src/hook/`, `src/core/`, or `src/seeder/` changes. CI verifies bundle freshness on `ubuntu-latest` with `git diff --exit-code -- plugin/claude-code/bin/hook.cjs`.

## Uninstall

```bash
canarywatch uninstall-hook  # removes managed hook from ~/.claude/settings.json (and legacy ~/.claude.json)
canarywatch unseed          # removes unmodified seeded canaries and .gitignore entries
```

Optionally remove `~/.canarywatch` afterward to delete local keys, policies, and logs.

## Status & Feedback

* **Current scope:** Claude Code `PreToolUse` hook + optional stdio MCP proxy. OS-level daemon monitoring, Windows file ACL hardening, and team control-plane sync are not built.
* **Platform validation:** Automated test suites, typecheck, self-tests, and CI workflows run across Windows, Linux, and macOS (`ubuntu-latest`, `windows-latest`, `macos-latest`), while real-world multi-team pilot telemetry is still being gathered.
* **Legacy bait notice:** If you seeded before unlabeled decoy templates landed, run `canarywatch unseed` followed by `canarywatch seed`.
* **Design docs:** Internal design and roadmap notes are kept out of this repository (`docs/` is gitignored).
* **Issues & bug reports:** [https://github.com/Seshadri724/Agent-Wires/issues](https://github.com/Seshadri724/Agent-Wires/issues)

## License

MIT — see [LICENSE](LICENSE).
