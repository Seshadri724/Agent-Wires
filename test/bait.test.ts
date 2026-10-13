import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { TEMPLATES } from "../src/seeder/templates.ts";
import { seed } from "../src/seeder/seeder.ts";

const TELL = /canarywatch|decoy|tripwire/i;

test("bait files do not advertise themselves", () => {
  const token = "b".repeat(32);
  for (const tpl of TEMPLATES) {
    assert.doesNotMatch(tpl.relativePath, TELL, tpl.relativePath);
    const body = tpl.render(token);
    assert.doesNotMatch(body, TELL, tpl.relativePath);
    assert.ok(body.includes(token), tpl.relativePath);
  }
});

test("seeded file contains the manifest tokenId", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "cw-bait-home-"));
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "cw-bait-ws-"));
  process.env.CANARYWATCH_HOME = home;
  try {
    const result = seed(ws, "light");
    assert.ok(result.seeded.length >= 1);
    const entry = result.seeded[0];
    const body = fs.readFileSync(entry.path, "utf8");
    assert.ok(body.includes(entry.tokenId));
    assert.doesNotMatch(body, TELL);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(ws, { recursive: true, force: true });
    delete process.env.CANARYWATCH_HOME;
  }
});
