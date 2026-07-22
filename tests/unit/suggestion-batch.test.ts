import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import Database from "better-sqlite3";
import {
  applySuggestionWithClip,
  applySuggestionsBatch,
  createClip,
  createSuggestion,
  getClip,
  previewSuggestionWithClip,
  rejectSuggestion,
  rejectSuggestionsBatch,
  restoreRejectedSuggestionsBatch,
  revertAppliedSuggestionsBatch,
  setDatabaseForTesting,
  withTransaction,
} from "../../src/electron/database/index.js";
import type { SuggestionRevertSnapshot } from "../../src/electron/database/repositories/suggestions.js";
import { requireSupportedNode } from "../helpers/prerequisites.js";

const canUseNativeSqlite = (() => {
  if (!requireSupportedNode().ok) {
    return false;
  }
  try {
    const probe = new Database(":memory:");
    probe.close();
    return true;
  } catch {
    return false;
  }
})();
const describeBatch = canUseNativeSqlite ? describe : describe.skip;

type Fixtures = {
  projectId: number;
  assetId: number;
  chapterId: number;
};

describeBatch("suggestion batch transactions", () => {
  let db: Database.Database;

  beforeAll(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    const schemaPath = path.join(process.cwd(), "database", "schema.sql");
    const schema = fs.readFileSync(schemaPath, "utf-8");
    db.exec(schema);
  });

  afterAll(() => {
    if (db) {
      db.close();
    }
  });

  beforeEach(() => {
    setDatabaseForTesting(db);
    db.prepare("DELETE FROM suggestions").run();
    db.prepare("DELETE FROM clips").run();
    db.prepare("DELETE FROM chapter_assets").run();
    db.prepare("DELETE FROM chapters").run();
    db.prepare("DELETE FROM assets").run();
    db.prepare("DELETE FROM projects").run();
  });

  function insertFixtures(): Fixtures {
    const projectId = db
      .prepare("INSERT INTO projects (name) VALUES (?)")
      .run("Batch Project").lastInsertRowid as number;
    const assetId = db
      .prepare(
        "INSERT INTO assets (project_id, file_path, file_type, duration) VALUES (?, ?, ?, ?)"
      )
      .run(projectId, "/test/video.mp4", "video", 3600).lastInsertRowid as number;
    const chapterId = db
      .prepare(
        "INSERT INTO chapters (project_id, title, start_time, end_time) VALUES (?, ?, ?, ?)"
      )
      .run(projectId, "Batch Chapter", 0, 3600).lastInsertRowid as number;
    db.prepare(
      "INSERT INTO chapter_assets (chapter_id, asset_id) VALUES (?, ?)"
    ).run(chapterId, assetId);
    return { projectId, assetId, chapterId };
  }

  async function insertPendingCreateSuggestion(
    chapterId: number,
    inPoint: number,
    outPoint: number,
    displayOrder = 0
  ): Promise<number> {
    const suggestion = await createSuggestion({
      chapter_id: chapterId,
      conversation_id: null,
      chat_message_id: null,
      in_point: inPoint,
      out_point: outPoint,
      description: "batch create",
      reasoning: "batch",
      provider: "gemini",
      action_type: "create_clip",
      target_clip_id: null,
      action_payload_json: JSON.stringify({ create: { trackIndex: 0 } }),
      preview_snapshot_json: null,
      status: "pending",
      display_order: displayOrder,
      clip_id: null,
    });
    return suggestion.id;
  }

  async function insertPendingUpdateSuggestion(
    chapterId: number,
    targetClipId: number,
    newOutPoint: number
  ): Promise<number> {
    const suggestion = await createSuggestion({
      chapter_id: chapterId,
      conversation_id: null,
      chat_message_id: null,
      in_point: 0,
      out_point: newOutPoint,
      description: "batch update",
      reasoning: "batch",
      provider: "gemini",
      action_type: "update_clip",
      target_clip_id: targetClipId,
      action_payload_json: JSON.stringify({ update: { outPoint: newOutPoint } }),
      preview_snapshot_json: null,
      status: "pending",
      display_order: 0,
      clip_id: null,
    });
    return suggestion.id;
  }

  async function insertPendingDeleteSuggestion(
    chapterId: number,
    targetClipId: number
  ): Promise<number> {
    const suggestion = await createSuggestion({
      chapter_id: chapterId,
      conversation_id: null,
      chat_message_id: null,
      in_point: 10,
      out_point: 20,
      description: "batch delete",
      reasoning: "batch",
      provider: "gemini",
      action_type: "delete_clip",
      target_clip_id: targetClipId,
      action_payload_json: JSON.stringify({ delete: true }),
      preview_snapshot_json: null,
      status: "pending",
      display_order: 0,
      clip_id: null,
    });
    return suggestion.id;
  }

  function snapshotClip(clip: { in_point: number; out_point: number; role: string | null; description: string | null; is_essential: boolean }): SuggestionRevertSnapshot {
    return {
      clip: {
        in_point: clip.in_point,
        out_point: clip.out_point,
        role: clip.role as SuggestionRevertSnapshot["clip"]["role"],
        description: clip.description,
        is_essential: clip.is_essential,
      },
    };
  }

  describe("applySuggestionsBatch", () => {
    it("returns an empty success result for no ids", async () => {
      const result = await applySuggestionsBatch([]);
      expect(result).toEqual({ success: true, appliedCount: 0, total: 0, results: [] });
    });

    it("applies every pending create suggestion atomically and keeps clip_id as the applied link", async () => {
      const { chapterId } = insertFixtures();
      const idA = await insertPendingCreateSuggestion(chapterId, 10, 20, 0);
      const idB = await insertPendingCreateSuggestion(chapterId, 30, 40, 1);

      const result = await applySuggestionsBatch([idA, idB]);

      expect(result.success).toBe(true);
      expect(result.appliedCount).toBe(2);
      expect(result.total).toBe(2);
      expect(result.results).toHaveLength(2);
      expect(result.results[0]?.clip?.id).toBeGreaterThan(0);

      const rowA = db.prepare("SELECT status, clip_id FROM suggestions WHERE id = ?").get(idA) as { status: string; clip_id: number };
      const rowB = db.prepare("SELECT status, clip_id FROM suggestions WHERE id = ?").get(idB) as { status: string; clip_id: number };
      expect(rowA.status).toBe("applied");
      expect(rowB.status).toBe("applied");
      expect(rowA.clip_id).toBe(result.results[0]?.clip?.id);
      expect(rowB.clip_id).toBe(result.results[1]?.clip?.id);
      expect(
        db.prepare("SELECT COUNT(*) AS n FROM clips").get() as { n: number }
      ).toEqual({ n: 2 });
      expect(db.inTransaction).toBe(false);
    });

    it("rolls back the entire batch when any item fails", async () => {
      const { projectId, chapterId } = insertFixtures();
      const idA = await insertPendingCreateSuggestion(chapterId, 10, 20, 0);

      // Second suggestion targets a chapter with no linked assets -> apply fails.
      const emptyChapterId = db
        .prepare(
          "INSERT INTO chapters (project_id, title, start_time, end_time) VALUES (?, ?, ?, ?)"
        )
        .run(projectId, "Empty Chapter", 0, 3600).lastInsertRowid as number;
      const idB = await insertPendingCreateSuggestion(emptyChapterId, 30, 40, 1);

      const result = await applySuggestionsBatch([idA, idB]);

      expect(result.success).toBe(false);
      expect(result.appliedCount).toBe(0);
      expect(result.total).toBe(2);
      expect(result.error).toBe("No assets found for this chapter");
      expect(result.results.at(-1)?.suggestionId).toBe(idB);
      expect(result.results.at(-1)?.success).toBe(false);

      // Nothing committed: both suggestions remain pending, no clips exist.
      const rowA = db.prepare("SELECT status, clip_id FROM suggestions WHERE id = ?").get(idA) as { status: string; clip_id: number | null };
      const rowB = db.prepare("SELECT status, clip_id FROM suggestions WHERE id = ?").get(idB) as { status: string; clip_id: number | null };
      expect(rowA.status).toBe("pending");
      expect(rowB.status).toBe("pending");
      expect(rowA.clip_id).toBeNull();
      expect(rowB.clip_id).toBeNull();
      expect((db.prepare("SELECT COUNT(*) AS n FROM clips").get() as { n: number }).n).toBe(0);
      expect(db.inTransaction).toBe(false);
    });

    it("applies a mixed batch of create and update suggestions atomically", async () => {
      const { projectId, assetId, chapterId } = insertFixtures();
      const existingClip = await createClip({
        project_id: projectId,
        asset_id: assetId,
        track_index: 0,
        in_point: 100,
        out_point: 150,
        role: "setup",
        description: "original",
        is_essential: true,
      });

      const updateId = await insertPendingUpdateSuggestion(chapterId, existingClip.id, 130);
      await previewSuggestionWithClip(updateId);

      const createId = await insertPendingCreateSuggestion(chapterId, 200, 250, 1);

      const result = await applySuggestionsBatch([updateId, createId]);

      expect(result.success).toBe(true);
      expect(result.appliedCount).toBe(2);

      const updatedClip = await getClip(existingClip.id);
      expect(updatedClip?.out_point).toBe(130);

      const updateRow = db.prepare("SELECT status, clip_id, preview_snapshot_json FROM suggestions WHERE id = ?").get(updateId) as { status: string; clip_id: number; preview_snapshot_json: string | null };
      expect(updateRow.status).toBe("applied");
      expect(updateRow.clip_id).toBe(existingClip.id);
      expect(updateRow.preview_snapshot_json).toBeNull();
    });

    it("applies delete suggestions without requiring a surviving clip", async () => {
      const { projectId, assetId, chapterId } = insertFixtures();
      const targetClip = await createClip({
        project_id: projectId,
        asset_id: assetId,
        track_index: 0,
        in_point: 10,
        out_point: 20,
        role: null,
        description: "remove me",
        is_essential: false,
      });
      const deleteId = await insertPendingDeleteSuggestion(chapterId, targetClip.id);
      const createId = await insertPendingCreateSuggestion(chapterId, 30, 40, 1);

      const result = await applySuggestionsBatch([deleteId, createId]);

      expect(result.success).toBe(true);
      expect(result.appliedCount).toBe(2);
      expect(result.results[0]).toEqual({
        suggestionId: deleteId,
        success: true,
        removedClipIds: [targetClip.id],
      });
      expect(await getClip(targetClip.id)).toBeNull();
      expect(db.prepare("SELECT status FROM suggestions WHERE id = ?").get(deleteId)).toEqual({ status: "applied" });
    });
  });

  describe("rejectSuggestionsBatch", () => {
    it("rejects every pending suggestion atomically and deletes create preview clips", async () => {
      const { chapterId } = insertFixtures();
      const idA = await insertPendingCreateSuggestion(chapterId, 10, 20, 0);
      const idB = await insertPendingCreateSuggestion(chapterId, 30, 40, 1);
      await previewSuggestionWithClip(idA);
      await previewSuggestionWithClip(idB);

      const clipsBefore = (db.prepare("SELECT COUNT(*) AS n FROM clips").get() as { n: number }).n;
      expect(clipsBefore).toBe(2);

      const result = await rejectSuggestionsBatch([idA, idB]);

      expect(result.success).toBe(true);
      expect(result.appliedCount).toBe(2);

      const rowA = db.prepare("SELECT status, clip_id, preview_snapshot_json FROM suggestions WHERE id = ?").get(idA) as { status: string; clip_id: number | null; preview_snapshot_json: string | null };
      const rowB = db.prepare("SELECT status, clip_id, preview_snapshot_json FROM suggestions WHERE id = ?").get(idB) as { status: string; clip_id: number | null; preview_snapshot_json: string | null };
      expect(rowA.status).toBe("rejected");
      expect(rowB.status).toBe("rejected");
      expect(rowA.clip_id).toBeNull();
      expect(rowB.clip_id).toBeNull();
      expect((db.prepare("SELECT COUNT(*) AS n FROM clips").get() as { n: number }).n).toBe(0);
    });

    it("rolls back when any suggestion is applied (reject only accepts pending)", async () => {
      const { chapterId } = insertFixtures();
      const idA = await insertPendingCreateSuggestion(chapterId, 10, 20, 0);
      const idB = await insertPendingCreateSuggestion(chapterId, 30, 40, 1);
      // Pre-apply idB so the batch rejects fails on it (reject is pending-only).
      await applySuggestionWithClip(idB);

      const result = await rejectSuggestionsBatch([idA, idB]);

      expect(result.success).toBe(false);
      expect(result.error).toBe("Suggestion is not pending");

      // idA must remain pending (rolled back); idB stays applied.
      const rowA = db.prepare("SELECT status FROM suggestions WHERE id = ?").get(idA) as { status: string };
      expect(rowA.status).toBe("pending");
      const rowB = db.prepare("SELECT status FROM suggestions WHERE id = ?").get(idB) as { status: string };
      expect(rowB.status).toBe("applied");
    });

    it("treats already-rejected suggestions as idempotent successes", async () => {
      const { chapterId } = insertFixtures();
      const idA = await insertPendingCreateSuggestion(chapterId, 10, 20, 0);
      const idB = await insertPendingCreateSuggestion(chapterId, 30, 40, 1);
      await rejectSuggestion(idB);

      const result = await rejectSuggestionsBatch([idA, idB]);

      expect(result.success).toBe(true);
      expect(result.appliedCount).toBe(2);
      const rowA = db.prepare("SELECT status FROM suggestions WHERE id = ?").get(idA) as { status: string };
      const rowB = db.prepare("SELECT status FROM suggestions WHERE id = ?").get(idB) as { status: string };
      expect(rowA.status).toBe("rejected");
      expect(rowB.status).toBe("rejected");
    });

    it("returns an empty success result for no ids", async () => {
      const result = await rejectSuggestionsBatch([]);
      expect(result).toEqual({ success: true, appliedCount: 0, total: 0, results: [] });
    });
  });

  describe("restoreRejectedSuggestionsBatch", () => {
    it("restores rejected suggestions back to pending", async () => {
      const { chapterId } = insertFixtures();
      const idA = await insertPendingCreateSuggestion(chapterId, 10, 20, 0);
      const idB = await insertPendingCreateSuggestion(chapterId, 30, 40, 1);
      await rejectSuggestion(idA);
      await rejectSuggestion(idB);

      const result = await restoreRejectedSuggestionsBatch([idA, idB]);

      expect(result.success).toBe(true);
      expect(result.appliedCount).toBe(2);
      const rowA = db.prepare("SELECT status, clip_id FROM suggestions WHERE id = ?").get(idA) as { status: string; clip_id: number | null };
      const rowB = db.prepare("SELECT status, clip_id FROM suggestions WHERE id = ?").get(idB) as { status: string; clip_id: number | null };
      expect(rowA.status).toBe("pending");
      expect(rowB.status).toBe("pending");
      expect(rowA.clip_id).toBeNull();
      expect(rowB.clip_id).toBeNull();
    });

    it("rolls back when any suggestion is not rejected", async () => {
      const { chapterId } = insertFixtures();
      const idA = await insertPendingCreateSuggestion(chapterId, 10, 20, 0);
      const idB = await insertPendingCreateSuggestion(chapterId, 30, 40, 1);
      await rejectSuggestion(idA);
      // idB still pending.

      const result = await restoreRejectedSuggestionsBatch([idA, idB]);

      expect(result.success).toBe(false);
      expect(result.error).toBe("Suggestion is not rejected");
      const rowA = db.prepare("SELECT status FROM suggestions WHERE id = ?").get(idA) as { status: string };
      expect(rowA.status).toBe("rejected");
      const rowB = db.prepare("SELECT status FROM suggestions WHERE id = ?").get(idB) as { status: string };
      expect(rowB.status).toBe("pending");
    });
  });

  describe("revertAppliedSuggestionsBatch", () => {
    it("reverts applied create_clip suggestions by deleting the clip and returning to pending", async () => {
      const { chapterId } = insertFixtures();
      const idA = await insertPendingCreateSuggestion(chapterId, 10, 20, 0);
      const idB = await insertPendingCreateSuggestion(chapterId, 30, 40, 1);
      await applySuggestionWithClip(idA);
      await applySuggestionWithClip(idB);
      const clipIdA = (db.prepare("SELECT clip_id FROM suggestions WHERE id = ?").get(idA) as { clip_id: number }).clip_id;
      const clipIdB = (db.prepare("SELECT clip_id FROM suggestions WHERE id = ?").get(idB) as { clip_id: number }).clip_id;

      const result = await revertAppliedSuggestionsBatch([
        { suggestionId: idA },
        { suggestionId: idB },
      ]);

      expect(result.success).toBe(true);
      expect(result.appliedCount).toBe(2);
      const rowA = db.prepare("SELECT status, clip_id, applied_at, preview_snapshot_json FROM suggestions WHERE id = ?").get(idA) as { status: string; clip_id: number | null; applied_at: string | null; preview_snapshot_json: string | null };
      const rowB = db.prepare("SELECT status, clip_id, applied_at, preview_snapshot_json FROM suggestions WHERE id = ?").get(idB) as { status: string; clip_id: number | null; applied_at: string | null; preview_snapshot_json: string | null };
      expect(rowA.status).toBe("pending");
      expect(rowB.status).toBe("pending");
      expect(rowA.clip_id).toBeNull();
      expect(rowB.clip_id).toBeNull();
      expect(rowA.applied_at).toBeNull();
      expect(rowB.applied_at).toBeNull();
      expect((db.prepare("SELECT COUNT(*) AS n FROM clips").get() as { n: number }).n).toBe(0);
      // The clip rows that existed are gone.
      expect(db.prepare("SELECT 1 FROM clips WHERE id = ?").get(clipIdA)).toBeUndefined();
      expect(db.prepare("SELECT 1 FROM clips WHERE id = ?").get(clipIdB)).toBeUndefined();
    });

    it("reverts applied update_clip suggestions by restoring the caller-supplied beforeSnapshot", async () => {
      const { projectId, assetId, chapterId } = insertFixtures();
      const original = await createClip({
        project_id: projectId,
        asset_id: assetId,
        track_index: 0,
        in_point: 100,
        out_point: 150,
        role: "setup",
        description: "original",
        is_essential: true,
      });
      const before = snapshotClip(original);

      const updateId = await insertPendingUpdateSuggestion(chapterId, original.id, 130);
      await previewSuggestionWithClip(updateId);
      await applySuggestionWithClip(updateId);

      // After apply the preview snapshot is gone and the clip carries the new out_point.
      const applied = await getClip(original.id);
      expect(applied?.out_point).toBe(130);
      const appliedRow = db.prepare("SELECT preview_snapshot_json FROM suggestions WHERE id = ?").get(updateId) as { preview_snapshot_json: string | null };
      expect(appliedRow.preview_snapshot_json).toBeNull();

      const result = await revertAppliedSuggestionsBatch([
        { suggestionId: updateId, beforeSnapshot: before },
      ]);

      expect(result.success).toBe(true);
      expect(result.appliedCount).toBe(1);
      const restored = await getClip(original.id);
      expect(restored?.out_point).toBe(150);
      expect(restored?.description).toBe("original");
      const row = db.prepare("SELECT status, clip_id, applied_at FROM suggestions WHERE id = ?").get(updateId) as { status: string; clip_id: number | null; applied_at: string | null };
      expect(row.status).toBe("pending");
      expect(row.clip_id).toBeNull();
      expect(row.applied_at).toBeNull();
    });

    it("reverts dependent update and delete suggestions in reverse application order", async () => {
      const { projectId, assetId, chapterId } = insertFixtures();
      const original = await createClip({
        project_id: projectId,
        asset_id: assetId,
        track_index: 0,
        in_point: 100,
        out_point: 150,
        role: "setup",
        description: "original",
        is_essential: true,
      });
      const before = snapshotClip(original);
      const updateId = await insertPendingUpdateSuggestion(chapterId, original.id, 130);
      const deleteId = await insertPendingDeleteSuggestion(chapterId, original.id);

      expect((await applySuggestionsBatch([updateId, deleteId])).success).toBe(true);
      expect(await getClip(original.id)).toBeNull();

      const result = await revertAppliedSuggestionsBatch([
        { suggestionId: updateId, beforeSnapshot: before },
        { suggestionId: deleteId },
      ]);

      expect(result.success).toBe(true);
      expect((await getClip(original.id))?.out_point).toBe(150);
      expect(db.prepare("SELECT status, target_clip_id FROM suggestions WHERE id = ?").get(updateId)).toEqual({
        status: "pending",
        target_clip_id: original.id,
      });
      expect(db.prepare("SELECT status, target_clip_id FROM suggestions WHERE id = ?").get(deleteId)).toEqual({
        status: "pending",
        target_clip_id: original.id,
      });
    });

    it("rolls back the entire batch when an update_clip revert lacks beforeSnapshot", async () => {
      const { projectId, assetId, chapterId } = insertFixtures();
      const original = await createClip({
        project_id: projectId,
        asset_id: assetId,
        track_index: 0,
        in_point: 100,
        out_point: 150,
        role: "setup",
        description: "original",
        is_essential: true,
      });
      const before = snapshotClip(original);

      const createId = await insertPendingCreateSuggestion(chapterId, 10, 20, 0);
      await applySuggestionWithClip(createId);

      const updateId = await insertPendingUpdateSuggestion(chapterId, original.id, 130);
      await previewSuggestionWithClip(updateId);
      await applySuggestionWithClip(updateId);

      // update_clip revert without beforeSnapshot must abort the whole batch.
      const result = await revertAppliedSuggestionsBatch([
        { suggestionId: createId },
        { suggestionId: updateId, beforeSnapshot: null },
      ]);

      expect(result.success).toBe(false);
      expect(result.error).toBe("beforeSnapshot is required to revert an applied update_clip suggestion");

      // Nothing committed: create suggestion still applied, update still applied.
      const createRow = db.prepare("SELECT status, clip_id FROM suggestions WHERE id = ?").get(createId) as { status: string; clip_id: number };
      const updateRow = db.prepare("SELECT status, clip_id FROM suggestions WHERE id = ?").get(updateId) as { status: string; clip_id: number };
      expect(createRow.status).toBe("applied");
      expect(updateRow.status).toBe("applied");
      expect(createRow.clip_id).toBeGreaterThan(0);
      expect(updateRow.clip_id).toBe(original.id);
      // Clips unchanged.
      const stillAppliedCreate = await getClip(createRow.clip_id);
      expect(stillAppliedCreate).toBeDefined();
      const stillAppliedUpdate = await getClip(original.id);
      expect(stillAppliedUpdate?.out_point).toBe(130);

      // A correct retry with the snapshot succeeds and undoes both.
      const retry = await revertAppliedSuggestionsBatch([
        { suggestionId: createId },
        { suggestionId: updateId, beforeSnapshot: before },
      ]);
      expect(retry.success).toBe(true);
      expect(retry.appliedCount).toBe(2);
      const restored = await getClip(original.id);
      expect(restored?.out_point).toBe(150);
    });

    it("rolls back when any suggestion is not applied", async () => {
      const { chapterId } = insertFixtures();
      const idA = await insertPendingCreateSuggestion(chapterId, 10, 20, 0);
      const idB = await insertPendingCreateSuggestion(chapterId, 30, 40, 1);
      await applySuggestionWithClip(idA);
      // idB still pending.

      const result = await revertAppliedSuggestionsBatch([
        { suggestionId: idA },
        { suggestionId: idB },
      ]);

      expect(result.success).toBe(false);
      expect(result.error).toBe("Suggestion is not applied");
      const rowA = db.prepare("SELECT status, clip_id FROM suggestions WHERE id = ?").get(idA) as { status: string; clip_id: number };
      expect(rowA.status).toBe("applied");
      expect(rowA.clip_id).toBeGreaterThan(0);
      expect((db.prepare("SELECT COUNT(*) AS n FROM clips").get() as { n: number }).n).toBe(1);
    });

    it("returns an empty success result for no items", async () => {
      const result = await revertAppliedSuggestionsBatch([]);
      expect(result).toEqual({ success: true, appliedCount: 0, total: 0, results: [] });
    });

    it("reports not-found for unknown suggestion ids", async () => {
      const result = await revertAppliedSuggestionsBatch([{ suggestionId: 999999 }]);
      expect(result.success).toBe(false);
      expect(result.error).toBe("Suggestion not found");
    });
  });

  describe("round trips", () => {
    it("reject -> restore -> apply works for create suggestions", async () => {
      const { chapterId } = insertFixtures();
      const id = await insertPendingCreateSuggestion(chapterId, 10, 20, 0);

      const rejected = await rejectSuggestionsBatch([id]);
      expect(rejected.success).toBe(true);
      expect((db.prepare("SELECT status FROM suggestions WHERE id = ?").get(id) as { status: string }).status).toBe("rejected");

      const restored = await restoreRejectedSuggestionsBatch([id]);
      expect(restored.success).toBe(true);
      expect((db.prepare("SELECT status FROM suggestions WHERE id = ?").get(id) as { status: string }).status).toBe("pending");

      const reapplied = await applySuggestionsBatch([id]);
      expect(reapplied.success).toBe(true);
      expect((db.prepare("SELECT status FROM suggestions WHERE id = ?").get(id) as { status: string }).status).toBe("applied");
    });

    it("apply -> revert -> apply again works for create suggestions", async () => {
      const { chapterId } = insertFixtures();
      const id = await insertPendingCreateSuggestion(chapterId, 10, 20, 0);

      const applied = await applySuggestionsBatch([id]);
      expect(applied.success).toBe(true);

      const reverted = await revertAppliedSuggestionsBatch([{ suggestionId: id }]);
      expect(reverted.success).toBe(true);
      expect((db.prepare("SELECT status FROM suggestions WHERE id = ?").get(id) as { status: string }).status).toBe("pending");
      expect((db.prepare("SELECT COUNT(*) AS n FROM clips").get() as { n: number }).n).toBe(0);

      const reapplied = await applySuggestionsBatch([id]);
      expect(reapplied.success).toBe(true);
      expect((db.prepare("SELECT status FROM suggestions WHERE id = ?").get(id) as { status: string }).status).toBe("applied");
    });
  });

  describe("withTransaction composition", () => {
    it("batch operations leave no open transaction on success", async () => {
      const { chapterId } = insertFixtures();
      const id = await insertPendingCreateSuggestion(chapterId, 10, 20, 0);
      await applySuggestionsBatch([id]);
      expect(db.inTransaction).toBe(false);
    });

    it("batch operations leave no open transaction on failure", async () => {
      const { chapterId } = insertFixtures();
      const id = await insertPendingCreateSuggestion(chapterId, 10, 20, 0);
      await applySuggestionsBatch([id, 999999]);
      expect(db.inTransaction).toBe(false);
    });

    it("a batch can join an outer transaction", async () => {
      const { chapterId } = insertFixtures();
      const id = await insertPendingCreateSuggestion(chapterId, 10, 20, 0);

      await withTransaction(async () => {
        const result = await applySuggestionsBatch([id]);
        expect(result.success).toBe(true);
        expect(db.inTransaction).toBe(true);
      });

      expect((db.prepare("SELECT status FROM suggestions WHERE id = ?").get(id) as { status: string }).status).toBe("applied");
      expect(db.inTransaction).toBe(false);
    });

    it("a failing nested batch rolls back its partial writes instead of committing them with the outer transaction", async () => {
      const { chapterId } = insertFixtures();
      const id = await insertPendingCreateSuggestion(chapterId, 10, 20, 0);

      const result = await withTransaction(async () => {
        return await applySuggestionsBatch([id, 999999]);
      });

      expect(result.success).toBe(false);
      expect(db.inTransaction).toBe(false);
      expect((db.prepare("SELECT status FROM suggestions WHERE id = ?").get(id) as { status: string }).status).toBe("pending");
      expect((db.prepare("SELECT COUNT(*) AS count FROM clips").get() as { count: number }).count).toBe(0);
    });
  });
});
