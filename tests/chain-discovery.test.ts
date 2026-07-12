import { describe, expect, test } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { discoverChains } from "../src/core/agents.js";
import type { ResolvedPaths } from "../src/shared/types.js";

const MD_CHAIN = (name: string, desc: string) =>
  `---\nname: ${name}\ndescription: ${desc}\n---\n\n## scout\n\nscan\n`;

const JSON_CHAIN = (name: string, desc: string) =>
  JSON.stringify({
    name,
    description: desc,
    chain: [{ agent: "scout", task: "scan" }],
  });

function makeTmpPaths(): ResolvedPaths & { tmpDir: string } {
  const tmpDir = join(
    tmpdir(),
    `chain-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  );
  mkdirSync(tmpDir, { recursive: true });
  const userChainsDir = join(tmpDir, "user-chains");
  const bundledChainsDir = join(tmpDir, "bundled-chains");
  mkdirSync(userChainsDir, { recursive: true });
  mkdirSync(bundledChainsDir, { recursive: true });
  return {
    agentDir: tmpDir,
    configPath: join(tmpDir, "config.json"),
    userPromptsDir: join(tmpDir, "prompts"),
    bundledPromptsDir: join(tmpDir, "bundled-prompts"),
    userAgentsDir: join(tmpDir, "user-agents"),
    bundledAgentsDir: join(tmpDir, "bundled-agents"),
    sessionsDir: join(tmpDir, "sessions"),
    userChainsDir,
    bundledChainsDir,
    tmpDir,
  };
}

describe("discoverChains", () => {
  test("discovers .chain.md files from bundled dir", () => {
    const paths = makeTmpPaths();
    writeFileSync(
      join(paths.bundledChainsDir, "scout-plan.chain.md"),
      MD_CHAIN("scout-plan", "test"),
    );

    const result = discoverChains(paths);
    expect(result.chains).toHaveLength(1);
    expect(result.chains[0]!.name).toBe("scout-plan");

    rmSync(paths.tmpDir, { recursive: true, force: true });
  });

  test("discovers .chain.json files from bundled dir", () => {
    const paths = makeTmpPaths();
    writeFileSync(
      join(paths.bundledChainsDir, "review.chain.json"),
      JSON_CHAIN("review", "json chain"),
    );

    const result = discoverChains(paths);
    expect(result.chains).toHaveLength(1);
    expect(result.chains[0]!.name).toBe("review");
    expect(result.chains[0]!.description).toBe("json chain");

    rmSync(paths.tmpDir, { recursive: true, force: true });
  });

  test("discovers both .chain.md and .chain.json with different names", () => {
    const paths = makeTmpPaths();
    writeFileSync(
      join(paths.bundledChainsDir, "alpha.chain.md"),
      MD_CHAIN("alpha", "md"),
    );
    writeFileSync(
      join(paths.bundledChainsDir, "beta.chain.json"),
      JSON_CHAIN("beta", "json"),
    );

    const result = discoverChains(paths);
    expect(result.chains).toHaveLength(2);
    const names = result.chains.map((c) => c.name).sort();
    expect(names).toEqual(["alpha", "beta"]);

    rmSync(paths.tmpDir, { recursive: true, force: true });
  });

  test(".chain.json wins over .chain.md for same name in same directory", () => {
    const paths = makeTmpPaths();
    writeFileSync(
      join(paths.bundledChainsDir, "test.chain.md"),
      MD_CHAIN("test", "from-md"),
    );
    writeFileSync(
      join(paths.bundledChainsDir, "test.chain.json"),
      JSON_CHAIN("test", "from-json"),
    );

    const result = discoverChains(paths);
    expect(result.chains).toHaveLength(1);
    expect(result.chains[0]!.description).toBe("from-json");
    // No diagnostic for the silent .md skip
    expect(result.diagnostics).toHaveLength(0);

    rmSync(paths.tmpDir, { recursive: true, force: true });
  });

  test("user chains shadow bundled chains", () => {
    const paths = makeTmpPaths();
    writeFileSync(
      join(paths.bundledChainsDir, "test.chain.md"),
      MD_CHAIN("test", "bundled"),
    );
    writeFileSync(
      join(paths.userChainsDir, "test.chain.md"),
      MD_CHAIN("test", "user"),
    );

    const result = discoverChains(paths);
    expect(result.chains).toHaveLength(1);
    expect(result.chains[0]!.description).toBe("user");

    rmSync(paths.tmpDir, { recursive: true, force: true });
  });

  test("project chains shadow user chains", () => {
    const paths = makeTmpPaths();
    const projectChainsDir = join(paths.tmpDir, ".pi", "chains");
    mkdirSync(projectChainsDir, { recursive: true });
    writeFileSync(
      join(paths.userChainsDir, "test.chain.md"),
      MD_CHAIN("test", "user"),
    );
    writeFileSync(
      join(projectChainsDir, "test.chain.md"),
      MD_CHAIN("test", "project"),
    );

    const result = discoverChains(paths, paths.tmpDir);
    expect(result.chains).toHaveLength(1);
    expect(result.chains[0]!.description).toBe("project");

    rmSync(paths.tmpDir, { recursive: true, force: true });
  });

  test("shadowed chains produce a diagnostic", () => {
    const paths = makeTmpPaths();
    writeFileSync(
      join(paths.bundledChainsDir, "dup.chain.md"),
      MD_CHAIN("dup", "bundled"),
    );
    writeFileSync(
      join(paths.userChainsDir, "dup.chain.md"),
      MD_CHAIN("dup", "user"),
    );

    const result = discoverChains(paths);
    expect(result.chains).toHaveLength(1);
    const dupDiag = result.diagnostics.find((d) =>
      d.error.includes('duplicate chain name "dup"'),
    );
    expect(dupDiag).toBeDefined();
    expect(dupDiag!.filePath).toContain("bundled-chains");

    rmSync(paths.tmpDir, { recursive: true, force: true });
  });

  test("malformed file produces a diagnostic without crashing", () => {
    const paths = makeTmpPaths();
    writeFileSync(
      join(paths.bundledChainsDir, "good.chain.md"),
      MD_CHAIN("good", "ok"),
    );
    writeFileSync(
      join(paths.bundledChainsDir, "bad.chain.json"),
      "not valid json {{{",
    );

    const result = discoverChains(paths);
    expect(result.chains).toHaveLength(1);
    expect(result.chains[0]!.name).toBe("good");
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]!.filePath).toContain("bad.chain.json");

    rmSync(paths.tmpDir, { recursive: true, force: true });
  });

  test("returns empty when directories don't exist", () => {
    const paths = makeTmpPaths();
    rmSync(paths.userChainsDir, { recursive: true });
    rmSync(paths.bundledChainsDir, { recursive: true });

    const result = discoverChains(paths);
    expect(result.chains).toHaveLength(0);
    expect(result.diagnostics).toHaveLength(0);

    rmSync(paths.tmpDir, { recursive: true, force: true });
  });

  test("returns empty when no cwd and directories are empty", () => {
    const paths = makeTmpPaths();
    const result = discoverChains(paths);
    expect(result.chains).toHaveLength(0);

    rmSync(paths.tmpDir, { recursive: true, force: true });
  });

  test("same-format duplicate in same directory emits diagnostic", () => {
    const paths = makeTmpPaths();
    writeFileSync(
      join(paths.bundledChainsDir, "alpha.chain.md"),
      MD_CHAIN("deploy", "from-alpha"),
    );
    writeFileSync(
      join(paths.bundledChainsDir, "bravo.chain.md"),
      MD_CHAIN("deploy", "from-bravo"),
    );

    const result = discoverChains(paths);
    expect(result.chains).toHaveLength(1);
    // Last alphabetically wins (bravo > alpha)
    expect(result.chains[0]!.description).toBe("from-bravo");
    // Should produce a diagnostic about the overwrite
    const dupDiag = result.diagnostics.find((d) =>
      d.error.includes("deploy"),
    );
    expect(dupDiag).toBeDefined();

    rmSync(paths.tmpDir, { recursive: true, force: true });
  });

  test("name comparison is case-insensitive", () => {
    const paths = makeTmpPaths();
    writeFileSync(
      join(paths.userChainsDir, "upper.chain.md"),
      MD_CHAIN("MyChain", "user"),
    );
    writeFileSync(
      join(paths.bundledChainsDir, "lower.chain.md"),
      MD_CHAIN("mychain", "bundled"),
    );

    const result = discoverChains(paths);
    expect(result.chains).toHaveLength(1);
    expect(result.chains[0]!.description).toBe("user");

    rmSync(paths.tmpDir, { recursive: true, force: true });
  });
});
