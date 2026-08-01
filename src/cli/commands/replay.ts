import { exportEventsJson, exportEventsOcsf, getEventsForSession } from "../../core/eventlog.ts";

export function runReplay(args: string[]): void {
  const sessionId = args.find((a) => !a.startsWith("--"));
  if (!sessionId) {
    console.error("Usage: canarywatch replay <session-id>");
    process.exitCode = 1;
    return;
  }

  const events = getEventsForSession(sessionId);
  if (events.length === 0) {
    console.log(`No events found for session '${sessionId}'.`);
    return;
  }

  console.log(`=== Session Replay: ${sessionId} (${events.length} events) ===\n`);
  for (const e of events) {
    const d = e.decision;
    const timeStr = new Date(d.evidence.ts).toISOString();
    console.log(`[${timeStr}] Step #${e.seq}: ${d.action.toUpperCase()} (${d.detector})`);
    console.log(`  Tool:     ${d.evidence.tool}`);
    if (d.evidence.mcpServer) console.log(`  MCP:      ${d.evidence.mcpServer}`);
    console.log(`  Reason:   ${d.reason}`);
    if (d.evidence.paths.length > 0) {
      console.log(`  Paths:    ${d.evidence.paths.join(", ")}`);
    }
    console.log(`  PrevHash: ${e.prevHash.slice(0, 16)}... Hash: ${e.hash.slice(0, 16)}...\n`);
  }
}

export function runExport(args: string[]): void {
  const formatArg = args.find((a) => a.startsWith("--format="))?.split("=")[1] || "json";
  const sessionArg = args.find((a) => a.startsWith("--session="))?.split("=")[1];

  if (formatArg === "ocsf") {
    console.log(exportEventsOcsf(sessionArg));
  } else {
    console.log(exportEventsJson(sessionArg));
  }
}
