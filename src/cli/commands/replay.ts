import fs from "node:fs";
import {
  DETECTOR_LABELS,
  exportEventsJson,
  exportEventsOcsf,
  formatDecisionLabel,
  getEventsForSession,
  redactLogEntry,
} from "../../core/eventlog.ts";

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

export function runReplay(args: string[]): void {
  const sessionId = args.find((a) => !a.startsWith("-"));
  if (!sessionId) {
    console.error("Usage: canarywatch replay <session-id>");
    process.exitCode = 1;
    return;
  }

  const events = getEventsForSession(sessionId).map((e) => redactLogEntry(e, { workspace: process.cwd() }));
  if (events.length === 0) {
    console.log(`No events found for session '${sessionId}'.`);
    return;
  }

  console.log(`=== Session Replay: ${sessionId} (${events.length} events, redacted) ===\n`);
  for (const e of events) {
    const d = e.decision;
    const timeStr = new Date(d.evidence.ts).toISOString();
    const rule = d.detector === "none" ? DETECTOR_LABELS.none : `${d.detector} · ${DETECTOR_LABELS[d.detector]}`;
    console.log(`[${timeStr}] Step #${e.seq}: ${formatDecisionLabel(d.action)} (${rule})`);
    console.log(`  Tool:     ${d.evidence.tool}`);
    if (d.evidence.mcpServer) console.log(`  MCP:      ${d.evidence.mcpServer}`);
    console.log(`  Reason:   ${d.reason}`);
    if (d.evidence.paths.length > 0) {
      console.log(`  Resource: ${d.evidence.paths.join(", ")} (path only; no contents recorded)`);
    }
    console.log(`  PrevHash: ${e.prevHash.slice(0, 16)}... Hash: ${e.hash.slice(0, 16)}...\n`);
  }
  console.log(`Export: canarywatch export --session ${sessionId} --format json`);
}

export function runExport(args: string[]): void {
  const formatOpt = parseOptionValue(args, "--format");
  const sessionOpt = parseOptionValue(args, "--session");
  const outOpt = parseOptionValue(args, "--out");
  const workspaceOpt = parseOptionValue(args, "--workspace");

  for (const opt of [formatOpt, sessionOpt, outOpt, workspaceOpt]) {
    if (opt.error) {
      console.error(`canarywatch export: ${opt.error}`);
      process.exitCode = 2;
      return;
    }
  }

  const consumedIndexes = new Set<number>();
  for (let i = 0; i < args.length; i++) {
    if (
      (args[i] === "--format" || args[i] === "--session" || args[i] === "--out" || args[i] === "--workspace") &&
      i + 1 < args.length
    ) {
      consumedIndexes.add(i);
      consumedIndexes.add(i + 1);
    }
  }
  for (let i = 0; i < args.length; i++) {
    if (consumedIndexes.has(i)) continue;
    const arg = args[i];
    if (
      arg.startsWith("--format=") ||
      arg.startsWith("--session=") ||
      arg.startsWith("--out=") ||
      arg.startsWith("--workspace=")
    ) {
      continue;
    }
    console.error(`canarywatch export: unknown option ${arg}`);
    process.exitCode = 2;
    return;
  }

  const format = formatOpt.value ?? "json";
  if (format !== "json" && format !== "ocsf") {
    console.error(`canarywatch export: unsupported format '${format}' (use json or ocsf)`);
    process.exitCode = 2;
    return;
  }

  const workspace = workspaceOpt.value ?? process.cwd();
  const payload =
    format === "ocsf"
      ? exportEventsOcsf(sessionOpt.value, { workspace })
      : exportEventsJson(sessionOpt.value, { workspace });

  if (outOpt.value) {
    fs.writeFileSync(outOpt.value, payload + "\n", "utf8");
    console.log(`Exported redacted ${format} evidence to ${outOpt.value}`);
  } else {
    console.log(payload);
  }
}
