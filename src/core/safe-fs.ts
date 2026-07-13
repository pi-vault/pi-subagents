import { existsSync, lstatSync, readFileSync } from "node:fs";
import { resolve, sep } from "node:path";

/**
 * Returns true if the path is a symlink (via lstatSync).
 * Returns false on any error (ENOENT, EACCES, etc).
 */
export function isSymlink(filePath: string): boolean {
  try {
    return lstatSync(filePath).isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * Reads a file, rejecting symlinks. Returns undefined if unsafe or missing.
 */
export function safeReadFile(filePath: string): string | undefined {
  if (!existsSync(filePath)) return undefined;
  if (isSymlink(filePath)) return undefined;
  try {
    return readFileSync(filePath, "utf-8");
  } catch {
    return undefined;
  }
}

const SAFE_NAME_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

/**
 * Returns true if name is unsafe for path construction.
 * Unsafe means: empty, too long, contains NUL, or fails the safe character set.
 * The regex rejects "." and ".." implicitly (must start with alphanumeric).
 */
export function isUnsafeName(name: string): boolean {
  if (!name || name.length > 128) return true;
  if (name.includes("\x00")) return true;
  return !SAFE_NAME_REGEX.test(name);
}

/**
 * Resolves path segments within root. Returns undefined if result escapes root
 * or if any existing intermediate segment is a symlink.
 */
export function resolveContained(
  root: string,
  ...segments: string[]
): string | undefined {
  for (const seg of segments) {
    if (!seg || seg === "." || seg === "..") return undefined;
    if (seg.startsWith("/") || seg.startsWith("\\")) return undefined;
    if (seg.includes("/") || seg.includes("\\")) return undefined;
    if (seg.includes(":")) return undefined;
    if (seg.includes("\0")) return undefined;
  }

  const normalizedRoot = resolve(root);
  const resolved = resolve(normalizedRoot, ...segments);

  if (
    resolved !== normalizedRoot &&
    !resolved.startsWith(normalizedRoot + sep)
  ) {
    return undefined;
  }

  const relativePart = resolved.slice(normalizedRoot.length + 1);
  if (!relativePart) return resolved;

  const parts = relativePart.split(sep);
  let current = normalizedRoot;
  for (let i = 0; i < parts.length - 1; i++) {
    current = resolve(current, parts[i]);
    if (existsSync(current) && isSymlink(current)) {
      return undefined;
    }
  }

  return resolved;
}
