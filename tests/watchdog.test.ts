import { describe, expect, it } from "vitest";
import { computeChangeSignature } from "../src/core/watchdog.js";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";

describe("computeChangeSignature", () => {
  it("returns undefined for non-git directory", () => {
    const tmp = mkdtempSync(join(tmpdir(), "watchdog-"));
    expect(computeChangeSignature(tmp)).toBeUndefined();
  });

  it("returns a signature with key and changedPaths for git repo with changes", () => {
    const tmp = mkdtempSync(join(tmpdir(), "watchdog-git-"));
    execSync("git init", { cwd: tmp, stdio: "pipe" });
    execSync("git config user.email 'test@test.com'", { cwd: tmp, stdio: "pipe" });
    execSync("git config user.name 'Test'", { cwd: tmp, stdio: "pipe" });
    writeFileSync(join(tmp, "file.ts"), "const x = 1;");
    execSync("git add . && git commit -m init", { cwd: tmp, stdio: "pipe" });

    writeFileSync(join(tmp, "file.ts"), "const x = 2;");

    const sig = computeChangeSignature(tmp);
    expect(sig).toBeDefined();
    expect(sig!.changedPaths).toContain("file.ts");
    expect(sig!.key).toBeTruthy();
  });

  it("returns undefined when no changes", () => {
    const tmp = mkdtempSync(join(tmpdir(), "watchdog-clean-"));
    execSync("git init", { cwd: tmp, stdio: "pipe" });
    execSync("git config user.email 'test@test.com'", { cwd: tmp, stdio: "pipe" });
    execSync("git config user.name 'Test'", { cwd: tmp, stdio: "pipe" });
    writeFileSync(join(tmp, "file.ts"), "clean");
    execSync("git add . && git commit -m init", { cwd: tmp, stdio: "pipe" });

    const sig = computeChangeSignature(tmp);
    expect(sig).toBeUndefined();
  });

  it("filters out .pi/ and node_modules/ paths", () => {
    const tmp = mkdtempSync(join(tmpdir(), "watchdog-filter-"));
    execSync("git init", { cwd: tmp, stdio: "pipe" });
    execSync("git config user.email 'test@test.com'", { cwd: tmp, stdio: "pipe" });
    execSync("git config user.name 'Test'", { cwd: tmp, stdio: "pipe" });
    writeFileSync(join(tmp, "real.ts"), "code");
    mkdirSync(join(tmp, ".pi"), { recursive: true });
    writeFileSync(join(tmp, ".pi", "settings.json"), "{}");
    execSync("git add . && git commit -m init", { cwd: tmp, stdio: "pipe" });

    writeFileSync(join(tmp, ".pi", "settings.json"), '{"x":1}');
    const sig = computeChangeSignature(tmp);
    expect(sig).toBeUndefined();
  });

  it("produces different keys for different content changes", () => {
    const tmp = mkdtempSync(join(tmpdir(), "watchdog-keys-"));
    execSync("git init", { cwd: tmp, stdio: "pipe" });
    execSync("git config user.email 'test@test.com'", { cwd: tmp, stdio: "pipe" });
    execSync("git config user.name 'Test'", { cwd: tmp, stdio: "pipe" });
    writeFileSync(join(tmp, "file.ts"), "original");
    execSync("git add . && git commit -m init", { cwd: tmp, stdio: "pipe" });

    writeFileSync(join(tmp, "file.ts"), "change-a");
    const sig1 = computeChangeSignature(tmp);

    writeFileSync(join(tmp, "file.ts"), "change-b");
    const sig2 = computeChangeSignature(tmp);

    expect(sig1!.key).not.toBe(sig2!.key);
  });
});
