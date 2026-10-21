// Core types shared by the hook sensor, seeder, policy engine, and CLI.
// Mirrors docs/ARCHITECTURE.md section 3.2 / 3.3.

export type Access = "read" | "write" | "delete" | "list";
export type Confidence = "exact" | "glob" | "lexed";

export interface PathClaim {
  path: string;
  access: Access;
  confidence: Confidence;
}

export interface ToolCallEvent {
  kind: "tool_call";
  sessionId: string;
  cwd?: string;
  tool: string;
  paths: PathClaim[];
  phase: "pre" | "post";
  raw?: unknown;
  ts: number;
}

export type DetectorId = "D1" | "D2" | "D3" | "D4" | "D5" | "D6" | "D7" | "none";

export type Action = "allow" | "log" | "warn" | "pause" | "lockdown";

export interface Decision {
  action: Action;
  detector: DetectorId;
  reason: string;
  evidence: {
    sessionId: string;
    tool: string;
    paths: string[];
    ts: number;
    mcpServer?: string;
  };
  exemptionApplied?: boolean;
}

export interface ManifestEntry {
  path: string;
  tokenId: string;
  sha256: string;
  createdAt: string;
  hmac: string;
  workspace: string;
}

export interface Manifest {
  version: 1;
  entries: ManifestEntry[];
}

export interface Exemption {
  scope: string; // canonicalized path or glob prefix
  access: Access | "any";
  sessionOnly: boolean;
  sessionId?: string;
  grantedAt: string;
  expiresAt?: string;
}

export interface SessionState {
  sessionId: string;
  scopeRoots: string[];
  writeTimestamps: number[]; // sliding window for D4
  scopeViolations: number; // for D3 warn -> pause escalation
  locked: boolean;
  exemptions: Exemption[];
}

export interface PolicyConfig {
  sensitivePaths: string[]; // glob-ish patterns, matched against canonical path
  scopeEnforced: boolean;
  massMod: {
    windowMs: number;
    threshold: number;
    allowlistDirs: string[]; // directory basenames exempt from D4 counting
  };
  d3: {
    warnBeforePause: number; // number of violations tolerated at "warn" before escalating to "pause"
  };
  mcp?: {
    allowedServers?: string[];
    blockedServers?: string[];
    allowedTools?: string[];
    blockedTools?: string[];
  };
  dangerousCommands?: string[];
}

export const DEFAULT_POLICY: PolicyConfig = {
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
    "**/.canarywatch/**",
  ],
  scopeEnforced: true,
  massMod: {
    windowMs: 10_000,
    threshold: 50,
    allowlistDirs: ["node_modules", ".git", "dist", "build", "target", ".next", "coverage"],
  },
  d3: {
    warnBeforePause: 1,
  },
  mcp: {
    allowedServers: ["*"],
    blockedServers: [],
    allowedTools: ["*"],
    blockedTools: [],
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
    "ngrok",
  ],
};

