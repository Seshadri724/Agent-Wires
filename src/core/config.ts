// Loads the user's policy config, falling back to DEFAULT_POLICY.
// docs/ARCHITECTURE.md names TOML as the eventual format; v1 uses JSON
// (no parser dependency required) with the same shape so migrating the
// format later is a parser swap, not a schema change.

import fs from "node:fs";
import { policyPath } from "./home.ts";
import { DEFAULT_POLICY } from "./types.ts";
import type { PolicyConfig } from "./types.ts";

export function loadPolicy(): PolicyConfig {
  const p = policyPath();
  if (!fs.existsSync(p)) return DEFAULT_POLICY;
  const raw = JSON.parse(fs.readFileSync(p, "utf8"));
  return {
    ...DEFAULT_POLICY,
    ...raw,
    massMod: { ...DEFAULT_POLICY.massMod, ...(raw.massMod ?? {}) },
    d3: { ...DEFAULT_POLICY.d3, ...(raw.d3 ?? {}) },
  };
}

export function savePolicy(policy: PolicyConfig): void {
  fs.writeFileSync(policyPath(), JSON.stringify(policy, null, 2));
}

export function ensurePolicyFile(): void {
  const p = policyPath();
  if (!fs.existsSync(p)) savePolicy(DEFAULT_POLICY);
}
