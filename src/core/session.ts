// Per-session state: mass-mod counters, scope roots, lock status,
// exemptions. Persisted with atomic writes & file locking so hook binaries
// invoked concurrently do not lose state. docs/ARCHITECTURE.md §3.3.

import fs from "node:fs";
import path from "node:path";
import { sessionsDir } from "./home.ts";
import type { SessionState } from "./types.ts";

function sessionFile(sessionId: string): string {
  return path.join(sessionsDir(), `${encodeURIComponent(sessionId)}.json`);
}

function lockFile(sessionId: string): string {
  return path.join(sessionsDir(), `${encodeURIComponent(sessionId)}.lock`);
}

function isProcessAlive(pid: number): boolean {
  if (!pid || pid <= 0) return false;
  try {
    return process.kill(pid, 0);
  } catch {
    return false;
  }
}

export interface LockMetadata {
  pid: number;
  createdAt: number;
}

/** Acquire cross-process file lock for a session to prevent race conditions. */
export function acquireLock(sessionId: string, maxWaitMs = 2000): () => void {
  const dir = sessionsDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const lf = lockFile(sessionId);
  const start = Date.now();
  while (true) {
    try {
      const fd = fs.openSync(lf, "wx");
      const metadata: LockMetadata = { pid: process.pid, createdAt: Date.now() };
      fs.writeSync(fd, JSON.stringify(metadata));
      fs.closeSync(fd);
      break;
    } catch {
      if (Date.now() - start > maxWaitMs) {
        // Inspect existing lock before breaking
        let isStale = false;
        try {
          const raw = fs.readFileSync(lf, "utf8");
          const meta = JSON.parse(raw) as LockMetadata;
          const isDead = !isProcessAlive(meta.pid);
          const isExpired = Date.now() - meta.createdAt > 30_000; // 30s max lock TTL
          if (isDead || isExpired) isStale = true;
        } catch {
          isStale = true; // Malformed lock file
        }

        if (isStale) {
          try {
            fs.unlinkSync(lf);
          } catch {}
        }
      } else {
        const sleepMs = 5;
        const endSleep = Date.now() + sleepMs;
        while (Date.now() < endSleep) {}
      }
    }
  }
  return () => {
    try {
      fs.unlinkSync(lf);
    } catch {}
  };
}

export function loadSession(sessionId: string, defaultScopeRoots: string[] = []): SessionState {
  const f = sessionFile(sessionId);
  let state: SessionState;
  if (fs.existsSync(f)) {
    try {
      state = JSON.parse(fs.readFileSync(f, "utf8")) as SessionState;
    } catch (err) {
      process.stderr.write(`[canarywatch] Session state file corrupt for '${sessionId}', failing CLOSED (locked): ${err}\n`);
      state = {
        sessionId,
        scopeRoots: defaultScopeRoots,
        writeTimestamps: [],
        scopeViolations: 99,
        locked: true,
        exemptions: [],
      };
    }
  } else {
    state = {
      sessionId,
      scopeRoots: defaultScopeRoots,
      writeTimestamps: [],
      scopeViolations: 0,
      locked: false,
      exemptions: [],
    };
  }

  // Merge global exemptions into non-global session state
  if (sessionId !== "global") {
    const globalFile = sessionFile("global");
    if (fs.existsSync(globalFile)) {
      try {
        const globalState = JSON.parse(fs.readFileSync(globalFile, "utf8")) as SessionState;
        if (Array.isArray(globalState.exemptions)) {
          for (const ex of globalState.exemptions) {
            const exists = state.exemptions.some(
              (e) => e.scope === ex.scope && e.access === ex.access && e.grantedAt === ex.grantedAt
            );
            if (!exists) {
              state.exemptions.push(ex);
            }
          }
        }
      } catch {}
    }
  }

  return state;
}

export function saveSession(state: SessionState): void {
  const dir = sessionsDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const dest = sessionFile(state.sessionId);
  const tmp = `${dest}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  try {
    fs.renameSync(tmp, dest);
  } catch {
    // Fallback if atomic rename across mounts fails
    fs.copyFileSync(tmp, dest);
    try {
      fs.unlinkSync(tmp);
    } catch {}
  }
}

export function resumeSession(sessionId: string): SessionState {
  const release = acquireLock(sessionId);
  try {
    const state = loadSession(sessionId);
    state.locked = false;
    state.scopeViolations = 0;
    saveSession(state);
    return state;
  } finally {
    release();
  }
}

export function listSessions(): SessionState[] {
  const dir = sessionsDir();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as SessionState;
      } catch {
        return null;
      }
    })
    .filter((s): s is SessionState => s !== null);
}
