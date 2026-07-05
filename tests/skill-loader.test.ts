import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  preloadSkills,
  walkSkillTree,
} from "../src/core/skill-loader.js";
import type { SkillEntry } from "../src/core/skill-loader.js";

describe("skill-loader", () => {
  let tmpDir: string;
  let originalAgentDir: string | undefined;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "pi-skill-test-"));
    originalAgentDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = join(tmpDir, "user-agent-dir");
  });

  afterEach(() => {
    if (originalAgentDir === undefined) {
      delete process.env.PI_CODING_AGENT_DIR;
    } else {
      process.env.PI_CODING_AGENT_DIR = originalAgentDir;
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  const piSkillsDir = () => join(tmpDir, ".pi", "skills");
  const agentsSkillsDir = () => join(tmpDir, ".agents", "skills");
  const userSkillsDir = () =>
    join(process.env.PI_CODING_AGENT_DIR ?? "", "skills");

  function writeFlat(root: string, name: string, content: string) {
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, `${name}.md`), content);
  }

  function writeSkillDir(root: string, name: string, content: string) {
    const dir = join(root, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), content);
  }

  describe("preloadSkills", () => {
    test("returns empty array for empty skill list", () => {
      expect(preloadSkills([], tmpDir)).toEqual([]);
    });

    test("loads a flat .md skill from .pi/skills", () => {
      writeFlat(
        piSkillsDir(),
        "api-conventions",
        "# API Conventions\nUse REST.",
      );
      const result = preloadSkills(["api-conventions"], tmpDir);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("api-conventions");
      expect(result[0].content).toContain("API Conventions");
    });

    test("loads a directory skill with SKILL.md from .pi/skills", () => {
      writeSkillDir(piSkillsDir(), "writing-go", "# Writing Go\nUse gofmt.");
      const result = preloadSkills(["writing-go"], tmpDir);
      expect(result[0].content).toContain("Writing Go");
    });

    test("loads from .agents/skills", () => {
      writeSkillDir(agentsSkillsDir(), "rust-idioms", "# Rust Idioms");
      const result = preloadSkills(["rust-idioms"], tmpDir);
      expect(result[0].content).toContain("Rust Idioms");
    });

    test("loads from user-level agentDir/skills", () => {
      writeFlat(userSkillsDir(), "shell-tips", "use rg");
      const result = preloadSkills(["shell-tips"], tmpDir);
      expect(result[0].content).toBe("use rg");
    });

    test("prefers .pi/skills over .agents/skills", () => {
      writeFlat(piSkillsDir(), "shared", "from-pi");
      writeFlat(agentsSkillsDir(), "shared", "from-agents");
      expect(preloadSkills(["shared"], tmpDir)[0].content).toBe("from-pi");
    });

    test("prefers project scope over user scope", () => {
      writeFlat(piSkillsDir(), "shared", "project");
      writeFlat(userSkillsDir(), "shared", "user");
      expect(preloadSkills(["shared"], tmpDir)[0].content).toBe("project");
    });

    test("finds nested directory skills via BFS", () => {
      writeSkillDir(
        join(piSkillsDir(), "dev-tools"),
        "modern-cli",
        "# Modern CLI",
      );
      expect(preloadSkills(["modern-cli"], tmpDir)[0].content).toContain(
        "Modern CLI",
      );
    });

    test("does not descend into a skill directory", () => {
      writeSkillDir(piSkillsDir(), "outer", "outer-skill");
      writeSkillDir(join(piSkillsDir(), "outer"), "inner", "hidden");
      expect(preloadSkills(["inner"], tmpDir)[0].content).toContain(
        "not found",
      );
    });

    test("skips node_modules", () => {
      writeSkillDir(join(piSkillsDir(), "node_modules", "pkg"), "leaked", "no");
      expect(preloadSkills(["leaked"], tmpDir)[0].content).toContain(
        "not found",
      );
    });

    test("skips dotfile directories", () => {
      writeSkillDir(join(piSkillsDir(), ".hidden"), "buried", "no");
      expect(preloadSkills(["buried"], tmpDir)[0].content).toContain(
        "not found",
      );
    });

    test("returns fallback for missing skills", () => {
      const result = preloadSkills(["nonexistent"], tmpDir);
      expect(result[0].name).toBe("nonexistent");
      expect(result[0].content).toContain("not found");
    });

    test("loads multiple skills", () => {
      writeFlat(piSkillsDir(), "a", "Content A");
      writeSkillDir(piSkillsDir(), "b", "Content B");
      const result = preloadSkills(["a", "b"], tmpDir);
      expect(result[0].content).toBe("Content A");
      expect(result[1].content).toContain("Content B");
    });

    test("rejects path traversal names", () => {
      expect(preloadSkills(["../../etc/passwd"], tmpDir)[0].content).toContain(
        "skipped",
      );
      expect(preloadSkills(["sub/dir"], tmpDir)[0].content).toContain(
        "skipped",
      );
      expect(preloadSkills(["sub\\dir"], tmpDir)[0].content).toContain(
        "skipped",
      );
    });

    test("rejects dotfile skill names", () => {
      expect(preloadSkills([".hidden"], tmpDir)[0].content).toContain(
        "skipped",
      );
    });

    test("rejects empty skill names", () => {
      expect(preloadSkills([""], tmpDir)[0].content).toContain("skipped");
    });

    test("rejects names exceeding 128 characters", () => {
      const longName = "a".repeat(129);
      expect(preloadSkills([longName], tmpDir)[0].content).toContain("skipped");
    });

    test("rejects symlinked skill files", () => {
      mkdirSync(piSkillsDir(), { recursive: true });
      const secret = join(tmpDir, "secret.md");
      writeFileSync(secret, "TOP SECRET");
      symlinkSync(secret, join(piSkillsDir(), "evil.md"));
      const result = preloadSkills(["evil"], tmpDir);
      expect(result[0].content).toContain("not found");
      expect(result[0].content).not.toContain("TOP SECRET");
    });

    test("rejects symlinked skill directories", () => {
      mkdirSync(piSkillsDir(), { recursive: true });
      const realDir = join(tmpDir, "real-skill");
      mkdirSync(realDir, { recursive: true });
      writeFileSync(join(realDir, "SKILL.md"), "TOP SECRET");
      symlinkSync(realDir, join(piSkillsDir(), "evil-dir"));
      const result = preloadSkills(["evil-dir"], tmpDir);
      expect(result[0].content).toContain("not found");
    });

    test("rejects symlinked skill root directory", () => {
      const realRoot = join(tmpDir, "elsewhere");
      mkdirSync(realRoot, { recursive: true });
      writeFileSync(join(realRoot, "leaked.md"), "TOP SECRET");
      mkdirSync(join(tmpDir, ".pi"), { recursive: true });
      symlinkSync(realRoot, piSkillsDir());
      const result = preloadSkills(["leaked"], tmpDir);
      expect(result[0].content).toContain("not found");
    });
  });

  describe("walkSkillTree", () => {
    test("visits flat .md files at root level", () => {
      writeFlat(piSkillsDir(), "alpha", "A");
      writeFlat(piSkillsDir(), "beta", "B");
      const entries: SkillEntry[] = [];
      walkSkillTree(piSkillsDir(), (entry) => {
        entries.push(entry);
        return false;
      });
      expect(entries).toHaveLength(2);
      expect(entries.every((e) => e.kind === "flat")).toBe(true);
      expect(entries.map((e) => e.name).sort()).toEqual(["alpha", "beta"]);
    });

    test("visits directory skills with SKILL.md", () => {
      writeSkillDir(piSkillsDir(), "debug", "# Debug");
      const entries: SkillEntry[] = [];
      walkSkillTree(piSkillsDir(), (entry) => {
        entries.push(entry);
        return false;
      });
      expect(entries).toHaveLength(1);
      expect(entries[0].kind).toBe("directory");
      if (entries[0].kind === "directory") {
        expect(entries[0].name).toBe("debug");
        expect(entries[0].skillMdPath).toBe(
          join(piSkillsDir(), "debug", "SKILL.md"),
        );
      }
    });

    test("visits nested directory skills inside category folders", () => {
      const category = join(piSkillsDir(), "dev-tools");
      writeSkillDir(category, "linting", "# Lint");
      writeSkillDir(category, "testing", "# Test");
      const entries: SkillEntry[] = [];
      walkSkillTree(piSkillsDir(), (entry) => {
        entries.push(entry);
        return false;
      });
      expect(entries.map((e) => e.name).sort()).toEqual(["linting", "testing"]);
    });

    test("stops early when visitor returns true (flat phase)", () => {
      writeFlat(piSkillsDir(), "aaa", "A");
      writeFlat(piSkillsDir(), "bbb", "B");
      writeFlat(piSkillsDir(), "ccc", "C");
      const visited: string[] = [];
      walkSkillTree(piSkillsDir(), (entry) => {
        visited.push(entry.name);
        return visited.length >= 2;
      });
      expect(visited).toHaveLength(2);
    });

    test("stops early when visitor returns true (BFS phase)", () => {
      writeSkillDir(piSkillsDir(), "aaa", "A");
      writeSkillDir(piSkillsDir(), "bbb", "B");
      writeSkillDir(piSkillsDir(), "ccc", "C");
      const visited: string[] = [];
      walkSkillTree(piSkillsDir(), (entry) => {
        visited.push(entry.name);
        return true; // stop on first
      });
      expect(visited).toHaveLength(1);
    });

    test("skips symlinked files", () => {
      mkdirSync(piSkillsDir(), { recursive: true });
      const real = join(tmpDir, "real.md");
      writeFileSync(real, "SECRET");
      symlinkSync(real, join(piSkillsDir(), "evil.md"));
      const entries: SkillEntry[] = [];
      walkSkillTree(piSkillsDir(), (entry) => {
        entries.push(entry);
        return false;
      });
      expect(entries).toHaveLength(0);
    });

    test("skips symlinked directories", () => {
      mkdirSync(piSkillsDir(), { recursive: true });
      const realDir = join(tmpDir, "real-skill");
      mkdirSync(realDir, { recursive: true });
      writeFileSync(join(realDir, "SKILL.md"), "SECRET");
      symlinkSync(realDir, join(piSkillsDir(), "evil-dir"));
      const entries: SkillEntry[] = [];
      walkSkillTree(piSkillsDir(), (entry) => {
        entries.push(entry);
        return false;
      });
      expect(entries).toHaveLength(0);
    });

    test("skips dotfile directories", () => {
      writeSkillDir(join(piSkillsDir(), ".hidden"), "secret", "no");
      const entries: SkillEntry[] = [];
      walkSkillTree(piSkillsDir(), (entry) => {
        entries.push(entry);
        return false;
      });
      expect(entries).toHaveLength(0);
    });

    test("skips node_modules directories", () => {
      writeSkillDir(join(piSkillsDir(), "node_modules", "pkg"), "leaked", "no");
      const entries: SkillEntry[] = [];
      walkSkillTree(piSkillsDir(), (entry) => {
        entries.push(entry);
        return false;
      });
      expect(entries).toHaveLength(0);
    });

    test("does not descend into skill directories", () => {
      writeSkillDir(piSkillsDir(), "outer", "outer-content");
      writeSkillDir(join(piSkillsDir(), "outer"), "inner", "inner-content");
      const entries: SkillEntry[] = [];
      walkSkillTree(piSkillsDir(), (entry) => {
        entries.push(entry);
        return false;
      });
      expect(entries.map((e) => e.name)).toEqual(["outer"]);
    });

    test("returns nothing for non-existent root", () => {
      const entries: SkillEntry[] = [];
      walkSkillTree(join(tmpDir, "nope"), (entry) => {
        entries.push(entry);
        return false;
      });
      expect(entries).toHaveLength(0);
    });

    test("returns nothing for symlinked root", () => {
      const realRoot = join(tmpDir, "real-root");
      mkdirSync(realRoot, { recursive: true });
      writeFileSync(join(realRoot, "skill.md"), "content");
      const symRoot = join(tmpDir, "sym-root");
      symlinkSync(realRoot, symRoot);
      const entries: SkillEntry[] = [];
      walkSkillTree(symRoot, (entry) => {
        entries.push(entry);
        return false;
      });
      expect(entries).toHaveLength(0);
    });

    test("skips names that fail isUnsafeName validation", () => {
      mkdirSync(piSkillsDir(), { recursive: true });
      writeFileSync(join(piSkillsDir(), ".hidden.md"), "content");
      const entries: SkillEntry[] = [];
      walkSkillTree(piSkillsDir(), (entry) => {
        entries.push(entry);
        return false;
      });
      expect(entries).toHaveLength(0);
    });
  });
});
