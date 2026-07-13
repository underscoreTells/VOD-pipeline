import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

describe("desktop packaging", () => {
  it("keeps the CommonJS preload free of local runtime imports", () => {
    const preloadSource = readFileSync(`${repoRoot}/src/electron/preload.ts`, "utf8");

    expect(preloadSource).not.toMatch(/^import\s+(?!type\b).*from\s+['"]\.\//m);
  });

  it("unpacks better-sqlite3 and keeps package output outside build artifacts", () => {
    const config = JSON.parse(
      readFileSync(`${repoRoot}/electron-builder.json`, "utf8"),
    ) as {
      directories?: { output?: string };
      asarUnpack?: string[];
      afterPack?: string;
    };

    expect(config.directories?.output).not.toBe("dist");
    expect(config.asarUnpack).toContain("node_modules/better-sqlite3/**/*");
    expect(config.afterPack).toBeUndefined();
  });
});
