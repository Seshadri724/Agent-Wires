import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DETECTOR_LABELS,
  formatDecisionLabel,
  readEventsAt,
  redactLogEntry,
  verifyChainAt,
  type LogEntry,
} from "../../core/eventlog.ts";
import { listSessions } from "../../core/session.ts";

function getStateDir(): string {
  const override = process.env.CANARYWATCH_HOME;
  return override && override.length > 0 ? override : path.join(os.homedir(), ".canarywatch");
}

function parseOptionValue(args: string[], flag: string): { found: boolean; value?: string; error?: string } {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith(`${flag}=`)) {
      const value = arg.slice(flag.length + 1);
      if (!value) return { found: true, error: `Missing value for ${flag}` };
      return { found: true, value };
    }
    if (arg === flag) {
      const next = args[i + 1];
      if (!next || next.startsWith("-")) return { found: true, error: `Missing value for ${flag}` };
      return { found: true, value: next };
    }
  }
  return { found: false };
}

function formatRule(entry: LogEntry): string {
  const d = entry.decision.detector;
  const label = DETECTOR_LABELS[d];
  return d === "none" ? label : `${d} · ${label}`;
}

export function runEvents(args: string[]): void {
  const sessionOpt = parseOptionValue(args, "--session");
  if (sessionOpt.error) {
    console.error(`canarywatch events: ${sessionOpt.error}`);
    process.exitCode = 2;
    return;
  }

  const verify = args.includes("--verify");
  const pendingOnly = args.includes("--pending");
  const jsonMode = args.includes("--json");

  // Validate flags
  const consumedIndexes = new Set<number>();
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--session" && i + 1 < args.length) {
      consumedIndexes.add(i);
      consumedIndexes.add(i + 1);
    }
  }
  for (let i = 0; i < args.length; i++) {
    if (consumedIndexes.has(i)) continue;
    const arg = args[i];
    if (arg === "--verify" || arg === "--pending" || arg === "--json" || arg.startsWith("--session=")) continue;
    if (/^\d+$/.test(arg)) continue;
    console.error(`canarywatch events: unknown option ${arg}`);
    process.exitCode = 2;
    return;
  }

  const stateDir = getStateDir();
  if (!fs.existsSync(stateDir)) {
    if (jsonMode) {
      console.log(
        JSON.stringify(
          {
            integrity: { valid: true, eventCount: 0, empty: true },
            redacted: true,
            events: [],
          },
          null,
          2
        )
      );
    } else if (verify) {
      console.log("Integrity       Hash chain verified (0 events recorded).");
    } else {
      console.log("No events.");
    }
    return;
  }

  const chain = verifyChainAt(stateDir);
  if (verify && !chain.valid) {
    const msg = `Event log chain BROKEN${chain.brokenAtSeq === undefined ? "" : ` at seq ${chain.brokenAtSeq}`}: ${chain.reason ?? "unknown integrity error"}`;
    if (jsonMode) {
      console.log(JSON.stringify({ integrity: chain, redacted: true, events: [] }, null, 2));
    } else {
      console.error(msg);
    }
    process.exitCode = 1;
    return;
  }

  let rawEntries: LogEntry[] = [];
  try {
    rawEntries = readEventsAt(stateDir);
  } catch (err) {
    console.error(`canarywatch events: could not read event log: ${err}`);
    process.exitCode = 1;
    return;
  }

  if (sessionOpt.value) {
    rawEntries = rawEntries.filter((e) => e.decision.evidence.sessionId === sessionOpt.value);
  }

  const lockedSessions = new Set(listSessions().filter((s) => s.locked).map((s) => s.sessionId));
  if (pendingOnly) {
    rawEntries = rawEntries.filter(
      (e) =>
        (e.decision.action === "pause" || e.decision.action === "lockdown") &&
        lockedSessions.has(e.decision.evidence.sessionId)
    );
  }

  const limitArg = args.find((a, idx) => !consumedIndexes.has(idx) && /^\d+$/.test(a));
  const limit = limitArg ? Number(limitArg) : 20;
  const selected = rawEntries.slice(-limit).map((e) => redactLogEntry(e, { stateDir, workspace: process.cwd() }));

  if (jsonMode) {
    console.log(
      JSON.stringify(
        {
          integrity: {
            valid: chain.valid,
            ...(chain.brokenAtSeq !== undefined ? { brokenAtSeq: chain.brokenAtSeq } : {}),
            ...(chain.reason !== undefined ? { reason: chain.reason } : {}),
          },
          redacted: true,
          events: selected,
        },
        null,
        2
      )
    );
    return;
  }

  if (verify) {
    if (selected.length === 0) {
      console.log("Integrity       Hash chain verified (0 events recorded).");
      return;
    }
    printVerifiedEntries(selected, lockedSessions);
    return;
  }

  printEntries(selected);
}

function printVerifiedEntries(entries: LogEntry[], lockedSessions: Set<string>): void {
  const latest = entries[entries.length - 1];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const d = e.decision;
    const ts = new Date(d.evidence.ts).toISOString();
    const resources =
      d.evidence.paths.length > 0
        ? `${d.evidence.paths.join(", ")}  (path only; no contents recorded)`
        : d.evidence.mcpServer
          ? `mcp:${d.evidence.mcpServer}  (metadata only; no secrets recorded)`
          : "(no file path recorded)";
    console.log(`EVENT  ${ts}  session ${d.evidence.sessionId}\n`);
    console.log(`Decision        ${formatDecisionLabel(d.action)}`);
    console.log(`Tool            ${d.evidence.tool}`);
    console.log(`Resource        ${resources}`);
    console.log(`Rule            ${formatRule(e)}`);
    console.log(`Reason          ${d.reason}`);
    console.log(`Integrity       Hash chain verified`);
    if (i < entries.length - 1) console.log("");
  }
  const sid = latest.decision.evidence.sessionId;
  console.log(`\nExport: canarywatch export --session ${sid} --format json`);
  if (lockedSessions.has(sid)) {
    console.log(`Unlock: canarywatch resume ${sid}`);
  }
}

function printEntries(entries: LogEntry[]): void {
  if (entries.length === 0) {
    console.log("No events.");
    return;
  }
  for (const e of entries) {
    const d = e.decision;
    console.log(
      `#${e.seq} [${d.action.toUpperCase()}${d.detector !== "none" ? " " + d.detector : ""}] ${new Date(d.evidence.ts).toISOString()} session=${d.evidence.sessionId} tool=${d.evidence.tool}`
    );
    console.log(`    ${d.reason}`);
    if (d.evidence.paths.length > 0) console.log(`    paths: ${d.evidence.paths.join(", ")}`);
  }
}
