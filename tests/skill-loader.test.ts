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
  discoverAvailableSkillPaths,
  discoverAvailableSkills,
  preloadSkills,
  resolveSkillPaths,
} from "../src/core/skill-loader.js";

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

  describe("discoverAvailableSkills", () => {
    test("returns empty array when no skills exist", () => {
      expect(discoverAvailableSkills(tmpDir)).toEqual([]);
    });

    test("discovers flat and directory skills", () => {
      writeFlat(piSkillsDir(), "alpha", "A");
      writeSkillDir(piSkillsDir(), "beta", "B");
      const skills = discoverAvailableSkills(tmpDir);
      expect(skills).toContain("alpha");
      expect(skills).toContain("beta");
    });

    test("deduplicates skills across scopes", () => {
      writeFlat(piSkillsDir(), "shared", "project");
      writeFlat(userSkillsDir(), "shared", "user");
      const skills = discoverAvailableSkills(tmpDir);
      expect(skills.filter((s) => s === "shared")).toHaveLength(1);
    });
  });

  describe("resolveSkillPaths", () => {
    test("returns empty array for empty skill list", () => {
      expect(resolveSkillPaths([], tmpDir)).toEqual([]);
    });

    test("resolves flat .md skill to file path", () => {
      writeFlat(piSkillsDir(), "tdd", "# TDD");
      const result = resolveSkillPaths(["tdd"], tmpDir);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("tdd");
      expect(result[0].path).toBe(join(piSkillsDir(), "tdd.md"));
    });

    test("resolves directory skill to directory path", () => {
      writeSkillDir(piSkillsDir(), "debugging", "# Debug");
      const result = resolveSkillPaths(["debugging"], tmpDir);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("debugging");
      expect(result[0].path).toBe(join(piSkillsDir(), "debugging"));
    });

    test("omits skills that cannot be found", () => {
      writeFlat(piSkillsDir(), "exists", "yes");
      const result = resolveSkillPaths(["exists", "missing"], tmpDir);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("exists");
    });

    test("omits unsafe skill names", () => {
      const result = resolveSkillPaths(["../../etc/passwd", ".hidden"], tmpDir);
      expect(result).toEqual([]);
    });

    test("resolves nested directory skills via BFS", () => {
      writeSkillDir(join(piSkillsDir(), "category"), "nested", "# Nested");
      const result = resolveSkillPaths(["nested"], tmpDir);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("nested");
      expect(result[0].path).toBe(join(piSkillsDir(), "category", "nested"));
    });

    test("prefers .pi/skills over .agents/skills", () => {
      writeFlat(piSkillsDir(), "shared", "from-pi");
      writeFlat(agentsSkillsDir(), "shared", "from-agents");
      const result = resolveSkillPaths(["shared"], tmpDir);
      expect(result[0].path).toBe(join(piSkillsDir(), "shared.md"));
    });
  });

  describe("discoverAvailableSkillPaths", () => {
    test("returns empty array when no skills exist", () => {
      expect(discoverAvailableSkillPaths(tmpDir)).toEqual([]);
    });

    test("discovers flat and directory skills with paths", () => {
      writeFlat(piSkillsDir(), "alpha", "A");
      writeSkillDir(piSkillsDir(), "beta", "B");
      const result = discoverAvailableSkillPaths(tmpDir);
      const names = result.map((r) => r.name);
      expect(names).toContain("alpha");
      expect(names).toContain("beta");
      const alpha = result.find((r) => r.name === "alpha");
      const beta = result.find((r) => r.name === "beta");
      expect(alpha?.path).toBe(join(piSkillsDir(), "alpha.md"));
      expect(beta?.path).toBe(join(piSkillsDir(), "beta"));
    });

    test("deduplicates skills across scopes returning first-found path", () => {
      writeFlat(piSkillsDir(), "shared", "project");
      writeFlat(userSkillsDir(), "shared", "user");
      const result = discoverAvailableSkillPaths(tmpDir);
      const shared = result.filter((r) => r.name === "shared");
      expect(shared).toHaveLength(1);
      expect(shared[0].path).toBe(join(piSkillsDir(), "shared.md"));
    });
  });
});
