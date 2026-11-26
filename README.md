# canarywatch

**Tripwires for AI agents.** Deterministic, explainable runtime guardrails that catch autonomous agents the moment they touch files they should never touch.

## The one-liner

Autonomous agents operating on developer filesystems risk reading `.env` files, mass-editing outside their scope, or leaking protected files. EDR exists for malware, but agent tooling requires runtime boundary awareness. canarywatch seeds honeypot files agents should never touch, checks tool calls against policy and canary manifests, and **pauses the agent session** — not the process — when a tripwire fires.

## Supported boundary

Canarywatch currently monitors and enforces policy across two integration points:

1. **Claude Code `PreToolUse` hook**: Intercepts supported file and shell tool calls (`Read`, `Write`, `Edit`, `Glob`, `Grep`, `NotebookEdit`, `Bash`, and `mcp__*`) before execution. When a policy violation occurs, Canarywatch denies the tool call before it executes and pauses the session.
2. **Optional MCP stdio proxy (`canarywatch mcp-proxy`)**: Intercepts JSON-RPC tool calls between an agent harness and stdio Model Context Protocol (MCP) servers, enforcing access policies on tool names and file arguments.

**Important boundary limitation:** This is not an OS sandbox or EDR. Shell parsing is best effort, and actions that bypass these integration points (such as direct kernel syscalls, unsanctioned background processes, or harness tools outside `PreToolUse`) cannot be observed. Daemon mode and the team control plane are not built. Do not use this as the sole security boundary for production systems.

## What it detects

Canarywatch implements seven deterministic detectors. Each detector evaluates tool calls at the pre-execution boundary:

| ID | Detector | Blocks Before Tool Runs? | Evidence Reported | Known Gaps |
|---|---|---|---|---|
| **D1** | **Canary** | **Yes** for targeted `Read`, `Write`, `Delete`, or canary secret reuse in tool inputs.<br>*Note: Broad directory sweeps (list access) are logged without blocking to prevent false alarms.* | Session ID, tool name, touched path, timestamp, and specific violation reason. | Cannot detect access if an agent never touches seeded canaries; does not block directory listing. |
| **D2** | **Sensitive Path** | **Yes** on targeted read/write/delete of sensitive paths matching `policy.sensitivePaths` (e.g. `.env`, `~/.ssh/id_rsa`, `~/.aws/credentials`), even with an empty canary manifest. | Session ID, tool name, sensitive path, timestamp, and approval requirement reason. | Limited to configured path patterns; non-standard secret paths are unobserved unless added to policy. |
| **D3** | **Scope** | **Warns first, then blocks.** Warns on first write/delete outside declared workspace scope roots, then escalates to block on subsequent violations. | Session ID, tool name, attempted write path, timestamp, and scope roots. | Reads outside scope are not blocked; requires declared scope roots (`canarywatch scope add`). |
| **D4** | **Mass Modification** | **Yes**, once write count exceeds the configured threshold within the time window (default: >50 writes in 10s). | Session ID, tool name, recent write timestamps, window duration, and threshold. | Writes below the threshold are allowed; allowlisted directories (e.g. `node_modules`) are excluded. |
| **D5** | **Dangerous Shell** | **Yes**, inspects shell command strings against known dangerous patterns (`rm -rf /`, `curl \| bash`, `base64 -d \| bash`, `ngrok`, reverse shells). | Session ID, tool name, matched command pattern, and timestamp. | Pattern-based heuristic matching; novel shell obfuscation, variable indirection, or compiled binaries may evade detection. |
| **D6** | **MCP Authorization** | **Yes**, inspects tool name (`mcp__<server>__<tool>`) or proxy metadata against allowed/blocked server lists. | Session ID, tool name, resolved MCP server name, timestamp, and authorization status. | Relies on harness naming conventions or the stdio proxy; untagged tools from custom harnesses cannot be attributed. |
| **D7** | **Exfiltration** | **Yes**, inspects shell commands matching outbound network tools (`curl`, `wget`, `nc`, `scp`, `ssh`) referencing protected files or canaries. | Session ID, tool name, network command, protected file path, and timestamp. | Heuristic regex on command arguments; in-memory exfiltration via raw sockets (e.g. in Python or Node scripts) is not observed in v1. |

## Install (pilot / beta)

### Claude Code plugin (hook only)

If using Claude Code's plugin manager:

```text
/plugin marketplace add Seshadri724/Agent-Wires
/plugin install canarywatch@canarywatch
```

The plugin automatically registers the `PreToolUse` hook. It does not plant honeypot bait. To seed canaries, run:

```bash
canarywatch seed [workspace]
```

*(Do not run `canarywatch init` or `canarywatch install-hook` when using the plugin, to avoid duplicate hook registration).*

### CLI from source (hook + bait)

To install from source checkout:

```bash
git clone https://github.com/Seshadri724/Agent-Wires.git
cd Agent-Wires
npm install       # installs dependencies and builds the plugin/CLI bundles
npm link          # exposes the `canarywatch` CLI command globally
canarywatch init  # seeds honey-credentials and registers the Claude Code hook in ~/.claude/settings.json
canarywatch doctor # read-only check of hook registration, bundle version, policy, manifest, state integrity, and unobserved surfaces
```

Requires Node >= 22.18.0.

Everything canarywatch does is local: it writes decoy files into your workspace, appends to a local event log in `~/.canarywatch`, and registers the hook in `~/.claude/settings.json`. Nothing is sent over the network.

To evaluate what Canarywatch catches, allows, and cannot observe:

```bash
canarywatch evaluate        # terminal readable boundary contract report
canarywatch evaluate --json # machine-readable JSON report for issue attachment
```

The evaluation runs 13 isolated scenarios separating blocked cases (D1–D7 and session lock), allowed cases (listing, ordinary reads, first scope warning), and unobserved cases outside the supported hook boundary (such as raw-socket exfiltration). It is a contract check, not a security score. JSON reports identify the versioned schema in `schemas/evaluation-v1.schema.json`.

`canarywatch doctor` (and `canarywatch doctor --json`) is strictly read-only: it distinguishes `READY`, `MISSING`, `NOT SEEDED`, `FAIL`, and `UNOBSERVED` surfaces without silently repairing settings or creating state.

To verify local evidence and export a redacted report with home/workspace paths and secret values scrubbed:

```bash
canarywatch events --verify
canarywatch export --session <session-id> --format json
```

For running a bounded 14-day team pilot without adding telemetry, see [docs/PILOT-WORKSHEET.md](docs/PILOT-WORKSHEET.md) and [docs/THREAT-MODEL.md](docs/THREAT-MODEL.md).

To remove Canarywatch:

```bash
canarywatch uninstall-hook  # removes hook from Claude Code settings
canarywatch unseed          # removes seeded canaries from workspace
```

Then optionally delete the local `~/.canarywatch` state directory.

## Feedback

Found a false positive, a crash, or something confusing? Open an issue:
https://github.com/Seshadri724/Agent-Wires/issues

## Status

Current pilot scope is the Claude Code `PreToolUse` hook plus the optional MCP stdio proxy. This is not an OS sandbox or EDR: shell parsing is best effort, and actions that bypass these integration points are not covered. Daemon mode and the team control plane are not built. Do not use this as the sole security boundary for production systems.

The evaluation command checks selected repeatable scenarios only. Passing it does not establish exhaustive attack coverage or a measured false-positive rate; detector behavior and known gaps are listed above.

On the current Windows development machine, automated tests, typecheck, the bundled hook self-test, and the repeatable evaluation pass. Other supported operating systems and real customer workflows still need validation.

If you seeded before unlabeled bait landed, run `canarywatch unseed` then `canarywatch seed` so old self-labeled files are replaced.

Design docs are kept out of this repo.

## License

MIT — see [LICENSE](LICENSE).
