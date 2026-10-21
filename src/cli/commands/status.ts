import { loadManifest, loadOrCreateKey, buildManifestPathSet } from "../../core/manifest.ts";
import { loadPolicy } from "../../core/config.ts";
import { listSessions } from "../../core/session.ts";
import { readEvents, verifyChain } from "../../core/eventlog.ts";
import { canarywatchHome } from "../../core/home.ts";
import { canonicalize } from "../../core/canonicalize.ts";
import type { Manifest } from "../../core/types.ts";

export function runStatus(args: string[]): void {
  const workspace = canonicalize(args[0] ?? process.cwd());
  let manifest: Manifest = { version: 1, entries: [] };
  let validPaths = new Set<string>();
  let manifestError: string | undefined;
  try {
    const key = loadOrCreateKey();
    manifest = loadManifest();
    validPaths = buildManifestPathSet(manifest, key);
  } catch (err) {
    manifestError = String(err);
    process.exitCode = 1;
  }
  const wsEntries = manifest.entries.filter((e) => e.workspace === workspace);
  const policy = loadPolicy();
  const sessions = listSessions();
  const locked = sessions.filter((s) => s.locked);
  let events: ReturnType<typeof readEvents> = [];
  let eventReadError: string | undefined;
  try {
    events = readEvents();
  } catch (err) {
    eventReadError = String(err);
  }
  const chain = verifyChain();

  console.log(`canarywatch status`);
  console.log(`  state dir:        ${canarywatchHome()}`);
  console.log(`  workspace:        ${workspace}`);
  console.log(`  canaries (here):  ${wsEntries.length} (${wsEntries.filter((e) => validPaths.has(e.path)).length} verified)`);
  console.log(`  canaries (total): ${manifest.entries.length}`);
  if (manifestError) console.log(`  manifest health:  BROKEN — ${manifestError}`);
  console.log(`  policy:           scope-enforced=${policy.scopeEnforced}, mass-mod threshold=${policy.massMod.threshold}/${policy.massMod.windowMs}ms`);
  console.log(`  sessions tracked: ${sessions.length} (${locked.length} locked, pending review)`);
  if (locked.length > 0) {
    for (const s of locked) console.log(`    ! ${s.sessionId} — run \`canarywatch resume ${s.sessionId}\``);
  }
  console.log(`  event log:        ${events.length} entries${eventReadError ? `, unreadable: ${eventReadError}` : ""}, chain ${chain.valid ? "OK" : `BROKEN${chain.brokenAtSeq === undefined ? "" : ` at seq ${chain.brokenAtSeq}`}: ${chain.reason ?? "unknown integrity error"}`}`);
  if (!chain.valid || eventReadError) process.exitCode = 1;
}
