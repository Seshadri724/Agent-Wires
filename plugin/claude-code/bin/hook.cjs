#!/usr/bin/env node
// GENERATED FILE — built from src/hook/hook.ts by scripts/build-plugin.mjs. Do not edit directly.
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/core/config.ts
var import_node_fs2 = __toESM(require("node:fs"), 1);

// src/core/home.ts
var import_node_os = __toESM(require("node:os"), 1);
var import_node_path = __toESM(require("node:path"), 1);
var import_node_fs = __toESM(require("node:fs"), 1);
function canarywatchHome() {
  const override = process.env.CANARYWATCH_HOME;
  const home = override && override.length > 0 ? override : import_node_path.default.join(import_node_os.default.homedir(), ".canarywatch");
  import_node_fs.default.mkdirSync(home, { recursive: true });
  return home;
}
function keyPath() {
  return import_node_path.default.join(canarywatchHome(), "key");
}
function manifestPath() {
  return import_node_path.default.join(canarywatchHome(), "manifest.json");
}
function policyPath() {
  return import_node_path.default.join(canarywatchHome(), "policy.json");
}
function eventLogPath() {
  return import_node_path.default.join(canarywatchHome(), "events.jsonl");
}
function sessionsDir() {
  const dir = import_node_path.default.join(canarywatchHome(), "sessions");
  import_node_fs.default.mkdirSync(dir, { recursive: true });
  return dir;
}
function scopeFileFor(workspace) {
  return import_node_path.default.join(canarywatchHome(), "scopes", encodeURIComponent(workspace) + ".json");
}

// src/core/types.ts
var DEFAULT_POLICY = {
  sensitivePaths: [
    "**/.env",
    "**/.env.*",
    "**/.ssh/**",
    "**/.aws/credentials",
    "**/.aws/config",
    "**/id_rsa",
    "**/id_ed25519",
    "**/*.pem",
    "**/secrets.yaml",
    "**/secrets.yml",
    "**/.canarywatch/**"
  ],
  scopeEnforced: true,
  massMod: {
    windowMs: 1e4,
    threshold: 50,
    allowlistDirs: ["node_modules", ".git", "dist", "build", "target", ".next", "coverage"]
  },
  d3: {
    warnBeforePause: 1
  },
  mcp: {
    allowedServers: ["*"],
    blockedServers: [],
    allowedTools: ["*"],
    blockedTools: []
  },
  dangerousCommands: [
    "rm -rf /",
    "rm -rf /*",
    "mkfs",
    "dd if=",
    "chmod 777",
    "chown -R",
    "curl * | bash",
    "curl * | sh",
    "wget * | bash",
    "wget * | sh",
    "eval $(curl",
    "eval $(wget",
    "base64 -d | bash",
    "nc -e",
    "tmate",
    "ngrok"
  ]
};

// src/core/config.ts
function loadPolicy() {
  const p = policyPath();
  if (!import_node_fs2.default.existsSync(p)) return DEFAULT_POLICY;
  const raw = JSON.parse(import_node_fs2.default.readFileSync(p, "utf8"));
  return {
    ...DEFAULT_POLICY,
    ...raw,
    massMod: { ...DEFAULT_POLICY.massMod, ...raw.massMod ?? {} },
    d3: { ...DEFAULT_POLICY.d3, ...raw.d3 ?? {} }
  };
}

// src/core/manifest.ts
var import_node_fs4 = __toESM(require("node:fs"), 1);
var import_node_crypto = __toESM(require("node:crypto"), 1);

// src/core/canonicalize.ts
var import_node_path2 = __toESM(require("node:path"), 1);
var import_node_fs3 = __toESM(require("node:fs"), 1);
var import_node_os2 = __toESM(require("node:os"), 1);
var isWindows = process.platform === "win32";
function expandHome(p) {
  if (p === "~") return import_node_os2.default.homedir();
  if (p.startsWith("~/") || p.startsWith("~\\")) {
    return import_node_path2.default.join(import_node_os2.default.homedir(), p.slice(2));
  }
  return p;
}
function canonicalize(inputPath, cwd = process.cwd()) {
  let p = expandHome(inputPath);
  p = import_node_path2.default.isAbsolute(p) ? p : import_node_path2.default.resolve(cwd, p);
  p = import_node_path2.default.normalize(p);
  try {
    p = import_node_fs3.default.realpathSync.native ? import_node_fs3.default.realpathSync.native(p) : import_node_fs3.default.realpathSync(p);
  } catch {
    p = resolveExistingPrefix(p);
  }
  if (isWindows) {
    p = p.toLowerCase();
  }
  if (p.length > 1 && p.endsWith(import_node_path2.default.sep)) {
    p = p.slice(0, -1);
  }
  return p;
}
function resolveExistingPrefix(p) {
  const root = import_node_path2.default.parse(p).root || import_node_path2.default.sep;
  const rest = p.slice(root.length).split(import_node_path2.default.sep).filter(Boolean);
  let resolved = root;
  for (let i = 0; i < rest.length; i++) {
    const candidate = import_node_path2.default.join(resolved, rest[i]);
    try {
      resolved = import_node_fs3.default.realpathSync.native ? import_node_fs3.default.realpathSync.native(candidate) : import_node_fs3.default.realpathSync(candidate);
    } catch {
      return import_node_path2.default.normalize(import_node_path2.default.join(resolved, ...rest.slice(i)));
    }
  }
  return resolved;
}
function globMatch(pattern, candidate) {
  const normPattern = expandHome(pattern).split(/[\\/]/).filter(Boolean);
  const normCandidate = candidate.split(/[\\/]/).filter(Boolean);
  function match(pi, ci) {
    if (pi === normPattern.length) return ci === normCandidate.length;
    const seg = normPattern[pi];
    if (seg === "**") {
      if (pi === normPattern.length - 1) return true;
      for (let k = ci; k <= normCandidate.length; k++) {
        if (match(pi + 1, k)) return true;
      }
      return false;
    }
    if (ci === normCandidate.length) return false;
    if (segMatch(seg, normCandidate[ci])) return match(pi + 1, ci + 1);
    return false;
  }
  function segMatch(pattern2, value) {
    const re = new RegExp(
      "^" + pattern2.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$",
      isWindows ? "i" : ""
    );
    return re.test(value);
  }
  return match(0, 0);
}
function isSubpathOrEqual(parentPath, childPath) {
  const normParent = canonicalize(parentPath);
  const normChild = canonicalize(childPath);
  if (normParent === normChild) return true;
  const parentPrefix = normParent.endsWith(import_node_path2.default.sep) ? normParent : normParent + import_node_path2.default.sep;
  const parentAltPrefix = normParent.endsWith("/") || normParent.endsWith("\\") ? normParent : normParent + "/";
  return normChild.startsWith(parentPrefix) || normChild.startsWith(parentAltPrefix);
}

// src/core/manifest.ts
var EMPTY_MANIFEST = { version: 1, entries: [] };
function loadOrCreateKey() {
  const p = keyPath();
  if (import_node_fs4.default.existsSync(p)) {
    return import_node_fs4.default.readFileSync(p);
  }
  const key = import_node_crypto.default.randomBytes(32);
  import_node_fs4.default.writeFileSync(p, key, { mode: 384 });
  try {
    import_node_fs4.default.chmodSync(p, 384);
  } catch {
  }
  return key;
}
function signEntry(key, entry) {
  const payload = `${entry.path}|${entry.tokenId}|${entry.sha256}|${entry.createdAt}|${entry.workspace}`;
  return import_node_crypto.default.createHmac("sha256", key).update(payload).digest("hex");
}
function verifyEntry(key, entry) {
  const expected = signEntry(key, entry);
  return import_node_crypto.default.timingSafeEqual(Buffer.from(expected), Buffer.from(entry.hmac));
}
function loadManifest() {
  const p = manifestPath();
  if (!import_node_fs4.default.existsSync(p)) return { ...EMPTY_MANIFEST };
  const raw = import_node_fs4.default.readFileSync(p, "utf8");
  if (raw.trim().length === 0) return { ...EMPTY_MANIFEST };
  return JSON.parse(raw);
}
function buildManifestPathSet(manifest, key) {
  const set = /* @__PURE__ */ new Set();
  for (const entry of manifest.entries) {
    if (!verifyEntry(key, entry)) {
      continue;
    }
    set.add(entry.path);
  }
  return set;
}
function buildManifestTokenSet(manifest, key) {
  const set = /* @__PURE__ */ new Set();
  for (const entry of manifest.entries) {
    if (!verifyEntry(key, entry)) continue;
    if (entry.tokenId.length >= 16) set.add(entry.tokenId);
  }
  return set;
}

// src/core/policy.ts
var SEVERITY = {
  allow: 0,
  log: 1,
  warn: 2,
  pause: 3,
  lockdown: 4
};
function isExempt(state, claim, now) {
  return state.exemptions.some((ex) => {
    if (ex.expiresAt && new Date(ex.expiresAt).getTime() < now) return false;
    if (ex.sessionOnly && ex.sessionId !== state.sessionId) return false;
    if (ex.access !== "any" && ex.access !== claim.access) return false;
    return isSubpathOrEqual(ex.scope, claim.path);
  });
}
function evaluateCanary(claim, manifestPaths) {
  if (!manifestPaths.has(claim.path)) return null;
  if (claim.access === "list") {
    return { action: "log", detector: "D1", reason: `Canary path listed (not read): ${claim.path}` };
  }
  return {
    action: "pause",
    detector: "D1",
    reason: `Canary touch: ${claim.access} on ${claim.path}. This path exists only as a tripwire \u2014 no legitimate task needs it.`
  };
}
function evaluateSensitive(claim, policy) {
  const hit = policy.sensitivePaths.some((pattern) => globMatch(pattern, claim.path));
  if (!hit) return null;
  if (claim.access === "list") {
    return { action: "log", detector: "D2", reason: `Sensitive path listed: ${claim.path}` };
  }
  return {
    action: "pause",
    detector: "D2",
    reason: `Sensitive-path access: ${claim.access} on ${claim.path}. Requires explicit approval.`
  };
}
function evaluateScope(claim, policy, state) {
  if (!policy.scopeEnforced) return null;
  if (claim.access !== "write" && claim.access !== "delete") return null;
  if (state.scopeRoots.length === 0) return null;
  const inScope = state.scopeRoots.some((root) => isSubpathOrEqual(root, claim.path));
  if (inScope) return null;
  const escalate = state.scopeViolations >= policy.d3.warnBeforePause;
  return {
    action: escalate ? "pause" : "warn",
    detector: "D3",
    reason: `Write outside declared scope: ${claim.path} is not under [${state.scopeRoots.join(", ")}].`
  };
}
function evaluateMassMod(claim, policy, state, now, phase = "pre") {
  if (claim.access !== "write" && claim.access !== "delete") return null;
  const segments = claim.path.split(/[\\/]/);
  if (segments.some((seg) => policy.massMod.allowlistDirs.includes(seg))) return null;
  const windowStart = now - policy.massMod.windowMs;
  const recent = state.writeTimestamps.filter((t) => t >= windowStart);
  if (phase === "pre") {
    recent.push(now);
  }
  state.writeTimestamps = recent;
  if (recent.length <= policy.massMod.threshold) return null;
  return {
    action: "pause",
    detector: "D4",
    reason: `Mass modification: ${recent.length} writes in ${policy.massMod.windowMs}ms (threshold ${policy.massMod.threshold}).`
  };
}
function isShellTool(toolName) {
  if (toolName === "Bash") return true;
  return /bash|exec|shell|terminal|run_command|execute/i.test(toolName);
}
function evaluateDangerousCommand(event, policy) {
  if (!isShellTool(event.tool)) return null;
  const rawObj = event.raw ?? {};
  const command = typeof rawObj.command === "string" ? rawObj.command : typeof rawObj.cmd === "string" ? rawObj.cmd : event.paths.map((p) => p.path).join(" ");
  if (!command) return null;
  const patterns = policy.dangerousCommands ?? [
    "rm -rf /",
    "rm -rf /*",
    "mkfs",
    "dd if=",
    "chmod 777",
    "chown -R",
    "curl * | bash",
    "curl * | sh",
    "wget * | bash",
    "wget * | sh",
    "eval $(curl",
    "eval $(wget",
    "base64 -d | bash",
    "nc -e",
    "tmate",
    "ngrok"
  ];
  const normalizedCmd = command.toLowerCase();
  for (const pat of patterns) {
    const escapedPat = pat.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\*/g, ".*");
    const reg = new RegExp(escapedPat, "i");
    if (reg.test(normalizedCmd)) {
      return {
        action: "pause",
        detector: "D5",
        reason: `Dangerous shell command pattern detected ('${pat}'). Execution blocked for safety.`
      };
    }
  }
  return null;
}
function evaluateToolAuthorization(event, policy) {
  const mcp = policy.mcp;
  if (!mcp) return null;
  const rawObj = event.raw ?? {};
  const serverName = typeof rawObj.mcpServer === "string" ? rawObj.mcpServer : void 0;
  if (serverName && mcp.blockedServers?.includes(serverName)) {
    return {
      action: "pause",
      detector: "D6",
      reason: `Blocked MCP server execution: '${serverName}'.`
    };
  }
  if (serverName && mcp.allowedServers && !mcp.allowedServers.includes("*") && !mcp.allowedServers.includes(serverName)) {
    return {
      action: "pause",
      detector: "D6",
      reason: `Unapproved MCP server execution: '${serverName}' is not in allowed list.`
    };
  }
  if (mcp.blockedTools?.includes(event.tool)) {
    return {
      action: "pause",
      detector: "D6",
      reason: `Blocked tool execution: '${event.tool}'.`
    };
  }
  if (mcp.allowedTools && !mcp.allowedTools.includes("*") && !mcp.allowedTools.includes(event.tool)) {
    return {
      action: "pause",
      detector: "D6",
      reason: `Unapproved tool execution: '${event.tool}' is not in allowed list.`
    };
  }
  return null;
}
function evaluateTokenReuse(event, canaryTokens) {
  if (canaryTokens.size === 0) return null;
  const haystack = JSON.stringify(event.raw ?? "");
  if (!haystack) return null;
  for (const token of canaryTokens) {
    if (haystack.includes(token)) {
      return {
        action: "pause",
        detector: "D1",
        reason: "Canary secret appeared in a later tool call. The bait was read or copied \u2014 this is not a legitimate task."
      };
    }
  }
  return null;
}
function evaluateExfiltration(event, policy, manifestPaths) {
  if (!isShellTool(event.tool)) return null;
  const rawObj = event.raw ?? {};
  const command = typeof rawObj.command === "string" ? rawObj.command : typeof rawObj.cmd === "string" ? rawObj.cmd : "";
  if (!command) return null;
  const isOutboundCmd = /\b(curl|wget|nc|ncat|socat|scp|rsync|ssh)\b/i.test(command);
  if (!isOutboundCmd) return null;
  for (const claim of event.paths) {
    const canonicalPath = canonicalize(claim.path);
    const isCanary = manifestPaths.has(canonicalPath);
    const isSensitive = policy.sensitivePaths.some((p) => globMatch(p, canonicalPath));
    if (isCanary || isSensitive) {
      return {
        action: "pause",
        detector: "D7",
        reason: `Outbound data exfiltration attempt detected: sharing protected file (${claim.path}) via network command.`
      };
    }
  }
  return null;
}
function worst(a, b) {
  if (!a) return b;
  if (!b) return a;
  return SEVERITY[b.action] > SEVERITY[a.action] ? b : a;
}
function evaluate(event, policy, manifestPaths, state, canaryTokens = /* @__PURE__ */ new Set()) {
  const now = event.ts;
  if (state.locked) {
    return {
      action: "lockdown",
      detector: "none",
      reason: "Session is locked pending human review. Run `canarywatch resume <session>` to continue.",
      evidence: { sessionId: event.sessionId, tool: event.tool, paths: event.paths.map((p) => p.path), ts: now }
    };
  }
  const rawObj = event.raw ?? {};
  const mcpServer = typeof rawObj.mcpServer === "string" ? rawObj.mcpServer : void 0;
  let best = worst(
    evaluateTokenReuse(event, canaryTokens),
    worst(
      evaluateDangerousCommand(event, policy),
      worst(evaluateToolAuthorization(event, policy), evaluateExfiltration(event, policy, manifestPaths))
    )
  );
  for (const claim of event.paths) {
    const canonical = { ...claim, path: canonicalize(claim.path) };
    if (isExempt(state, canonical, now)) continue;
    const canary = evaluateCanary(canonical, manifestPaths);
    const sensitive = evaluateSensitive(canonical, policy);
    const scope = evaluateScope(canonical, policy, state);
    const massMod = evaluateMassMod(canonical, policy, state, now, event.phase);
    best = worst(best, worst(worst(canary, sensitive), worst(scope, massMod)));
  }
  if (best?.detector === "D3" && best.action === "warn") {
    state.scopeViolations += 1;
  }
  if (!best) {
    return {
      action: "allow",
      detector: "none",
      reason: "No policy match.",
      evidence: { sessionId: event.sessionId, tool: event.tool, paths: event.paths.map((p) => p.path), ts: now, mcpServer }
    };
  }
  return {
    action: best.action,
    detector: best.detector,
    reason: best.reason,
    evidence: { sessionId: event.sessionId, tool: event.tool, paths: event.paths.map((p) => p.path), ts: now, mcpServer }
  };
}

// src/core/session.ts
var import_node_fs5 = __toESM(require("node:fs"), 1);
var import_node_path3 = __toESM(require("node:path"), 1);
function sessionFile(sessionId) {
  return import_node_path3.default.join(sessionsDir(), `${encodeURIComponent(sessionId)}.json`);
}
function lockFile(sessionId) {
  return import_node_path3.default.join(sessionsDir(), `${encodeURIComponent(sessionId)}.lock`);
}
function isProcessAlive(pid) {
  if (!pid || pid <= 0) return false;
  try {
    return process.kill(pid, 0);
  } catch {
    return false;
  }
}
function acquireLock(sessionId, maxWaitMs = 2e3) {
  const dir = sessionsDir();
  if (!import_node_fs5.default.existsSync(dir)) import_node_fs5.default.mkdirSync(dir, { recursive: true });
  const lf = lockFile(sessionId);
  const start = Date.now();
  while (true) {
    try {
      const fd = import_node_fs5.default.openSync(lf, "wx");
      const metadata = { pid: process.pid, createdAt: Date.now() };
      import_node_fs5.default.writeSync(fd, JSON.stringify(metadata));
      import_node_fs5.default.closeSync(fd);
      break;
    } catch {
      if (Date.now() - start > maxWaitMs) {
        let isStale = false;
        try {
          const raw = import_node_fs5.default.readFileSync(lf, "utf8");
          const meta = JSON.parse(raw);
          const isDead = !isProcessAlive(meta.pid);
          const isExpired = Date.now() - meta.createdAt > 3e4;
          if (isDead || isExpired) isStale = true;
        } catch {
          isStale = true;
        }
        if (isStale) {
          try {
            import_node_fs5.default.unlinkSync(lf);
          } catch {
          }
        }
      } else {
        const sleepMs = 5;
        const endSleep = Date.now() + sleepMs;
        while (Date.now() < endSleep) {
        }
      }
    }
  }
  return () => {
    try {
      import_node_fs5.default.unlinkSync(lf);
    } catch {
    }
  };
}
function loadSession(sessionId, defaultScopeRoots = []) {
  const f = sessionFile(sessionId);
  let state;
  if (import_node_fs5.default.existsSync(f)) {
    try {
      state = JSON.parse(import_node_fs5.default.readFileSync(f, "utf8"));
    } catch (err) {
      process.stderr.write(`[canarywatch] Session state file corrupt for '${sessionId}', failing CLOSED (locked): ${err}
`);
      state = {
        sessionId,
        scopeRoots: defaultScopeRoots,
        writeTimestamps: [],
        scopeViolations: 99,
        locked: true,
        exemptions: []
      };
    }
  } else {
    state = {
      sessionId,
      scopeRoots: defaultScopeRoots,
      writeTimestamps: [],
      scopeViolations: 0,
      locked: false,
      exemptions: []
    };
  }
  if (sessionId !== "global") {
    const globalFile = sessionFile("global");
    if (import_node_fs5.default.existsSync(globalFile)) {
      try {
        const globalState = JSON.parse(import_node_fs5.default.readFileSync(globalFile, "utf8"));
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
      } catch {
      }
    }
  }
  return state;
}
function saveSession(state) {
  const dir = sessionsDir();
  if (!import_node_fs5.default.existsSync(dir)) import_node_fs5.default.mkdirSync(dir, { recursive: true });
  const dest = sessionFile(state.sessionId);
  const tmp = `${dest}.${process.pid}.${Date.now()}.tmp`;
  import_node_fs5.default.writeFileSync(tmp, JSON.stringify(state, null, 2));
  try {
    import_node_fs5.default.renameSync(tmp, dest);
  } catch {
    import_node_fs5.default.copyFileSync(tmp, dest);
    try {
      import_node_fs5.default.unlinkSync(tmp);
    } catch {
    }
  }
}

// src/core/scope.ts
var import_node_fs6 = __toESM(require("node:fs"), 1);
function getWorkspaceScope(workspace) {
  const f = scopeFileFor(workspace);
  if (!import_node_fs6.default.existsSync(f)) return [canonicalize(workspace)];
  const data = JSON.parse(import_node_fs6.default.readFileSync(f, "utf8"));
  return data.roots;
}

// src/core/eventlog.ts
var import_node_fs7 = __toESM(require("node:fs"), 1);
var import_node_path4 = __toESM(require("node:path"), 1);
var import_node_crypto2 = __toESM(require("node:crypto"), 1);
var GENESIS_HASH = "0".repeat(64);
function canonicalJson(obj) {
  const sort = (v) => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === "object") {
      return Object.fromEntries(
        Object.keys(v).sort().map((k) => [k, sort(v[k])])
      );
    }
    return v;
  };
  return JSON.stringify(sort(obj));
}
function lastEntry() {
  const p = eventLogPath();
  if (!import_node_fs7.default.existsSync(p)) return null;
  const lines = import_node_fs7.default.readFileSync(p, "utf8").split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) return null;
  return JSON.parse(lines[lines.length - 1]);
}
function redactSecrets(data) {
  if (typeof data === "string") {
    return data.replace(/(sk-[a-zA-Z0-9]{20,})/g, "[REDACTED_API_KEY]").replace(/(ghp_[a-zA-Z0-9]{36})/g, "[REDACTED_GITHUB_TOKEN]").replace(/(AKIA[0-9A-Z]{16})/g, "[REDACTED_AWS_KEY]").replace(/(password|secret|bearer)\s*=\s*['"]?[^\s'"]+['"]?/gi, "$1=[REDACTED]");
  }
  if (Array.isArray(data)) {
    return data.map(redactSecrets);
  }
  if (data && typeof data === "object") {
    const redactedObj = {};
    for (const [key, val] of Object.entries(data)) {
      if (/secret|token|key|password|auth/i.test(key) && typeof val === "string") {
        redactedObj[key] = "[REDACTED]";
      } else {
        redactedObj[key] = redactSecrets(val);
      }
    }
    return redactedObj;
  }
  return data;
}
function headAnchorPath() {
  return import_node_path4.default.join(canarywatchHome(), "head.anchor.json");
}
function signAnchor(key, maxSeq, headHash) {
  return import_node_crypto2.default.createHmac("sha256", key).update(`${maxSeq}|${headHash}`).digest("hex");
}
function updateHeadAnchor(maxSeq, headHash) {
  try {
    const key = loadOrCreateKey();
    const hmac = signAnchor(key, maxSeq, headHash);
    const anchor = { maxSeq, headHash, hmac };
    const tmp = `${headAnchorPath()}.${process.pid}.tmp`;
    import_node_fs7.default.writeFileSync(tmp, JSON.stringify(anchor, null, 2));
    import_node_fs7.default.renameSync(tmp, headAnchorPath());
  } catch {
  }
}
function appendEvent(decision) {
  const redactedDecision = redactSecrets(decision);
  const release = acquireLock("__eventlog_lock__");
  try {
    const prev = lastEntry();
    const seq = prev ? prev.seq + 1 : 0;
    const prevHash = prev ? prev.hash : GENESIS_HASH;
    const hash = import_node_crypto2.default.createHash("sha256").update(prevHash + canonicalJson({ seq, decision: redactedDecision })).digest("hex");
    const entry = { seq, decision: redactedDecision, prevHash, hash };
    import_node_fs7.default.appendFileSync(eventLogPath(), JSON.stringify(entry) + "\n");
    updateHeadAnchor(seq, hash);
    return entry;
  } finally {
    release();
  }
}

// src/core/notifier.ts
var import_node_child_process = require("node:child_process");
var MAX_LEN = 300;
function sanitize(s) {
  return s.replace(/[\r\n]+/g, " ").slice(0, MAX_LEN);
}
function fireAndForget(cmd, args) {
  try {
    const child = (0, import_node_child_process.spawn)(cmd, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      shell: false
    });
    child.on("error", () => {
    });
    child.unref();
  } catch {
  }
}
function escapePowerShellSingleQuoted(s) {
  return s.replace(/'/g, "''");
}
function escapeAppleScriptString(s) {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
function notifyWindows(title, message) {
  const t = escapePowerShellSingleQuoted(title);
  const m = escapePowerShellSingleQuoted(message);
  const script = `Add-Type -AssemblyName System.Windows.Forms,System.Drawing; $n = New-Object System.Windows.Forms.NotifyIcon; $n.Icon = [System.Drawing.SystemIcons]::Warning; $n.Visible = $true; $n.BalloonTipTitle = '${t}'; $n.BalloonTipText = '${m}'; $n.ShowBalloonTip(6000); Start-Sleep -Seconds 7; $n.Dispose()`;
  fireAndForget("powershell.exe", ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script]);
}
function notifyMac(title, message) {
  const t = escapeAppleScriptString(title);
  const m = escapeAppleScriptString(message);
  const script = `display notification "${m}" with title "${t}"`;
  fireAndForget("osascript", ["-e", script]);
}
function notifyLinux(title, message) {
  fireAndForget("notify-send", ["--urgency=critical", title, message]);
}
function sendDesktopNotification(title, message) {
  const t = sanitize(title);
  const m = sanitize(message);
  switch (process.platform) {
    case "win32":
      notifyWindows(t, m);
      break;
    case "darwin":
      notifyMac(t, m);
      break;
    default:
      notifyLinux(t, m);
      break;
  }
}

// src/hook/shellLex.ts
var WRITE_COMMANDS = /* @__PURE__ */ new Set(["rm", "mv", "cp", "truncate", "shred", "tee", "chmod", "chown"]);
var DELETE_COMMANDS = /* @__PURE__ */ new Set(["rm", "shred"]);
var LIST_COMMANDS = /* @__PURE__ */ new Set(["ls", "find", "grep", "rg", "stat", "file", "tree"]);
function tokenize(command) {
  const tokens = [];
  let current = "";
  let quote = null;
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote) {
      if (c === quote) {
        quote = null;
      } else {
        current += c;
      }
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if (/\s/.test(c)) {
      if (current.length > 0) tokens.push(current);
      current = "";
      continue;
    }
    if (c === "|" || c === ";" || c === "&") {
      if (current.length > 0) tokens.push(current);
      tokens.push(c);
      current = "";
      continue;
    }
    current += c;
  }
  if (current.length > 0) tokens.push(current);
  return tokens;
}
function looksLikePath(token) {
  if (token.startsWith("-")) return false;
  if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) return false;
  return token.includes("/") || token.includes("\\") || token.startsWith("~") || token.startsWith(".") || /\.[A-Za-z0-9]{1,5}$/.test(token);
}
function extractBashPathClaims(command) {
  const tokens = tokenize(command);
  const claims = [];
  let segment = [];
  const flushSegment = () => {
    if (segment.length === 0) return;
    claims.push(...claimsForSegment(segment));
    segment = [];
  };
  for (const t of tokens) {
    if (t === "|" || t === ";" || t === "&") {
      flushSegment();
      continue;
    }
    segment.push(t);
  }
  flushSegment();
  return claims;
}
function claimsForSegment(segment) {
  const [cmd, ...args] = segment;
  const pathArgs = args.filter(looksLikePath);
  if (pathArgs.length === 0) return [];
  let access = "read";
  if (DELETE_COMMANDS.has(cmd)) access = "delete";
  else if (WRITE_COMMANDS.has(cmd)) access = "write";
  else if (LIST_COMMANDS.has(cmd)) access = "list";
  const claims = [];
  const raw = segment.join(" ");
  const redirectMatches = raw.matchAll(/>>?\s*([^\s|;&]+)/g);
  const redirectTargets = /* @__PURE__ */ new Set();
  for (const m of redirectMatches) {
    redirectTargets.add(m[1]);
    claims.push({ path: m[1], access: "write", confidence: "lexed" });
  }
  for (const p of pathArgs) {
    if (redirectTargets.has(p)) continue;
    claims.push({ path: p, access, confidence: "lexed" });
  }
  return claims;
}

// src/hook/pathClaims.ts
function extractPathClaims(toolName, input) {
  if (!input || typeof input !== "object") return [];
  switch (toolName) {
    case "Read":
      return input.file_path ? [{ path: String(input.file_path), access: "read", confidence: "exact" }] : [];
    case "Write":
      return input.file_path ? [{ path: String(input.file_path), access: "write", confidence: "exact" }] : [];
    case "Edit":
    case "NotebookEdit":
      return input.file_path ? [{ path: String(input.file_path), access: "write", confidence: "exact" }] : [];
    case "Glob":
      return input.pattern ? [{ path: joinPathAndPattern(input.path, input.pattern), access: "list", confidence: "glob" }] : [];
    case "Grep": {
      const target = input.path ?? ".";
      return [{ path: String(target), access: "list", confidence: "glob" }];
    }
    case "Bash": {
      const cmd = typeof input.command === "string" ? input.command : typeof input.cmd === "string" ? input.cmd : void 0;
      return cmd ? extractBashPathClaims(cmd) : [];
    }
  }
  const normalizedTool = toolName.toLowerCase();
  if (/bash|exec|shell|terminal|run_command|execute/i.test(normalizedTool)) {
    const cmd = typeof input.command === "string" ? input.command : typeof input.cmd === "string" ? input.cmd : void 0;
    if (cmd) return extractBashPathClaims(cmd);
  }
  const pathVal = input.file_path ?? input.path ?? input.filePath ?? input.target ?? input.uri ?? input.filename ?? input.file;
  if (!pathVal || typeof pathVal !== "string") return [];
  let access = "read";
  if (/delete|remove|unlink|rm/i.test(normalizedTool)) {
    access = "delete";
  } else if (/write|edit|create|save|modify|update|append/i.test(normalizedTool)) {
    access = "write";
  } else if (/list|dir|glob|grep|search|find/i.test(normalizedTool)) {
    access = "list";
  } else if (/read|view|cat|get|fetch|show/i.test(normalizedTool)) {
    access = "read";
  }
  return [{ path: pathVal, access, confidence: "exact" }];
}
function joinPathAndPattern(basePath, pattern) {
  if (!basePath) return pattern;
  return String(basePath).replace(/[\\/]+$/, "") + "/" + pattern;
}

// src/hook/hook.ts
function readStdin() {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => data += chunk);
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}
function notify(decision) {
  process.stderr.write(
    `[canarywatch] ${decision.action.toUpperCase()} (${decision.detector}) session=${decision.evidence.sessionId} \u2014 ${decision.reason}
`
  );
  sendDesktopNotification(
    `canarywatch: ${decision.action}`,
    `${decision.detector !== "none" ? decision.detector + " \u2014 " : ""}${decision.reason}`
  );
}
function emit(permissionDecision, reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision,
        permissionDecisionReason: reason
      }
    })
  );
}
async function main() {
  const raw = await readStdin();
  let input;
  try {
    input = JSON.parse(raw);
  } catch (err) {
    process.stderr.write(`[canarywatch] failed to parse hook input, allowing (fail-open): ${err}
`);
    emit("allow", "canarywatch: could not parse hook input, allowing by default.");
    return;
  }
  let manifestPaths;
  let canaryTokens;
  try {
    const key = loadOrCreateKey();
    const manifest = loadManifest();
    manifestPaths = buildManifestPathSet(manifest, key);
    canaryTokens = buildManifestTokenSet(manifest, key);
  } catch (err) {
    process.stderr.write(`[canarywatch] manifest unavailable, failing CLOSED: ${err}
`);
    emit("deny", "canarywatch: could not load the canary manifest, denying by default for safety.");
    return;
  }
  try {
    const policy = loadPolicy();
    const paths = extractPathClaims(input.tool_name, input.tool_input);
    const event = {
      kind: "tool_call",
      sessionId: input.session_id,
      tool: input.tool_name,
      paths,
      phase: input.hook_event_name === "PreToolUse" ? "pre" : "post",
      raw: input.tool_input,
      ts: Date.now()
    };
    const release = acquireLock(input.session_id);
    let decision;
    try {
      const scopeRoots = getWorkspaceScope(input.cwd);
      const state = loadSession(input.session_id, scopeRoots);
      decision = evaluate(event, policy, manifestPaths, state, canaryTokens);
      if (decision.action === "pause" || decision.action === "lockdown") {
        state.locked = true;
      }
      saveSession(state);
    } finally {
      release();
    }
    appendEvent(decision);
    if (decision.action !== "allow" && decision.action !== "log") {
      notify(decision);
    }
    switch (decision.action) {
      case "allow":
      case "log":
        emit("allow", decision.reason);
        break;
      case "warn":
        emit("allow", `[canarywatch warning] ${decision.reason}`);
        break;
      case "pause":
      case "lockdown":
        emit(
          "deny",
          `[canarywatch] Blocked: ${decision.reason} Stop, and tell the user exactly what you were trying to do and why. A human must run \`canarywatch resume ${input.session_id}\` before further tool calls will be allowed.`
        );
        break;
    }
  } catch (err) {
    process.stderr.write(`[canarywatch] unexpected error, allowing (fail-open): ${err}
`);
    emit("allow", "canarywatch: internal error, allowing by default.");
  }
}
main();
