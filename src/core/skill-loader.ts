import type { Dirent } from "node:fs";
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export interface PreloadedSkill {
  name: string;
  content: string;
}

export interface ResolvedSkill {
  name: string;
  path: string;
}

export function preloadSkills(
  skillNames: string[],
  cwd: string,
): PreloadedSkill[] {
  return skillNames.map((name) => ({
    name,
    content: loadSkillContent(name, cwd),
  }));
}

export function discoverAvailableSkills(cwd: string): string[] {
  const seen = new Set<string>();
  for (const root of getSearchRoots(cwd)) {
    collectSkillNames(root, seen);
  }
  return [...seen].sort();
}

export function resolveSkillPaths(
  names: string[],
  cwd: string,
): ResolvedSkill[] {
  const results: ResolvedSkill[] = [];
  for (const name of names) {
    if (isUnsafeName(name)) continue;
    const path = findPathForSkill(name, cwd);
    if (path !== undefined) results.push({ name, path });
  }
  return results;
}

export function discoverAvailableSkillPaths(cwd: string): ResolvedSkill[] {
  const seen = new Map<string, string>();
  for (const root of getSearchRoots(cwd)) {
    collectSkillPaths(root, seen);
  }
  return [...seen.entries()]
    .map(([name, path]) => ({ name, path }))
    .sort((a, b) => a.name.localeCompare(b.name));
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

function isUnsafeName(name: string): boolean {
  if (!name || name.length > 128) return true;
  if (name.startsWith(".")) return true;
  if (/[/\\]/.test(name)) return true;
  if (name.includes("..")) return true;
  if (/\s/.test(name)) return true;
  return false;
}

function isSymlink(filePath: string): boolean {
  try {
    return lstatSync(filePath).isSymbolicLink();
  } catch {
    return false;
  }
}

function safeReadFile(filePath: string): string | undefined {
  if (isSymlink(filePath)) return undefined;
  try {
    return readFileSync(filePath, "utf-8");
  } catch {
    return undefined;
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
  if (isSymlink(root)) return undefined;
  if (!existsSync(root)) return undefined;

  // Flat file at root level
  const flatPath = join(root, `${name}.md`);
  const flat = safeReadFile(flatPath)?.trim();
  if (flat !== undefined) return flat;

  // Directory skill at root level
  const dirPath = join(root, name);
  if (!isSymlink(dirPath)) {
    const dirContent = safeReadFile(join(dirPath, "SKILL.md"))?.trim();
    if (dirContent !== undefined) return dirContent;
  }

  // BFS for nested directory skills in category folders
  return findSkillBFS(root, name);
}

function findSkillBFS(root: string, name: string): string | undefined {
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
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;

      const entryPath = join(current, entry.name);
      if (isSymlink(entryPath)) continue;

      const skillMd = join(entryPath, "SKILL.md");
      const hasSkillMd = existsSync(skillMd) && !isSymlink(skillMd);

      if (hasSkillMd) {
        // This directory IS a skill
        if (entry.name === name) {
          const content = safeReadFile(skillMd)?.trim();
          if (content !== undefined) return content;
        }
        // Don't descend into skill directories
        continue;
      }

      // Category directory — descend
      queue.push(entryPath);
    }
  }
  return undefined;
}

function collectSkillNames(root: string, seen: Set<string>): void {
  if (isSymlink(root)) return;
  if (!existsSync(root)) return;

  // Flat files at root level
  let entries: Dirent[];
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith(".md")) {
      const entryPath = join(root, entry.name);
      if (isSymlink(entryPath)) continue;
      const skillName = entry.name.slice(0, -3);
      if (!isUnsafeName(skillName)) seen.add(skillName);
    }
  }

  // BFS for directory skills
  const queue: string[] = [root];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) continue;

    let dirEntries: Dirent[];
    try {
      dirEntries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of dirEntries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;

      const entryPath = join(current, entry.name);
      if (isSymlink(entryPath)) continue;

      const skillMd = join(entryPath, "SKILL.md");
      if (existsSync(skillMd) && !isSymlink(skillMd)) {
        if (!isUnsafeName(entry.name)) seen.add(entry.name);
        continue;
      }

      queue.push(entryPath);
    }
  }
}

function findPathForSkill(name: string, cwd: string): string | undefined {
  for (const root of getSearchRoots(cwd)) {
    const path = findPathInRoot(root, name);
    if (path !== undefined) return path;
  }
  return undefined;
}

function findPathInRoot(root: string, name: string): string | undefined {
  if (isSymlink(root)) return undefined;
  if (!existsSync(root)) return undefined;

  // Flat file at root level
  const flatPath = join(root, `${name}.md`);
  if (!isSymlink(flatPath) && existsSync(flatPath)) return flatPath;

  // Directory skill at root level
  const dirPath = join(root, name);
  if (!isSymlink(dirPath)) {
    const skillMd = join(dirPath, "SKILL.md");
    if (existsSync(skillMd) && !isSymlink(skillMd)) return dirPath;
  }

  // BFS for nested directory skills
  return findSkillPathBFS(root, name);
}

function findSkillPathBFS(root: string, name: string): string | undefined {
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
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;

      const entryPath = join(current, entry.name);
      if (isSymlink(entryPath)) continue;

      const skillMd = join(entryPath, "SKILL.md");
      const hasSkillMd = existsSync(skillMd) && !isSymlink(skillMd);

      if (hasSkillMd) {
        if (entry.name === name) return entryPath;
        continue;
      }

      queue.push(entryPath);
    }
  }
  return undefined;
}

function collectSkillPaths(root: string, seen: Map<string, string>): void {
  if (isSymlink(root)) return;
  if (!existsSync(root)) return;

  let entries: Dirent[];
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }

  // Flat files at root level
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith(".md")) {
      const entryPath = join(root, entry.name);
      if (isSymlink(entryPath)) continue;
      const skillName = entry.name.slice(0, -3);
      if (!isUnsafeName(skillName) && !seen.has(skillName)) {
        seen.set(skillName, entryPath);
      }
    }
  }

  // BFS for directory skills
  const queue: string[] = [root];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) continue;

    let dirEntries: Dirent[];
    try {
      dirEntries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of dirEntries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;

      const entryPath = join(current, entry.name);
      if (isSymlink(entryPath)) continue;

      const skillMd = join(entryPath, "SKILL.md");
      if (existsSync(skillMd) && !isSymlink(skillMd)) {
        if (!isUnsafeName(entry.name) && !seen.has(entry.name)) {
          seen.set(entry.name, entryPath);
        }
        continue;
      }

      queue.push(entryPath);
    }
  }
}
