// Loads the user's policy config, falling back to DEFAULT_POLICY.
// docs/ARCHITECTURE.md names TOML as the eventual format; v1 uses JSON
// (no parser dependency required) with the same shape so migrating the
// format later is a parser swap, not a schema change.

import fs from "node:fs";
import { policyPath } from "./home.ts";
import { DEFAULT_POLICY } from "./types.ts";
import type { PolicyConfig } from "./types.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isStringArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function validatePolicyConfig(value: unknown): string | undefined {
  if (!isRecord(value)) return "policy must be a JSON object";
  if (value.sensitivePaths !== undefined && !isStringArray(value.sensitivePaths)) return "sensitivePaths must be an array of strings";
  if (value.scopeEnforced !== undefined && typeof value.scopeEnforced !== "boolean") return "scopeEnforced must be a boolean";
  if (value.dangerousCommands !== undefined && !isStringArray(value.dangerousCommands)) return "dangerousCommands must be an array of strings";

  if (value.massMod !== undefined) {
    if (!isRecord(value.massMod)) return "massMod must be an object";
    const { windowMs, threshold, allowlistDirs } = value.massMod;
    if (windowMs !== undefined && (typeof windowMs !== "number" || !Number.isFinite(windowMs) || windowMs <= 0)) return "massMod.windowMs must be a positive number";
    if (threshold !== undefined && (typeof threshold !== "number" || !Number.isInteger(threshold) || threshold <= 0)) return "massMod.threshold must be a positive integer";
    if (allowlistDirs !== undefined && !isStringArray(allowlistDirs)) return "massMod.allowlistDirs must be an array of strings";
  }

  if (value.d3 !== undefined) {
    if (!isRecord(value.d3)) return "d3 must be an object";
    const threshold = value.d3.warnBeforePause;
    if (threshold !== undefined && (typeof threshold !== "number" || !Number.isInteger(threshold) || threshold < 0)) {
      return "d3.warnBeforePause must be a non-negative integer";
    }
  }

  if (value.mcp !== undefined) {
    if (!isRecord(value.mcp)) return "mcp must be an object";
    for (const field of ["allowedServers", "blockedServers", "allowedTools", "blockedTools"]) {
      if (value.mcp[field] !== undefined && !isStringArray(value.mcp[field])) return `mcp.${field} must be an array of strings`;
    }
  }
  return undefined;
}

export function parsePolicyConfig(value: unknown): PolicyConfig {
  const problem = validatePolicyConfig(value);
  if (problem) throw new Error(`Invalid policy config: ${problem}`);
  const raw = value as Partial<PolicyConfig>;
  return {
    ...DEFAULT_POLICY,
    ...raw,
    massMod: { ...DEFAULT_POLICY.massMod, ...raw.massMod },
    d3: { ...DEFAULT_POLICY.d3, ...raw.d3 },
  };
}

export function loadPolicy(): PolicyConfig {
  const p = policyPath();
  if (!fs.existsSync(p)) return DEFAULT_POLICY;
  return parsePolicyConfig(JSON.parse(fs.readFileSync(p, "utf8")));
}

export function savePolicy(policy: PolicyConfig): void {
  const validated = parsePolicyConfig(policy);
  fs.writeFileSync(policyPath(), JSON.stringify(validated, null, 2));
}

export function ensurePolicyFile(): void {
  const p = policyPath();
  if (!fs.existsSync(p)) savePolicy(DEFAULT_POLICY);
}
