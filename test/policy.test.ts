import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { evaluate, grantExemption } from "../src/core/policy.ts";
import { canonicalize } from "../src/core/canonicalize.ts";
import { DEFAULT_POLICY } from "../src/core/types.ts";
import type { PolicyConfig, SessionState, ToolCallEvent } from "../src/core/types.ts";

function freshSession(overrides: Partial<SessionState> = {}): SessionState {
  return {
    sessionId: "s1",
    scopeRoots: [],
    writeTimestamps: [],
    scopeViolations: 0,
    locked: false,
    exemptions: [],
    ...overrides,
  };
}

function event(overrides: Partial<ToolCallEvent> = {}): ToolCallEvent {
  return {
    kind: "tool_call",
    sessionId: "s1",
    tool: "Read",
    paths: [],
    phase: "pre",
    ts: Date.now(),
    ...overrides,
  };
}

describe("D1 canary detector", () => {
  test("targeted read of a canary pauses", () => {
    const canary = canonicalize("/workspace/.env.backup");
    const manifest = new Set([canary]);
    const decision = evaluate(
      event({ paths: [{ path: "/workspace/.env.backup", access: "read", confidence: "exact" }] }),
      DEFAULT_POLICY,
      manifest,
      freshSession()
    );
    assert.equal(decision.action, "pause");
    assert.equal(decision.detector, "D1");
  });

  test("listing (not reading) a canary only logs — the load-bearing FP fix", () => {
    const canary = canonicalize("/workspace/.env.backup");
    const manifest = new Set([canary]);
    const decision = evaluate(
      event({ tool: "Glob", paths: [{ path: "/workspace/.env.backup", access: "list", confidence: "glob" }] }),
      DEFAULT_POLICY,
      manifest,
      freshSession()
    );
    assert.equal(decision.action, "log");
    assert.equal(decision.detector, "D1");
  });

  test("a broad sweep that never exact-matches a canary allows", () => {
    const manifest = new Set([canonicalize("/workspace/.env.backup")]);
    const decision = evaluate(
      event({ tool: "Grep", paths: [{ path: "/workspace", access: "list", confidence: "glob" }] }),
      DEFAULT_POLICY,
      manifest,
      freshSession()
    );
    assert.equal(decision.action, "allow");
  });

  test("write and delete of a canary also pause", () => {
    const canary = canonicalize("/workspace/.env.backup");
    const manifest = new Set([canary]);
    for (const access of ["write", "delete"] as const) {
      const decision = evaluate(
        event({ tool: "Edit", paths: [{ path: "/workspace/.env.backup", access, confidence: "exact" }] }),
        DEFAULT_POLICY,
        manifest,
        freshSession()
      );
      assert.equal(decision.action, "pause", `access=${access}`);
    }
  });
});

describe("D2 sensitive path detector", () => {
  test("reading ~/.ssh/id_rsa pauses even with an empty manifest", () => {
    const decision = evaluate(
      event({ paths: [{ path: "/home/user/.ssh/id_rsa", access: "read", confidence: "exact" }] }),
      DEFAULT_POLICY,
      new Set(),
      freshSession()
    );
    assert.equal(decision.action, "pause");
    assert.equal(decision.detector, "D2");
  });

  test("an exemption for the path lets it through", () => {
    const state = freshSession();
    grantExemption(state, "/home/user/.ssh/id_rsa", "read", true);
    const decision = evaluate(
      event({ paths: [{ path: "/home/user/.ssh/id_rsa", access: "read", confidence: "exact" }] }),
      DEFAULT_POLICY,
      new Set(),
      state
    );
    assert.equal(decision.action, "allow");
  });

  test("an unrelated file is unaffected", () => {
    const decision = evaluate(
      event({ paths: [{ path: "/home/user/project/index.js", access: "read", confidence: "exact" }] }),
      DEFAULT_POLICY,
      new Set(),
      freshSession()
    );
    assert.equal(decision.action, "allow");
  });
});

describe("D3 scope detector", () => {
  test("first out-of-scope write warns, second escalates to pause", () => {
    const scopeRoot = canonicalize("/workspace");
    const state = freshSession({ scopeRoots: [scopeRoot] });

    const first = evaluate(
      event({ tool: "Write", paths: [{ path: "/etc/passwd", access: "write", confidence: "exact" }] }),
      DEFAULT_POLICY,
      new Set(),
      state
    );
    assert.equal(first.action, "warn");
    assert.equal(first.detector, "D3");
    assert.equal(state.scopeViolations, 1);

    const second = evaluate(
      event({ tool: "Write", paths: [{ path: "/etc/hosts", access: "write", confidence: "exact" }] }),
      DEFAULT_POLICY,
      new Set(),
      state
    );
    assert.equal(second.action, "pause");
  });

  test("writes inside scope never trigger D3", () => {
    const scopeRoot = canonicalize("/workspace");
    const state = freshSession({ scopeRoots: [scopeRoot] });
    const decision = evaluate(
      event({ tool: "Write", paths: [{ path: "/workspace/src/index.ts", access: "write", confidence: "exact" }] }),
      DEFAULT_POLICY,
      new Set(),
      state
    );
    assert.equal(decision.action, "allow");
  });

  test("no declared scope roots means no enforcement", () => {
    const state = freshSession({ scopeRoots: [] });
    const decision = evaluate(
      event({ tool: "Write", paths: [{ path: "/anywhere/file.txt", access: "write", confidence: "exact" }] }),
      DEFAULT_POLICY,
      new Set(),
      state
    );
    assert.equal(decision.action, "allow");
  });
});

describe("D4 mass modification detector", () => {
  test("writes under the threshold allow", () => {
    const state = freshSession();
    const policy: PolicyConfig = { ...DEFAULT_POLICY, massMod: { ...DEFAULT_POLICY.massMod, threshold: 5 } };
    let last;
    for (let i = 0; i < 4; i++) {
      last = evaluate(
        event({ tool: "Write", paths: [{ path: `/workspace/f${i}.txt`, access: "write", confidence: "exact" }] }),
        policy,
        new Set(),
        state
      );
    }
    assert.equal(last!.action, "allow");
  });

  test("exceeding the threshold within the window pauses", () => {
    const state = freshSession();
    const policy: PolicyConfig = { ...DEFAULT_POLICY, massMod: { ...DEFAULT_POLICY.massMod, threshold: 5 } };
    let last;
    for (let i = 0; i < 7; i++) {
      last = evaluate(
        event({ tool: "Write", paths: [{ path: `/workspace/f${i}.txt`, access: "write", confidence: "exact" }] }),
        policy,
        new Set(),
        state
      );
      if (last.action === "pause") break;
    }
    assert.equal(last!.action, "pause");
    assert.equal(last!.detector, "D4");
  });

  test("writes inside allowlisted churn dirs (node_modules) don't count", () => {
    const state = freshSession();
    const policy: PolicyConfig = { ...DEFAULT_POLICY, massMod: { ...DEFAULT_POLICY.massMod, threshold: 3 } };
    let last;
    for (let i = 0; i < 10; i++) {
      last = evaluate(
        event({
          tool: "Write",
          paths: [{ path: `/workspace/node_modules/pkg/f${i}.txt`, access: "write", confidence: "exact" }],
        }),
        policy,
        new Set(),
        state
      );
    }
    assert.equal(last!.action, "allow");
  });
});

describe("D1 canary token reuse", () => {
  test("pasting a canary secret into a later Write pauses", () => {
    const token = "a".repeat(32);
    const decision = evaluate(
      event({
        tool: "Write",
        paths: [{ path: "/workspace/notes.md", access: "write", confidence: "exact" }],
        raw: { file_path: "/workspace/notes.md", content: `key=${token}` },
      }),
      DEFAULT_POLICY,
      new Set(),
      freshSession(),
      new Set([token])
    );
    assert.equal(decision.action, "pause");
    assert.equal(decision.detector, "D1");
    assert.doesNotMatch(decision.reason, new RegExp(token));
  });

  test("unrelated Write contents allow", () => {
    const decision = evaluate(
      event({
        tool: "Write",
        paths: [{ path: "/workspace/notes.md", access: "write", confidence: "exact" }],
        raw: { content: "hello" },
      }),
      DEFAULT_POLICY,
      new Set(),
      freshSession(),
      new Set(["a".repeat(32)])
    );
    assert.equal(decision.action, "allow");
  });
});

describe("session lock", () => {
  test("a locked session denies everything regardless of the event", () => {
    const state = freshSession({ locked: true });
    const decision = evaluate(
      event({ paths: [{ path: "/workspace/index.js", access: "read", confidence: "exact" }] }),
      DEFAULT_POLICY,
      new Set(),
      state
    );
    assert.equal(decision.action, "lockdown");
  });
});
