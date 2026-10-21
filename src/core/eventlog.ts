import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { eventLogPath, canarywatchHome } from "./home.ts";
import { loadOrCreateKey } from "./manifest.ts";
import { acquireLock } from "./session.ts";
import type { Decision } from "./types.ts";

export interface LogEntry {
  seq: number;
  decision: Decision;
  prevHash: string;
  hash: string;
}

const GENESIS_HASH = "0".repeat(64);

function canonicalJson(obj: unknown): string {
  // Stable stringify: sort object keys so the same logical entry always
  // hashes identically regardless of insertion order.
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === "object") {
      return Object.fromEntries(
        Object.keys(v as Record<string, unknown>)
          .sort()
          .map((k) => [k, sort((v as Record<string, unknown>)[k])])
      );
    }
    return v;
  };
  return JSON.stringify(sort(obj));
}

function lastEntry(): LogEntry | null {
  const p = eventLogPath();
  if (!fs.existsSync(p)) return null;
  const lines = fs.readFileSync(p, "utf8").split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) return null;
  return JSON.parse(lines[lines.length - 1]) as LogEntry;
}

export function redactSecrets<T>(data: T): T {
  if (typeof data === "string") {
    // Redact common secret patterns like API keys, tokens, passwords
    return data
      .replace(/(sk-[a-zA-Z0-9]{20,})/g, "[REDACTED_API_KEY]")
      .replace(/(ghp_[a-zA-Z0-9]{36})/g, "[REDACTED_GITHUB_TOKEN]")
      .replace(/(AKIA[0-9A-Z]{16})/g, "[REDACTED_AWS_KEY]")
      .replace(/(password|secret|bearer)\s*=\s*['"]?[^\s'"]+['"]?/gi, "$1=[REDACTED]") as T;
  }
  if (Array.isArray(data)) {
    return data.map(redactSecrets) as T;
  }
  if (data && typeof data === "object") {
    const redactedObj: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(data as Record<string, unknown>)) {
      if (/secret|token|key|password|auth/i.test(key) && typeof val === "string") {
        redactedObj[key] = "[REDACTED]";
      } else {
        redactedObj[key] = redactSecrets(val);
      }
    }
    return redactedObj as T;
  }
  return data;
}

function headAnchorPath(): string {
  return path.join(canarywatchHome(), "head.anchor.json");
}

export interface HeadAnchor {
  maxSeq: number;
  headHash: string;
  hmac: string;
}

function signAnchor(key: Buffer, maxSeq: number, headHash: string): string {
  return crypto.createHmac("sha256", key).update(`${maxSeq}|${headHash}`).digest("hex");
}

function updateHeadAnchor(maxSeq: number, headHash: string): void {
  try {
    const key = loadOrCreateKey();
    const hmac = signAnchor(key, maxSeq, headHash);
    const anchor: HeadAnchor = { maxSeq, headHash, hmac };
    const tmp = `${headAnchorPath()}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(anchor, null, 2));
    try {
      fs.renameSync(tmp, headAnchorPath());
    } catch {
      // Windows may reject rename over an existing destination. Preserve
      // the checkpoint even when atomic replacement is unavailable.
      fs.copyFileSync(tmp, headAnchorPath());
      fs.unlinkSync(tmp);
    }
  } catch (err) {
    // The hook must not report an action as allowed if its evidence checkpoint
    // could not be persisted.
    process.stderr.write(`[canarywatch] failed to update event-log head anchor: ${err}\n`);
    throw err;
  }
}

export function appendEvent(decision: Decision): LogEntry {
  const redactedDecision = redactSecrets(decision);
  const release = acquireLock("__eventlog_lock__");
  try {
    const integrity = verifyChain();
    if (!integrity.valid) {
      throw new Error(`Refusing to append to an invalid event log: ${integrity.reason ?? "integrity check failed"}`);
    }
    const prev = lastEntry();
    const seq = prev ? prev.seq + 1 : 0;
    const prevHash = prev ? prev.hash : GENESIS_HASH;
    const hash = crypto
      .createHash("sha256")
      .update(prevHash + canonicalJson({ seq, decision: redactedDecision }))
      .digest("hex");
    const entry: LogEntry = { seq, decision: redactedDecision, prevHash, hash };
    fs.appendFileSync(eventLogPath(), JSON.stringify(entry) + "\n");
    updateHeadAnchor(seq, hash);
    return entry;
  } finally {
    release();
  }
}

export function readEvents(): LogEntry[] {
  const p = eventLogPath();
  if (!fs.existsSync(p)) return [];
  return fs
    .readFileSync(p, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as LogEntry);
}

export function verifyChain(): { valid: boolean; brokenAtSeq?: number; reason?: string } {
  let entries: LogEntry[];
  try {
    entries = readEvents();
  } catch (err) {
    return { valid: false, reason: `Event log is corrupt or unreadable: ${err}` };
  }
  let expectedPrev = GENESIS_HASH;
  let maxSeqInLog = -1;
  let lastHashInLog = "";

  for (const entry of entries) {
    if (entry.prevHash !== expectedPrev) return { valid: false, brokenAtSeq: entry.seq, reason: "Hash chain link mismatch" };
    const recomputed = crypto
      .createHash("sha256")
      .update(entry.prevHash + canonicalJson({ seq: entry.seq, decision: entry.decision }))
      .digest("hex");
    if (recomputed !== entry.hash) return { valid: false, brokenAtSeq: entry.seq, reason: "Content hash tampered" };
    expectedPrev = entry.hash;
    maxSeqInLog = entry.seq;
    lastHashInLog = entry.hash;
  }

  // Check tail truncation against head anchor checkpoint
  const ap = headAnchorPath();
  if (entries.length > 0 && !fs.existsSync(ap)) {
    return { valid: false, reason: "Head anchor is missing for a non-empty event log" };
  }
  if (fs.existsSync(ap)) {
    let anchor: HeadAnchor;
    try {
      const rawAnchor = fs.readFileSync(ap, "utf8");
      anchor = JSON.parse(rawAnchor) as HeadAnchor;
    } catch (err) {
      return { valid: false, reason: `Head anchor file corrupt or unreadable: ${err}` };
    }

    try {
      const key = loadOrCreateKey();
      const expectedHmac = signAnchor(key, anchor.maxSeq, anchor.headHash);
      if (!crypto.timingSafeEqual(Buffer.from(expectedHmac), Buffer.from(anchor.hmac))) {
        return { valid: false, brokenAtSeq: anchor.maxSeq, reason: "Head anchor signature verification failed (tampered anchor)" };
      }
    } catch {
      return { valid: false, brokenAtSeq: anchor.maxSeq, reason: "Head anchor signature verification error" };
    }

    if (maxSeqInLog < anchor.maxSeq || (anchor.maxSeq >= 0 && lastHashInLog !== anchor.headHash)) {
      return {
        valid: false,
        brokenAtSeq: anchor.maxSeq,
        reason: `Tail truncation detected: logged seq ${maxSeqInLog} < anchored seq ${anchor.maxSeq}`,
      };
    }
  }

  return { valid: true };
}

export function escalations(limit = 50): LogEntry[] {
  return readEvents()
    .filter((e) => e.decision.action === "pause" || e.decision.action === "lockdown")
    .slice(-limit);
}

export function getEventsForSession(sessionId: string): LogEntry[] {
  return readEvents().filter((e) => e.decision.evidence.sessionId === sessionId);
}

export function exportEventsJson(sessionId?: string): string {
  const events = sessionId ? getEventsForSession(sessionId) : readEvents();
  return JSON.stringify(events, null, 2);
}

export interface OcsfEvent {
  category_name: string;
  category_uid: number;
  class_name: string;
  class_uid: number;
  severity: string;
  severity_id: number;
  time: number;
  activity_id: number;
  activity_name: string;
  actor: { session: { id: string } };
  device: { hostname: string };
  finding: {
    title: string;
    desc: string;
    uid: string;
  };
  raw_data: unknown;
}

export function exportEventsOcsf(sessionId?: string): string {
  const events = sessionId ? getEventsForSession(sessionId) : readEvents();
  const ocsfList: OcsfEvent[] = events.map((e) => {
    const d = e.decision;
    const severityMap: Record<string, { name: string; id: number }> = {
      allow: { name: "Informational", id: 1 },
      log: { name: "Informational", id: 1 },
      warn: { name: "Low", id: 2 },
      pause: { name: "High", id: 4 },
      lockdown: { name: "Critical", id: 5 },
    };
    const sev = severityMap[d.action] ?? { name: "Unknown", id: 0 };
    return {
      category_name: "Application Activity",
      category_uid: 6,
      class_name: "Application Security Finding",
      class_uid: 6001,
      severity: sev.name,
      severity_id: sev.id,
      time: d.evidence.ts,
      activity_id: 1,
      activity_name: d.action,
      actor: { session: { id: d.evidence.sessionId } },
      device: { hostname: process.env.COMPUTERNAME || process.env.HOSTNAME || "localhost" },
      finding: {
        title: `canarywatch ${d.detector}: ${d.action}`,
        desc: d.reason,
        uid: `seq-${e.seq}`,
      },
      raw_data: e,
    };
  });
  return JSON.stringify(ocsfList, null, 2);
}

