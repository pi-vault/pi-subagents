# Chain Execution — Phase 5: Chain Discovery

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend paths and agent discovery to find chain files from project (`.pi/chains/`), user, and bundled directories.

**Architecture:** Add chain directory fields to `ResolvedPaths`, add `discoverChains()` function to `src/core/agents.ts` that scans directories in priority order (project > user > bundled) and returns deduplicated chain configs. Within a single directory, `.chain.json` takes priority over `.chain.md` when both define the same chain name (per spec section 4).

**Tech Stack:** TypeScript, Vitest

**Spec:** `docs/superpowers/specs/2026-07-11-chain-execution-design.md`

**Reference:** `/Users/lanh/Developer/pi-packages/nicobailon-pi-subagents` (source project to port from)

**Parent plan:** `docs/superpowers/plans/2026-07-11-chain-execution.md`

**Prerequisites:** Phase 1 (types), Phase 3 (chain-serializer for `parseChain`/`parseJsonChain`).

---

### Task 6: Extend paths and add `discoverChains()`

**Files:**

- Modify: `src/shared/types.ts` (add chain paths to `ResolvedPaths`)
- Modify: `src/core/paths.ts` (add chain directory resolution)
- Modify: `src/core/agents.ts` (add `discoverChains()`)
- Create: `tests/chain-discovery.test.ts`

- [ ] **Step 1: Add chain directory fields to `ResolvedPaths`**

In `src/shared/types.ts`, add to the `ResolvedPaths` interface:

```typescript
export interface ResolvedPaths {
  agentDir: string;
  configPath: string;
  userAgentsDir: string;
  bundledAgentsDir: string;
  sessionsDir: string;
  // Chain directories
  userChainsDir: string;
  bundledChainsDir: string;
}
```

Note: Project chain directory (`.pi/chains/` from cwd) is NOT part of `ResolvedPaths` because it depends on the working directory at call time — just like `.pi/skills/` and `.pi/subagents.json`. It's resolved dynamically in `discoverChains()`.

- [ ] **Step 2: Update `src/core/paths.ts`**

Add chain directory resolution:

```typescript
export function getBundledChainsDir(): string {
  return resolve(currentDir, "../../chains");
}

export function resolvePaths(agentDir = getAgentDir()): ResolvedPaths {
  return {
    agentDir,
    configPath: join(agentDir, "extensions", "subagents.json"),
    userAgentsDir: join(agentDir, "agents"),
    bundledAgentsDir: getBundledAgentsDir(),
    sessionsDir: join(agentDir, "sessions"),
    userChainsDir: join(agentDir, "chains"),
    bundledChainsDir: getBundledChainsDir(),
  };
}
```

Note: No `chains/` directory exists in the project root yet. `getBundledChainsDir()` will resolve to a non-existent path, which `discoverChainsFromDirectory()` handles gracefully (returns empty). Bundled chain files can be added later.

- [ ] **Step 3: Run typecheck to find any breakage from ResolvedPaths change**

Run: `pnpm typecheck`
Expected: PASS (or fix any callers that destructure ResolvedPaths — the new fields are additive so should be fine)

- [ ] **Step 4: Add `discoverChains()` to `src/core/agents.ts`**

Add imports at the top of the file (merge into existing import blocks):

```typescript
import { parseChain, parseJsonChain } from "./chain-serializer.js";
```

Add `ChainConfig`, `ChainDiscoveryDiagnostic`, and `ChainDiscoveryResult` to the existing `../shared/types.js` import.

Add the following functions at the end of the file:

```typescript
function discoverChainsFromDirectory(directory: string): {
  chains: ChainConfig[];
  diagnostics: ChainDiscoveryDiagnostic[];
} {
  if (!existsSync(directory)) return { chains: [], diagnostics: [] };

  const diagnostics: ChainDiscoveryDiagnostic[] = [];
  const fileNames = readdirSync(directory)
    .filter((f) => f.endsWith(".chain.md") || f.endsWith(".chain.json"))
    .sort((a, b) => a.localeCompare(b));

  // Parse all files, dedup by name within directory.
  // .chain.json wins over .chain.md for the same chain name (spec §4).
  const byName = new Map<string, ChainConfig>();
  for (const fileName of fileNames) {
    const filePath = resolve(directory, fileName);
    try {
      const content = readFileSync(filePath, "utf8");
      const config = fileName.endsWith(".chain.json")
        ? parseJsonChain(filePath, content)
        : parseChain(filePath, content);
      const key = config.name.toLowerCase();
      const existing = byName.get(key);
      if (
        existing &&
        existing.filePath.endsWith(".chain.json") &&
        filePath.endsWith(".chain.md")
      ) {
        // JSON already registered — skip the .md variant silently
        continue;
      }
      byName.set(key, config);
    } catch (e) {
      diagnostics.push({
        filePath,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return { chains: [...byName.values()], diagnostics };
}

export function discoverChains(
  paths: ResolvedPaths,
  cwd?: string,
): ChainDiscoveryResult {
  // Priority: project > user > bundled (higher priority = inserted first, wins on conflict)
  const projectChainsDir = cwd ? join(cwd, ".pi", "chains") : undefined;
  const projectResult = projectChainsDir
    ? discoverChainsFromDirectory(projectChainsDir)
    : { chains: [], diagnostics: [] };
  const userResult = discoverChainsFromDirectory(paths.userChainsDir);
  const bundledResult = discoverChainsFromDirectory(paths.bundledChainsDir);
  const chainsByName = new Map<string, ChainConfig>();
  const diagnostics = [
    ...projectResult.diagnostics,
    ...userResult.diagnostics,
    ...bundledResult.diagnostics,
  ];

  // Insert in priority order: project first, then user, then bundled
  const allChains = [
    ...projectResult.chains,
    ...userResult.chains,
    ...bundledResult.chains,
  ];

  for (const chain of allChains) {
    const key = chain.name.toLowerCase();
    if (chainsByName.has(key)) {
      diagnostics.push({
        filePath: chain.filePath,
        error: `duplicate chain name "${chain.name}" skipped; higher-priority scope wins`,
      });
      continue;
    }
    chainsByName.set(key, chain);
  }

  return {
    chains: [...chainsByName.values()],
    diagnostics,
  };
}
```

- [ ] **Step 5: Write tests for chain discovery**

Create `tests/chain-discovery.test.ts`:

```typescript
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
```

- [ ] **Step 6: Run tests**

Run: `pnpm vitest run tests/chain-discovery.test.ts`
Expected: PASS

- [ ] **Step 7: Run full check**

Run: `pnpm check`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/shared/types.ts src/core/paths.ts src/core/agents.ts tests/chain-discovery.test.ts
git commit -m "feat(chain-discovery): discover .chain.md and .chain.json from project/user/bundled dirs"
```
