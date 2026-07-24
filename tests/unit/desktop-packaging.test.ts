import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

describe("desktop packaging", () => {
  it("keeps the CommonJS preload free of local runtime imports", () => {
    const preloadSource = readFileSync(`${repoRoot}/src/electron/preload.ts`, "utf8");

    expect(preloadSource).not.toMatch(/^import\s+(?!type\b).*from\s+['"]\.\//m);
  });

  it("unpacks better-sqlite3 and prepares target-native resources before packaging", () => {
    const config = JSON.parse(
      readFileSync(`${repoRoot}/electron-builder.json`, "utf8"),
    ) as {
      directories?: { output?: string };
      asarUnpack?: string[];
      afterPack?: string;
      beforePack?: string;
      win?: { extraResources?: Array<{ from?: string; filter?: string[] }> };
      mac?: { extraResources?: Array<{ from?: string; filter?: string[] }> };
      linux?: { extraResources?: Array<{ from?: string; filter?: string[] }> };
    };

    expect(config.directories?.output).not.toBe("dist");
    expect(config.asarUnpack).toContain("node_modules/better-sqlite3/**/*");
    expect(config.afterPack).toBeUndefined();
    expect(config.beforePack).toBe("./scripts/prepare-native-binaries.js");
    expect(config.win?.extraResources?.[0]?.from).toBe("binaries/win32/${arch}/");
    expect(config.mac?.extraResources?.[0]?.from).toBe("binaries/darwin/${arch}/");
    expect(config.linux?.extraResources?.[0]?.from).toBe("binaries/linux/${arch}/");
    expect(config.win?.extraResources?.[0]?.filter).toContain("audiowaveform.exe");
    expect(config.mac?.extraResources?.[0]?.filter).toEqual(["ffmpeg", "ffprobe"]);
    expect(config.linux?.extraResources?.[0]?.filter).toEqual(["ffmpeg", "ffprobe"]);
  });

  it("prepares and verifies the exact release target through beforePack", () => {
    const packageJson = JSON.parse(readFileSync(`${repoRoot}/package.json`, "utf8")) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.dist).toBe("pnpm build && electron-builder");
  });
});
