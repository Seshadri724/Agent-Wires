# canarywatch

**Tripwires for AI agents.** Deterministic, explainable runtime guardrails that catch autonomous agents the moment they touch files they should never touch.

## The one-liner

Every company letting autonomous agents touch filesystems is one bad prompt injection away from an agent reading `.env` files, mass-editing outside its scope, or exfiltrating a directory. EDR exists for malware. Nothing equivalent exists for agents. canarywatch seeds honeypot files agents should never touch, watches for scope violations with deterministic file-event detection, and **pauses the agent session** — not the process — when a tripwire fires.

## Why this wins

| Property | canarywatch | ML-based anomaly detection | Prompt-level guardrails |
|---|---|---|---|
| False-positive behavior | Deterministic — a canary touch is always a violation | Probabilistic, tunable, noisy | Model-dependent, bypassable |
| Explainability | "Agent read `~/.aws/credentials.decoy` at 14:02" | Feature-weight soup | Opaque |
| Response | Pause session, human review | Kill process (dangerous) | Refuse (already too late if injected) |
| Deployment | A hook + a folder of decoys | Endpoint agent + training period | Per-prompt integration |

The key insight from the ransomware-era version of this idea: **agents are interruptible in a way ransomware isn't.** You never need to kill a process. You pause the loop, surface the violation, and let a human decide. The response problem — the hardest part of the original product — gets *easier* in the agent framing.

## Product shape

1. **Hook mode (ships first):** a plugin for Claude Code and compatible harnesses. Intercepts tool calls before execution, checks them against canary manifest + scope policy, blocks-and-pauses on violation. Trivial distribution: one `settings.json` entry.
2. **Daemon mode (ships second):** a standalone filesystem sensor (Windows USN Journal + ETW, Linux fanotify/eBPF, macOS Endpoint Security) that works with *any* agent, any runtime, no harness cooperation required.
3. **Classic mode (free, forever):** the original ransomware tripwire — canary files + mass-modification detection. Free tier, lead generator, goodwill.

## Documentation

| Doc | What's in it |
|---|---|
| [PRD](docs/PRD.md) | Problem, users, requirements, success metrics, non-goals |
| [Roadmap](docs/ROADMAP.md) | Phases 0–4 with build instructions, checkpoints, and exit criteria |
| [Architecture](docs/ARCHITECTURE.md) | System design, component specs, data flows, platform sensor designs |
| [Threat Model](docs/THREAT-MODEL.md) | Detection taxonomy: what fires, what doesn't, evasion analysis |
| [Resources](docs/RESOURCES.md) | APIs, OS internals docs, prior art, and libraries to build on |

## Status

Pre-code. Documentation-first. Phase 0 (validation spike) is defined in the [roadmap](docs/ROADMAP.md).
