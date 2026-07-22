import { beforeEach, describe, expect, it, vi } from "vitest";

const databaseMocks = vi.hoisted(() => ({
  getAssetsByProject: vi.fn(),
  getAssetsForChapter: vi.fn(),
  getChapter: vi.fn(),
  getChapterProxyByChapterAsset: vi.fn(),
  getClipsByProject: vi.fn(),
  getTranscriptsByChapter: vi.fn(),
}));

const proxyMocks = vi.hoisted(() => ({
  ensureChapterProxyReady: vi.fn(),
  getReusableChapterProxy: vi.fn(),
  recoverChapterProxyIfCurrent: vi.fn(),
}));

vi.mock("../../src/electron/database/index.js", () => databaseMocks);
vi.mock("../../src/electron/ipc/support/chapter-proxies.js", () => proxyMocks);

describe("agent chat context", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    databaseMocks.getAssetsByProject.mockResolvedValue([
      { id: 11, file_type: "video" },
      { id: 22, file_type: "video" },
    ]);
    databaseMocks.getAssetsForChapter.mockResolvedValue([11, 22]);
    databaseMocks.getChapter.mockResolvedValue({
      id: 2,
      project_id: 1,
      title: "Chapter",
      start_time: 0,
      end_time: 30,
    });
    databaseMocks.getClipsByProject.mockResolvedValue([
      {
        id: 101, project_id: 1, asset_id: 11, track_index: 0,
        in_point: 0, out_point: 10, role: null, description: "Primary", is_essential: true,
      },
      {
        id: 202, project_id: 1, asset_id: 22, track_index: 1,
        in_point: 10, out_point: 15, role: null, description: "Secondary", is_essential: true,
      },
      {
        id: 303, project_id: 1, asset_id: 11, track_index: 0,
        in_point: 20, out_point: 25, role: null, description: "Primary follow-up", is_essential: true,
      },
    ]);
    databaseMocks.getTranscriptsByChapter.mockResolvedValue([
      { start_time: 1, end_time: 4, text: "Primary source dialogue" },
    ]);
    databaseMocks.getChapterProxyByChapterAsset.mockResolvedValue(null);
    proxyMocks.recoverChapterProxyIfCurrent.mockResolvedValue(null);
    proxyMocks.getReusableChapterProxy.mockResolvedValue(null);
  });

  it("only attaches transcript excerpts to clips from the transcribed source asset", async () => {
    const { buildAgentChatContext } = await import(
      "../../src/electron/ipc/support/agent-context.js"
    );

    const context = await buildAgentChatContext(1, 2);

    expect(context.chapterClips).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 101, transcriptExcerpt: "Primary source dialogue" }),
      expect.objectContaining({ id: 202, transcriptExcerpt: "" }),
    ]));
  });

  it("scopes clip adjacency to each source asset", async () => {
    const { buildAgentChatContext } = await import(
      "../../src/electron/ipc/support/agent-context.js"
    );

    const context = await buildAgentChatContext(1, 2);

    expect(context.chapterClips).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 101,
        previousClipId: null,
        nextClipId: 303,
        omittedAfterDuration: 10,
      }),
      expect.objectContaining({
        id: 202,
        previousClipId: null,
        nextClipId: null,
      }),
      expect.objectContaining({
        id: 303,
        previousClipId: 101,
        nextClipId: null,
        omittedBeforeDuration: 10,
      }),
    ]));
  });
});
