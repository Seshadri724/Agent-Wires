# canarywatch

**Tripwires for AI agents.** Deterministic, explainable runtime guardrails that catch autonomous agents the moment they touch files they should never touch.

## The one-liner

Every company letting autonomous agents touch filesystems is one bad prompt injection away from an agent reading `.env` files, mass-editing outside its scope, or exfiltrating a directory. EDR exists for malware. Nothing equivalent exists for agents. canarywatch seeds honeypot files agents should never touch, watches for scope violations with deterministic file-event detection, and **pauses the agent session** — not the process — when a tripwire fires.

## Why this wins

| Property | canarywatch | ML-based anomaly detection | Prompt-level guardrails |
|---|---|---|---|
| False-positive behavior | Deterministic — a canary touch is always a violation | Probabilistic, tunable, noisy | Model-dependent, bypassable |
| Explainability | "Agent read `.aws/credentials` bait at 14:02" | Feature-weight soup | Opaque |
| Response | Pause session, human review | Kill process (dangerous) | Refuse (already too late if injected) |
| Deployment | A hook + a folder of decoys | Endpoint agent + training period | Per-prompt integration |

The key insight from the ransomware-era version of this idea: **agents are interruptible in a way ransomware isn't.** You never need to kill a process. You pause the loop, surface the violation, and let a human decide. The response problem — the hardest part of the original product — gets *easier* in the agent framing.

## Product shape

1. **Hook mode (ships first):** a plugin for Claude Code and compatible harnesses. Intercepts tool calls before execution, checks them against canary manifest + scope policy, blocks-and-pauses on violation. Trivial distribution: one `settings.json` entry.
2. **Daemon mode (ships second):** a standalone filesystem sensor (Windows USN Journal + ETW, Linux fanotify/eBPF, macOS Endpoint Security) that works with *any* agent, any runtime, no harness cooperation required.
3. **Classic mode (free, forever):** the original ransomware tripwire — canary files + mass-modification detection. Free tier, lead generator, goodwill.

## What it detects

| ID | Detector | Fires on |
|---|---|---|
| D1 | Canary | Targeted read/write/delete of a seeded honey-credential, **or** reuse of its unique secret in a later tool call (Write, Bash, MCP). Listing (Glob/Grep) is logged, not blocked. Files do not label themselves as bait. |
| D2 | Sensitive path | Access to well-known secret locations (`.env`, `~/.ssh/id_rsa`, `~/.aws/credentials`) even with an empty manifest. |
| D3 | Scope | Writes outside the workspace's declared scope roots. Warns once, then escalates. |
| D4 | Mass modification | More writes than the threshold inside the time window. Allowlisted churn dirs (`node_modules`) don't count. |
| D5 | Dangerous shell | Obfuscated or tunnelling shell commands (`base64 -d \| bash`, `ngrok`). |
| D6 | MCP authorization | Calls to MCP servers that aren't approved. |
| D7 | Exfiltration | Outbound transfer of local files (`curl -F file=@.env`). |

Known gap: in-memory network exfiltration over raw sockets is not observed in v1.

## Install (pilot / beta)

Not published to npm yet. Run from source:

```bash
git clone https://github.com/Seshadri724/Agent-Wires.git
cd Agent-Wires
npm install
npm link          # exposes the `canarywatch` command globally
canarywatch init  # seed unlabeled honey-credentials + install the hook
canarywatch install-hook
```

Requires Node >= 22.18.0. The CLI entrypoint is TypeScript, and 22.18 is the
first release that strips types without an explicit flag.

Everything canarywatch does is local: it writes decoy files into your
workspace, appends to a local event log, and adds one entry to
`~/.claude.json`. Nothing is sent over the network. `canarywatch uninstall-hook`
and deleting the `.canarywatch/` directory fully remove it.

## Feedback

Found a false positive, a crash, or something confusing? Open an issue:
https://github.com/Seshadri724/Agent-Wires/issues

## Status

Hook mode works: unlabeled honey-credentials, unique tokens (file contents
match the manifest), token-reuse detection, session pause/resume, and a
hash-chained local event log. Daemon mode is not built yet.

If you seeded before unlabeled bait landed, run `canarywatch unseed` then
`canarywatch seed` so old self-labeled files are replaced.

Design docs are kept out of this repo.

## License

MIT — see [LICENSE](LICENSE).
