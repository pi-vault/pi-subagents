import type { Dirent } from "node:fs";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { isSymlink, isUnsafeName, safeReadFile } from "./safe-fs.js";

export interface PreloadedSkill {
  name: string;
  content: string;
}

/** @internal Exported for testing. */
export type SkillEntry =
  | { kind: "flat"; name: string; filePath: string }
  | { kind: "directory"; name: string; dirPath: string; skillMdPath: string };

export function preloadSkills(
  skillNames: string[],
  cwd: string,
): PreloadedSkill[] {
  return skillNames.map((name) => ({
    name,
    content: loadSkillContent(name, cwd),
  }));
}

function getSearchRoots(cwd: string): string[] {
  return [
    join(cwd, ".pi", "skills"),
    join(cwd, ".agents", "skills"),
    join(getAgentDir(), "skills"),
    join(homedir(), ".agents", "skills"),
    join(homedir(), ".pi", "skills"),
  ];
}



/**
 * BFS walk over a skill root directory. Visits flat .md files at the root level,
 * then descends into subdirectories. Directories containing SKILL.md are skills;
 * directories without are categories (descended into).
 *
 * The visitor receives each discovered SkillEntry. Return `true` to stop early.
 *
 * @internal Exported for testing.
 */
export function walkSkillTree(
  root: string,
  visitor: (entry: SkillEntry) => boolean,
): void {
  if (isSymlink(root)) return;
  if (!existsSync(root)) return;

  // Phase 1: Flat .md files at root level
  let rootEntries: Dirent[];
  try {
    rootEntries = readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of rootEntries) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith(".md")) continue;
    const filePath = join(root, entry.name);
    if (isSymlink(filePath)) continue;
    const name = entry.name.slice(0, -3); // strip .md
    if (isUnsafeName(name)) continue;
    const stop = visitor({ kind: "flat", name, filePath });
    if (stop) return;
  }

  // Phase 2: BFS over directories
  const queue: string[] = [root];

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) continue;

    let entries: Dirent[];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith(".") || entry.name === "node_modules")
        continue;

      const entryPath = join(current, entry.name);
      if (isSymlink(entryPath)) continue;

      const skillMdPath = join(entryPath, "SKILL.md");
      const hasSkillMd = existsSync(skillMdPath) && !isSymlink(skillMdPath);

      if (hasSkillMd) {
        // This directory IS a skill
        if (!isUnsafeName(entry.name)) {
          const stop = visitor({
            kind: "directory",
            name: entry.name,
            dirPath: entryPath,
            skillMdPath,
          });
          if (stop) return;
        }
        // Don't descend into skill directories
        continue;
      }

      // Category directory - descend
      queue.push(entryPath);
    }
  }
}

function loadSkillContent(name: string, cwd: string): string {
  if (isUnsafeName(name)) {
    return `(Skill "${name}" skipped: name contains unsafe characters)`;
  }
  for (const root of getSearchRoots(cwd)) {
    const content = findInRoot(root, name);
    if (content !== undefined) return content;
  }
  return `(Skill "${name}" not found in .pi/skills/, .agents/skills/, or global skill locations)`;
}

function findInRoot(root: string, name: string): string | undefined {
  let result: string | undefined;
  walkSkillTree(root, (entry) => {
    if (entry.name !== name) return false;
    if (entry.kind === "flat") {
      result = safeReadFile(entry.filePath)?.trim();
    } else {
      result = safeReadFile(entry.skillMdPath)?.trim();
    }
    return result !== undefined; // stop if we found content
  });
  return result;
}
