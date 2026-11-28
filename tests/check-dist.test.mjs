import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(
  new URL("../scripts/check-dist.mjs", import.meta.url),
);

test("dist check reports modified, missing, and untracked build output", (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "simple-er-dist-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, { cwd });
  const check = () =>
    spawnSync(process.execPath, [script], { cwd, encoding: "utf8" });

  git("init", "--quiet");
  mkdirSync(join(cwd, "dist"));
  const index = join(cwd, "dist", "index.html");
  writeFileSync(index, "original");
  git("add", "dist/");
  git(
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.org",
    "-c",
    "commit.gpgSign=false",
    "commit",
    "--quiet",
    "-m",
    "fixture",
  );

  writeFileSync(join(cwd, "outside.txt"), "ignored by the check");
  assert.equal(check().status, 0);

  writeFileSync(index, "changed");
  assert.equal(check().status, 1);
  unlinkSync(index);
  assert.equal(check().status, 1);

  git("restore", "dist/");
  writeFileSync(join(cwd, "dist", "new.js"), "new asset");
  const result = check();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /dist\/new\.js/);
  assert.match(result.stderr, /npm run build/);
});
