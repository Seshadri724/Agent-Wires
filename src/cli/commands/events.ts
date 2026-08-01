import { escalations, readEvents, verifyChain } from "../../core/eventlog.ts";
import { listSessions } from "../../core/session.ts";

export function runEvents(args: string[]): void {
  if (args.includes("--verify")) {
    const result = verifyChain();
    console.log(result.valid ? "Event log chain OK." : `Event log chain BROKEN at seq ${result.brokenAtSeq}.`);
    return;
  }

  if (args.includes("--pending")) {
    const lockedSessions = new Set(listSessions().filter((s) => s.locked).map((s) => s.sessionId));
    const pending = escalations(200).filter((e) => lockedSessions.has(e.decision.evidence.sessionId));
    printEntries(pending);
    return;
  }

  const limitArg = args.find((a) => /^\d+$/.test(a));
  const limit = limitArg ? Number(limitArg) : 20;
  printEntries(readEvents().slice(-limit));
}

function printEntries(entries: ReturnType<typeof readEvents>): void {
  if (entries.length === 0) {
    console.log("No events.");
    return;
  }
  for (const e of entries) {
    const d = e.decision;
    console.log(`#${e.seq} [${d.action.toUpperCase()}${d.detector !== "none" ? " " + d.detector : ""}] ${new Date(d.evidence.ts).toISOString()} session=${d.evidence.sessionId} tool=${d.evidence.tool}`);
    console.log(`    ${d.reason}`);
    if (d.evidence.paths.length > 0) console.log(`    paths: ${d.evidence.paths.join(", ")}`);
  }
}
