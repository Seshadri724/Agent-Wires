import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { eventLogPath, canarywatchHome } from "./home.ts";
import { loadOrCreateKey } from "./manifest.ts";
import { acquireLock } from "./session.ts";
import type { Action, Decision, DetectorId } from "./types.ts";
import packageJson from "../../package.json" with { type: "json" };

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
    // Redact common secret patterns like API keys, tokens, passwords, private keys, and URL credentials
    return data
      .replace(/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g, "[REDACTED_PRIVATE_KEY]")
      .replace(/(sk-[a-zA-Z0-9_-]{20,})/g, "[REDACTED_API_KEY]")
      .replace(/((?:ghp|gho|ghu|ghs|ghr)_[a-zA-Z0-9]{30,}|github_pat_[a-zA-Z0-9_]{20,})/g, "[REDACTED_GITHUB_TOKEN]")
      .replace(/(AKIA[0-9A-Z]{16})/g, "[REDACTED_AWS_KEY]")
      .replace(/(AIza[0-9A-Za-z_-]{35})/g, "[REDACTED_API_KEY]")
      .replace(/(xox[baprs]-[0-9A-Za-z-]{10,})/g, "[REDACTED_SLACK_TOKEN]")
      .replace(/(glpat-[0-9A-Za-z_-]{20,})/g, "[REDACTED_GITLAB_TOKEN]")
      .replace(/(npm_[0-9A-Za-z]{20,})/g, "[REDACTED_NPM_TOKEN]")
      .replace(/\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, "[REDACTED_JWT]")
      .replace(/(https?:\/\/)([^:@\s/]+):([^@\s/]+)@/gi, "$1[REDACTED_USER]:[REDACTED_PASS]@")
      .replace(/(Authorization\s*:\s*Bearer\s+)[^\s'"]+/gi, "$1[REDACTED]")
      .replace(/\b(password|secret|bearer|token|api_key|apikey|aws_secret_access_key|anthropic_api_key|openai_api_key)\s*([:=])\s*['"]?[^\s'"&;]+['"]?/gi, "$1$2[REDACTED]") as T;
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function configuredStateDir(): string {
  const override = process.env.CANARYWATCH_HOME;
  return override && override.length > 0 ? override : path.join(os.homedir(), ".canarywatch");
}

export function redactTextPaths(
  input: string,
  options: { workspace?: string; stateDir?: string } = {}
): string {
  let text = redactSecrets(input);

  const replacePrefix = (prefix: string | undefined, replacement: string): void => {
    if (!prefix) return;
    const clean = prefix.replace(/[/\\]+$/, "");
    if (!clean) return;
    const pattern = new RegExp(escapeRegExp(clean) + "([/\\\\])?", "gi");
    text = text.replace(pattern, (_match, sep) => `${replacement}${sep ? "/" : ""}`);
  };

  replacePrefix(options.workspace, "<workspace>");
  replacePrefix(options.stateDir ?? configuredStateDir(), "<stateDir>");
  replacePrefix(os.tmpdir(), "<tmp>");
  replacePrefix(os.homedir(), "~");

  // Also scrub explicit user home directory paths even when exported from another user/fixture
  text = text
    .replace(/[A-Za-z]:[/\\]Users[/\\][^/\\\s'",;)\]]+([/\\])?/gi, (_m, sep) => `~${sep ? "/" : ""}`)
    .replace(/\/Users\/[^/\s'",;)\]]+(\/)?/g, (_m, sep) => `~${sep ? "/" : ""}`)
    .replace(/\/home\/[^/\s'",;)\]]+(\/)?/g, (_m, sep) => `~${sep ? "/" : ""}`);

  text = text
    .replace(/<workspace>\\/g, "<workspace>/")
    .replace(/<stateDir>\\/g, "<stateDir>/")
    .replace(/<tmp>\\/g, "<tmp>/")
    .replace(/~\\/g, "~/");

  return text;
}

export function redactPath(
  inputPath: string,
  options: { workspace?: string; stateDir?: string } = {}
): string {
  return redactTextPaths(inputPath, options).replace(/\\/g, "/");
}

export const DETECTOR_LABELS: Record<DetectorId, string> = {
  D1: "canary decoy",
  D2: "sensitive path",
  D3: "workspace scope",
  D4: "mass modification",
  D5: "dangerous shell",
  D6: "MCP authorization",
  D7: "outbound exfiltration",
  none: "policy",
};

export function formatDecisionLabel(action: Action): string {
  switch (action) {
    case "pause":
      return "DENIED · session paused";
    case "lockdown":
      return "DENIED · session locked";
    case "warn":
      return "WARNED · allowed with warning";
    case "log":
      return "LOGGED · allowed";
    case "allow":
      return "ALLOWED";
  }
}

export function redactLogEntry(
  entry: LogEntry,
  options: { workspace?: string; stateDir?: string } = {}
): LogEntry {
  const d = entry.decision;
  return {
    ...entry,
    decision: {
      ...d,
      reason: redactTextPaths(d.reason, options),
      evidence: {
        ...d.evidence,
        tool: redactSecrets(d.evidence.tool),
        mcpServer: d.evidence.mcpServer ? redactSecrets(d.evidence.mcpServer) : undefined,
        paths: d.evidence.paths.map((p) => redactPath(p, options)),
      },
    },
  };
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

export function readEventsAt(stateDir: string): LogEntry[] {
  const p = path.join(stateDir, "events.jsonl");
  if (!fs.existsSync(p)) return [];
  return fs
    .readFileSync(p, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as LogEntry);
}

export function readEvents(): LogEntry[] {
  return readEventsAt(canarywatchHome());
}

export interface ChainVerificationResult {
  valid: boolean;
  brokenAtSeq?: number;
  reason?: string;
  eventCount: number;
  empty: boolean;
}

export function verifyChainAt(stateDir: string): ChainVerificationResult {
  const logFile = path.join(stateDir, "events.jsonl");
  const ap = path.join(stateDir, "head.anchor.json");
  const kp = path.join(stateDir, "key");

  if (!fs.existsSync(logFile) && !fs.existsSync(ap)) {
    return { valid: true, eventCount: 0, empty: true };
  }

  let entries: LogEntry[];
  try {
    entries = readEventsAt(stateDir);
  } catch (err) {
    return { valid: false, eventCount: 0, empty: false, reason: `Event log is corrupt or unreadable: ${err}` };
  }
  let expectedPrev = GENESIS_HASH;
  let maxSeqInLog = -1;
  let lastHashInLog = "";

  for (const entry of entries) {
    if (entry.prevHash !== expectedPrev) {
      return { valid: false, brokenAtSeq: entry.seq, eventCount: entries.length, empty: false, reason: "Hash chain link mismatch" };
    }
    const recomputed = crypto
      .createHash("sha256")
      .update(entry.prevHash + canonicalJson({ seq: entry.seq, decision: entry.decision }))
      .digest("hex");
    if (recomputed !== entry.hash) {
      return { valid: false, brokenAtSeq: entry.seq, eventCount: entries.length, empty: false, reason: "Content hash tampered" };
    }
    expectedPrev = entry.hash;
    maxSeqInLog = entry.seq;
    lastHashInLog = entry.hash;
  }

  if (entries.length > 0 && !fs.existsSync(ap)) {
    return { valid: false, eventCount: entries.length, empty: false, reason: "Head anchor is missing for a non-empty event log" };
  }
  if (fs.existsSync(ap)) {
    let anchor: HeadAnchor;
    try {
      const rawAnchor = fs.readFileSync(ap, "utf8");
      anchor = JSON.parse(rawAnchor) as HeadAnchor;
    } catch (err) {
      return { valid: false, eventCount: entries.length, empty: false, reason: `Head anchor file corrupt or unreadable: ${err}` };
    }

    try {
      if (!fs.existsSync(kp)) {
        return { valid: false, brokenAtSeq: anchor.maxSeq, eventCount: entries.length, empty: false, reason: "Signing key missing for head anchor verification" };
      }
      const key = fs.readFileSync(kp);
      if (key.length !== 32) {
        return { valid: false, brokenAtSeq: anchor.maxSeq, eventCount: entries.length, empty: false, reason: "Signing key has an invalid length" };
      }
      const expectedHmac = signAnchor(key, anchor.maxSeq, anchor.headHash);
      if (!crypto.timingSafeEqual(Buffer.from(expectedHmac), Buffer.from(anchor.hmac))) {
        return { valid: false, brokenAtSeq: anchor.maxSeq, eventCount: entries.length, empty: false, reason: "Head anchor signature verification failed (tampered anchor)" };
      }
    } catch {
      return { valid: false, brokenAtSeq: anchor.maxSeq, eventCount: entries.length, empty: false, reason: "Head anchor signature verification error" };
    }

    if (maxSeqInLog < anchor.maxSeq || (anchor.maxSeq >= 0 && lastHashInLog !== anchor.headHash)) {
      return {
        valid: false,
        brokenAtSeq: anchor.maxSeq,
        eventCount: entries.length,
        empty: false,
        reason: `Tail truncation detected: logged seq ${maxSeqInLog} < anchored seq ${anchor.maxSeq}`,
      };
    }
  }

  return { valid: true, eventCount: entries.length, empty: entries.length === 0 };
}

export function verifyChain(): { valid: boolean; brokenAtSeq?: number; reason?: string } {
  const result = verifyChainAt(canarywatchHome());
  return {
    valid: result.valid,
    ...(result.brokenAtSeq !== undefined ? { brokenAtSeq: result.brokenAtSeq } : {}),
    ...(result.reason !== undefined ? { reason: result.reason } : {}),
  };
}

export function escalations(limit = 50): LogEntry[] {
  return readEvents()
    .filter((e) => e.decision.action === "pause" || e.decision.action === "lockdown")
    .slice(-limit);
}

export function getEventsForSession(sessionId: string): LogEntry[] {
  return readEvents().filter((e) => e.decision.evidence.sessionId === sessionId);
}

export interface RedactedExportedEvent {
  seq: number;
  timestamp: string;
  sessionId: string;
  decision: string;
  action: Action;
  detector: DetectorId;
  detectorName: string;
  tool: string;
  mcpServer?: string;
  resources: string[];
  reason: string;
  prevHash: string;
  hash: string;
}

export interface RedactedEvidenceExport {
  schemaVersion: "1.0.0";
  canarywatchVersion: string;
  exportedAt: string;
  sessionId: string;
  integrity: {
    valid: boolean;
    brokenAtSeq?: number;
    reason?: string;
  };
  redacted: true;
  summary: {
    totalEvents: number;
    blocked: number;
    warned: number;
    allowed: number;
    detectors: DetectorId[];
  };
  coverageNote: string;
  events: RedactedExportedEvent[];
}

export function exportEventsJson(
  sessionId?: string,
  options: { workspace?: string; stateDir?: string } = {}
): string {
  const stateDir = options.stateDir ?? configuredStateDir();
  const integrity = verifyChainAt(stateDir);
  const rawEvents = sessionId ? getEventsForSession(sessionId) : readEvents();
  const redactedEntries = rawEvents.map((e) => redactLogEntry(e, { ...options, stateDir }));

  const blocked = redactedEntries.filter((e) => e.decision.action === "pause" || e.decision.action === "lockdown").length;
  const warned = redactedEntries.filter((e) => e.decision.action === "warn").length;
  const allowed = redactedEntries.filter((e) => e.decision.action === "allow" || e.decision.action === "log").length;
  const detectors = [...new Set(redactedEntries.map((e) => e.decision.detector).filter((d) => d !== "none"))];

  const bundle: RedactedEvidenceExport = {
    schemaVersion: "1.0.0",
    canarywatchVersion: packageJson.version,
    exportedAt: new Date().toISOString(),
    sessionId: sessionId ?? "all",
    integrity: {
      valid: integrity.valid,
      ...(integrity.brokenAtSeq !== undefined ? { brokenAtSeq: integrity.brokenAtSeq } : {}),
      ...(integrity.reason !== undefined ? { reason: integrity.reason } : {}),
    },
    redacted: true,
    summary: {
      totalEvents: redactedEntries.length,
      blocked,
      warned,
      allowed,
      detectors,
    },
    coverageNote: "Local PreToolUse hook and optional MCP proxy evidence only; path prefixes and secret values are redacted and no file contents are recorded.",
    events: redactedEntries.map((e) => ({
      seq: e.seq,
      timestamp: new Date(e.decision.evidence.ts).toISOString(),
      sessionId: e.decision.evidence.sessionId,
      decision: formatDecisionLabel(e.decision.action),
      action: e.decision.action,
      detector: e.decision.detector,
      detectorName: DETECTOR_LABELS[e.decision.detector],
      tool: e.decision.evidence.tool,
      ...(e.decision.evidence.mcpServer ? { mcpServer: e.decision.evidence.mcpServer } : {}),
      resources: e.decision.evidence.paths,
      reason: e.decision.reason,
      prevHash: e.prevHash,
      hash: e.hash,
    })),
  };
  return JSON.stringify(bundle, null, 2);
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

export function exportEventsOcsf(
  sessionId?: string,
  options: { workspace?: string; stateDir?: string } = {}
): string {
  const rawEvents = sessionId ? getEventsForSession(sessionId) : readEvents();
  const events = rawEvents.map((e) => redactLogEntry(e, options));
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
      device: { hostname: "redacted-host" },
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

