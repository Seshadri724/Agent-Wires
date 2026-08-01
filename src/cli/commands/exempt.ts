import { loadSession, saveSession } from "../../core/session.ts";
import { grantExemption } from "../../core/policy.ts";
import { canonicalize } from "../../core/canonicalize.ts";
import type { Access } from "../../core/types.ts";

export function runExempt(args: string[]): void {
  const targetPath = args.find((a) => !a.startsWith("--"));
  if (!targetPath) {
    console.error("Usage: canarywatch exempt <path> [--access=read|write|delete|any] [--session=<session-id>] [--ttl=<ms>]");
    process.exitCode = 1;
    return;
  }

  const accessArg = args.find((a) => a.startsWith("--access="))?.split("=")[1] as Access | "any" | undefined;
  const access: Access | "any" = accessArg || "any";

  const sessionArg = args.find((a) => a.startsWith("--session="))?.split("=")[1];
  const ttlArg = args.find((a) => a.startsWith("--ttl="))?.split("=")[1];
  const ttlMs = ttlArg ? Number(ttlArg) : undefined;

  const sessionId = sessionArg || "global";
  const state = loadSession(sessionId);

  grantExemption(state, targetPath, access, Boolean(sessionArg), ttlMs);
  saveSession(state);

  console.log(`Exemption granted for ${canonicalize(targetPath)} (access: ${access}, session: ${sessionId}${ttlMs ? `, ttl: ${ttlMs}ms` : ""}).`);
}
