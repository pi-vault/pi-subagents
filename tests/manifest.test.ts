import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

describe("package manifest", () => {
  test("exposes the extension and expected package files/scripts", () => {
    const pkg = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as {
      files: string[];
      pi: { extensions: string[] };
      scripts: Record<string, string>;
      keywords: string[];
      peerDependencies: Record<string, string>;
      engines: Record<string, string>;
    };

    expect(pkg.pi.extensions).toEqual(["./src/index.ts"]);
    expect(pkg.files).toEqual(
      expect.arrayContaining(["src", "agents", "README.md"]),
    );
    expect(pkg.scripts).toEqual(
      expect.objectContaining({
        check: expect.any(String),
        lint: expect.any(String),
        test: expect.any(String),
        typecheck: expect.any(String),
      }),
    );
    expect(pkg.keywords).toContain("pi-package");
    expect(pkg.peerDependencies["@earendil-works/pi-coding-agent"]).toBe("*");
    expect(pkg.engines.node).toBe(">=22.19.0");
  });
});
