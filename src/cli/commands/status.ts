import { loadManifest, loadOrCreateKey, buildManifestPathSet } from "../../core/manifest.ts";
import { loadPolicy } from "../../core/config.ts";
import { listSessions } from "../../core/session.ts";
import { readEvents, verifyChain } from "../../core/eventlog.ts";
import { canarywatchHome } from "../../core/home.ts";
import { canonicalize } from "../../core/canonicalize.ts";

export function runStatus(args: string[]): void {
  const workspace = canonicalize(args[0] ?? process.cwd());
  const key = loadOrCreateKey();
  const manifest = loadManifest();
  const validPaths = buildManifestPathSet(manifest, key);
  const wsEntries = manifest.entries.filter((e) => e.workspace === workspace);
  const policy = loadPolicy();
  const sessions = listSessions();
  const locked = sessions.filter((s) => s.locked);
  const events = readEvents();
  const chain = verifyChain();

  console.log(`canarywatch status`);
  console.log(`  state dir:        ${canarywatchHome()}`);
  console.log(`  workspace:        ${workspace}`);
  console.log(`  canaries (here):  ${wsEntries.length} (${wsEntries.filter((e) => validPaths.has(e.path)).length} verified)`);
  console.log(`  canaries (total): ${manifest.entries.length}`);
  console.log(`  policy:           scope-enforced=${policy.scopeEnforced}, mass-mod threshold=${policy.massMod.threshold}/${policy.massMod.windowMs}ms`);
  console.log(`  sessions tracked: ${sessions.length} (${locked.length} locked, pending review)`);
  if (locked.length > 0) {
    for (const s of locked) console.log(`    ! ${s.sessionId} — run \`canarywatch resume ${s.sessionId}\``);
  }
  console.log(`  event log:        ${events.length} entries, chain ${chain.valid ? "OK" : `BROKEN at seq ${chain.brokenAtSeq}`}`);
}
