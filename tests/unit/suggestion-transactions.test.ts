import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import Database from "better-sqlite3";
import {
  applySuggestionWithClip,
  cancelSuggestionPreview,
  createSuggestion,
  previewSuggestionWithClip,
  revertAppliedSuggestionsBatch,
  setDatabaseForTesting,
  supersedeSuggestion,
  withTransaction,
} from "../../src/electron/database/index.js";
import { requireSupportedNode } from "../helpers/prerequisites.js";

const describeTx = (() => {
  if (!requireSupportedNode().ok) return describe.skip;
  try {
    const probe = new Database(":memory:");
    probe.close();
    return describe;
  } catch {
    return describe.skip;
  }
})();

describeTx("suggestion transactions (withTransaction)", () => {
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
    // projects cascades to assets/chapters/clips/suggestions/etc.
    db.prepare("DELETE FROM projects").run();
  });

  describe("withTransaction", () => {
    it("commits writes when the wrapped function returns normally", async () => {
      await withTransaction(async () => {
        db.prepare("INSERT INTO projects (name) VALUES (?)").run("committed");
      });

      expect(
        db.prepare("SELECT name FROM projects WHERE name = 'committed'").get()
      ).toBeDefined();
      expect(db.inTransaction).toBe(false);
    });

    it("rolls back writes when the wrapped function throws", async () => {
      db.prepare("INSERT INTO projects (name) VALUES (?)").run("baseline");

      await expect(
        withTransaction(async () => {
          db.prepare("INSERT INTO projects (name) VALUES (?)").run("rolled-back");
          throw new Error("boom");
        })
      ).rejects.toThrow("boom");

      expect(
        db.prepare("SELECT name FROM projects WHERE name = 'rolled-back'").get()
      ).toBeUndefined();
      expect(
        db.prepare("SELECT name FROM projects WHERE name = 'baseline'").get()
      ).toBeDefined();
      expect(db.inTransaction).toBe(false);
    });

    it("nested calls join the outer transaction (no intermediate commit)", async () => {
      await withTransaction(async () => {
        db.prepare("INSERT INTO projects (name) VALUES (?)").run("outer");

        await withTransaction(async () => {
          db.prepare("INSERT INTO projects (name) VALUES (?)").run("inner");
        });

        // Still inside the outer transaction; the inner call must not have committed.
        expect(db.inTransaction).toBe(true);
        expect(
          db.prepare("SELECT name FROM projects WHERE name = 'outer'").get()
        ).toBeDefined();
        expect(
          db.prepare("SELECT name FROM projects WHERE name = 'inner'").get()
        ).toBeDefined();
      });

      // Outer commit makes both writes durable.
      expect(
        db.prepare("SELECT name FROM projects WHERE name = 'outer'").get()
      ).toBeDefined();
      expect(
        db.prepare("SELECT name FROM projects WHERE name = 'inner'").get()
      ).toBeDefined();
      expect(db.inTransaction).toBe(false);
    });

    it("rolls back nested writes when the inner function throws", async () => {
      await expect(
        withTransaction(async () => {
          db.prepare("INSERT INTO projects (name) VALUES (?)").run("outer-2");
          await withTransaction(async () => {
            db.prepare("INSERT INTO projects (name) VALUES (?)").run("inner-2");
            throw new Error("inner-fail");
          });
        })
      ).rejects.toThrow("inner-fail");

      expect(
        db.prepare("SELECT name FROM projects WHERE name = 'outer-2'").get()
      ).toBeUndefined();
      expect(
        db.prepare("SELECT name FROM projects WHERE name = 'inner-2'").get()
      ).toBeUndefined();
      expect(db.inTransaction).toBe(false);
    });
  });

  describe("applySuggestionWithClip transaction commit", () => {
    function insertFixtures(): {
      projectId: number;
      assetId: number;
      chapterId: number;
    } {
      const projectId = db
        .prepare("INSERT INTO projects (name) VALUES (?)")
        .run("Tx Project").lastInsertRowid as number;
      const assetId = db
        .prepare(
          "INSERT INTO assets (project_id, file_path, file_type, duration) VALUES (?, ?, ?, ?)"
        )
        .run(projectId, "/test/video.mp4", "video", 3600).lastInsertRowid as number;
      const chapterId = db
        .prepare(
          "INSERT INTO chapters (project_id, title, start_time, end_time) VALUES (?, ?, ?, ?)"
        )
        .run(projectId, "Tx Chapter", 0, 3600).lastInsertRowid as number;
      db.prepare(
        "INSERT INTO chapter_assets (chapter_id, asset_id) VALUES (?, ?)"
      ).run(chapterId, assetId);
      return { projectId, assetId, chapterId };
    }

    function insertPendingSuggestion(chapterId: number, inPoint: number, outPoint: number): number {
      return db
        .prepare(
          `INSERT INTO suggestions
           (chapter_id, in_point, out_point, description, reasoning, provider, status, display_order)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(chapterId, inPoint, outPoint, "desc", "reason", "gemini", "pending", 0)
        .lastInsertRowid as number;
    }

    it("commits the applied status and created clip on success", async () => {
      const { chapterId } = insertFixtures();
      const suggestionId = insertPendingSuggestion(chapterId, 120, 180);

      const result = await applySuggestionWithClip(suggestionId);

      expect(result.success).toBe(true);
      expect(result.clip).toBeDefined();
      expect(db.inTransaction).toBe(false);

      const row = db
        .prepare("SELECT status, clip_id FROM suggestions WHERE id = ?")
        .get(suggestionId) as { status: string; clip_id: number };
      expect(row.status).toBe("applied");
      expect(row.clip_id).toBe(result.clip?.id);
      expect(
        db.prepare("SELECT id FROM clips WHERE id = ?").get(row.clip_id)
      ).toBeDefined();
    });

    it("commits via createSuggestion + applySuggestionWithClip using the public API", async () => {
      const { chapterId } = insertFixtures();

      const suggestion = await createSuggestion({
        chapter_id: chapterId,
        conversation_id: null,
        chat_message_id: null,
        in_point: 10,
        out_point: 20,
        description: "public api",
        reasoning: "tx",
        provider: "gemini",
        action_type: "create_clip",
        target_clip_id: null,
        action_payload_json: JSON.stringify({ create: { trackIndex: 0 } }),
        preview_snapshot_json: null,
        status: "pending",
        display_order: 0,
        clip_id: null,
      });

      const result = await applySuggestionWithClip(suggestion.id);

      expect(result.success).toBe(true);
      expect(db.inTransaction).toBe(false);
      const row = db
        .prepare("SELECT status FROM suggestions WHERE id = ?")
        .get(suggestion.id) as { status: string };
      expect(row.status).toBe("applied");
    });

    it('previews and cancels a reversible clip deletion', async () => {
      const { projectId, assetId, chapterId } = insertFixtures();
      const clipId = db.prepare(
        `INSERT INTO clips (project_id, asset_id, track_index, in_point, out_point, description, is_essential)
         VALUES (?, ?, 0, 10, 20, 'Original', 1)`
      ).run(projectId, assetId).lastInsertRowid as number;
      const suggestion = await createSuggestion({
        chapter_id: chapterId, conversation_id: null, chat_message_id: null,
        in_point: 10, out_point: 20, description: 'Delete Original', reasoning: 'Pacing',
        provider: 'gemini', action_type: 'delete_clip', target_clip_id: clipId,
        action_payload_json: JSON.stringify({ delete: true }), preview_snapshot_json: null,
        status: 'pending', display_order: 0, clip_id: null,
      });

      expect((await previewSuggestionWithClip(suggestion.id)).success).toBe(true);
      expect(db.prepare('SELECT id FROM clips WHERE id = ?').get(clipId)).toBeUndefined();
      expect(db.prepare('SELECT target_clip_id FROM suggestions WHERE id = ?').get(suggestion.id)).toEqual({ target_clip_id: null });
      expect((await cancelSuggestionPreview(suggestion.id)).success).toBe(true);
      expect(db.prepare('SELECT description FROM clips WHERE id = ?').get(clipId)).toEqual({ description: 'Original' });
      expect(db.prepare('SELECT target_clip_id FROM suggestions WHERE id = ?').get(suggestion.id)).toEqual({ target_clip_id: clipId });
      expect((await previewSuggestionWithClip(suggestion.id)).success).toBe(true);
      expect((await cancelSuggestionPreview(suggestion.id)).success).toBe(true);
    });

    it('relinks a reverted deletion so the pending suggestion can be applied again', async () => {
      const { projectId, assetId, chapterId } = insertFixtures();
      const clipId = db.prepare(
        `INSERT INTO clips (project_id, asset_id, track_index, in_point, out_point, description, is_essential)
         VALUES (?, ?, 0, 10, 20, 'Original', 1)`
      ).run(projectId, assetId).lastInsertRowid as number;
      const suggestion = await createSuggestion({
        chapter_id: chapterId, conversation_id: null, chat_message_id: null,
        in_point: 10, out_point: 20, description: 'Delete Original', reasoning: 'Pacing',
        provider: 'gemini', action_type: 'delete_clip', target_clip_id: clipId,
        action_payload_json: JSON.stringify({ delete: true }), preview_snapshot_json: null,
        status: 'pending', display_order: 0, clip_id: null,
      });

      expect((await applySuggestionWithClip(suggestion.id)).success).toBe(true);
      expect((await revertAppliedSuggestionsBatch([{ suggestionId: suggestion.id }])).success).toBe(true);
      expect(db.prepare('SELECT target_clip_id, status FROM suggestions WHERE id = ?').get(suggestion.id)).toEqual({
        target_clip_id: clipId,
        status: 'pending',
      });
      expect((await applySuggestionWithClip(suggestion.id)).success).toBe(true);
    });

    it('previews, applies, and reverts an atomic clip split', async () => {
      const { projectId, assetId, chapterId } = insertFixtures();
      const clipId = db.prepare(
        `INSERT INTO clips (project_id, asset_id, track_index, in_point, out_point, description, is_essential)
         VALUES (?, ?, 0, 10, 30, 'Original', 1)`
      ).run(projectId, assetId).lastInsertRowid as number;
      const suggestion = await createSuggestion({
        chapter_id: chapterId, conversation_id: null, chat_message_id: null,
        in_point: 20, out_point: 20.01, description: 'Split Original', reasoning: 'Separate beats',
        provider: 'gemini', action_type: 'split_clip', target_clip_id: clipId,
        action_payload_json: JSON.stringify({ split: { splitPoint: 20, leftDescription: 'Setup', rightDescription: 'Payoff' } }),
        preview_snapshot_json: null, status: 'pending', display_order: 0, clip_id: null,
      });

      expect((await previewSuggestionWithClip(suggestion.id)).success).toBe(true);
      expect(db.prepare('SELECT in_point, out_point, description FROM clips ORDER BY in_point').all()).toEqual([
        { in_point: 10, out_point: 20, description: 'Setup' },
        { in_point: 20, out_point: 30, description: 'Payoff' },
      ]);
      expect((await applySuggestionWithClip(suggestion.id)).success).toBe(true);
      expect((await revertAppliedSuggestionsBatch([{ suggestionId: suggestion.id }])).success).toBe(true);
      expect(db.prepare('SELECT id, in_point, out_point, description FROM clips').all()).toEqual([
        { id: clipId, in_point: 10, out_point: 30, description: 'Original' },
      ]);
    });

    it('atomically replaces a clip with any number of kept segments and restores it', async () => {
      const { projectId, assetId, chapterId } = insertFixtures();
      const clipId = db.prepare(
        `INSERT INTO clips (project_id, asset_id, track_index, in_point, out_point, role, description, is_essential)
         VALUES (?, ?, 0, 10, 60, 'setup', 'Original', 1)`
      ).run(projectId, assetId).lastInsertRowid as number;
      const suggestion = await createSuggestion({
        chapter_id: chapterId, conversation_id: null, chat_message_id: null,
        in_point: 10, out_point: 52, description: 'Split Original into 3 segments', reasoning: 'Remove dead air',
        provider: 'gemini', action_type: 'split_clip', target_clip_id: clipId,
        action_payload_json: JSON.stringify({
          split: {
            segments: [
              { inPoint: 10, outPoint: 18, description: 'Setup' },
              { inPoint: 24, outPoint: 31, role: 'escalation', description: 'Escalation' },
              { inPoint: 45, outPoint: 52, role: 'payoff', description: 'Payoff', isEssential: false },
            ],
          },
        }),
        preview_snapshot_json: null, status: 'pending', display_order: 0, clip_id: null,
      });

      expect((await previewSuggestionWithClip(suggestion.id)).success).toBe(true);
      expect(db.prepare(
        'SELECT id, in_point, out_point, role, description, is_essential FROM clips ORDER BY in_point'
      ).all()).toEqual([
        { id: clipId, in_point: 10, out_point: 18, role: 'setup', description: 'Setup', is_essential: 1 },
        { id: expect.any(Number), in_point: 24, out_point: 31, role: 'escalation', description: 'Escalation', is_essential: 1 },
        { id: expect.any(Number), in_point: 45, out_point: 52, role: 'payoff', description: 'Payoff', is_essential: 0 },
      ]);
      const previewRow = db.prepare(
        'SELECT preview_snapshot_json FROM suggestions WHERE id = ?'
      ).get(suggestion.id) as { preview_snapshot_json: string };
      expect(JSON.parse(previewRow.preview_snapshot_json).createdClipIds).toHaveLength(2);

      expect((await cancelSuggestionPreview(suggestion.id)).success).toBe(true);
      expect(db.prepare(
        'SELECT id, in_point, out_point, role, description, is_essential FROM clips'
      ).all()).toEqual([
        { id: clipId, in_point: 10, out_point: 60, role: 'setup', description: 'Original', is_essential: 1 },
      ]);

      expect((await applySuggestionWithClip(suggestion.id)).success).toBe(true);
      expect(db.prepare('SELECT id FROM clips').all()).toHaveLength(3);
      expect((await revertAppliedSuggestionsBatch([{ suggestionId: suggestion.id }])).success).toBe(true);
      expect(db.prepare(
        'SELECT id, in_point, out_point, role, description, is_essential FROM clips'
      ).all()).toEqual([
        { id: clipId, in_point: 10, out_point: 60, role: 'setup', description: 'Original', is_essential: 1 },
      ]);
    });

    it('rolls back every segment when creating a later segment fails', async () => {
      const { projectId, assetId, chapterId } = insertFixtures();
      const clipId = db.prepare(
        `INSERT INTO clips (project_id, asset_id, track_index, in_point, out_point, role, description, is_essential)
         VALUES (?, ?, 0, 10, 60, 'setup', 'Original', 1)`
      ).run(projectId, assetId).lastInsertRowid as number;
      const suggestion = await createSuggestion({
        chapter_id: chapterId, conversation_id: null, chat_message_id: null,
        in_point: 10, out_point: 50, description: 'Invalid split', reasoning: 'Test rollback',
        provider: 'gemini', action_type: 'split_clip', target_clip_id: clipId,
        action_payload_json: JSON.stringify({
          split: {
            segments: [
              { inPoint: 10, outPoint: 20 },
              { inPoint: 30, outPoint: 40 },
              { inPoint: 45, outPoint: 50, role: 'invalid-role' },
            ],
          },
        }),
        preview_snapshot_json: null, status: 'pending', display_order: 0, clip_id: null,
      });

      expect((await previewSuggestionWithClip(suggestion.id)).success).toBe(false);
      expect(db.prepare('SELECT id, in_point, out_point, role, description FROM clips').all()).toEqual([
        { id: clipId, in_point: 10, out_point: 60, role: 'setup', description: 'Original' },
      ]);
      expect(db.prepare(
        'SELECT status, clip_id, preview_snapshot_json FROM suggestions WHERE id = ?'
      ).get(suggestion.id)).toEqual({ status: 'pending', clip_id: null, preview_snapshot_json: null });
    });

    it('links a replacement while retaining the superseded suggestion for audit history', async () => {
      const { projectId, chapterId } = insertFixtures();
      const conversationId = db.prepare(
        `INSERT INTO chat_conversations (project_id, chapter_id, title, thread_id)
         VALUES (?, ?, 'Audit', 'thread-audit')`
      ).run(projectId, chapterId).lastInsertRowid as number;
      const original = await createSuggestion({
        chapter_id: chapterId, conversation_id: conversationId, chat_message_id: null,
        in_point: 10, out_point: 20, description: 'Original', reasoning: null,
        provider: 'gemini', action_type: 'create_clip', target_clip_id: null,
        action_payload_json: null, preview_snapshot_json: null,
        status: 'pending', display_order: 0, clip_id: null,
      });
      const replacement = await createSuggestion({
        chapter_id: chapterId, conversation_id: conversationId, chat_message_id: null,
        in_point: 12, out_point: 18, description: 'Replacement', reasoning: null,
        provider: 'gemini', action_type: 'create_clip', target_clip_id: null,
        action_payload_json: null, preview_snapshot_json: null,
        status: 'pending', display_order: 1, clip_id: null,
        supersedes_suggestion_id: original.id,
      });

      expect(await supersedeSuggestion(original.id, replacement.id, conversationId, chapterId)).toBe(true);
      expect(db.prepare('SELECT status FROM suggestions WHERE id = ?').get(original.id)).toEqual({ status: 'superseded' });
      expect(db.prepare('SELECT supersedes_suggestion_id FROM suggestions WHERE id = ?').get(replacement.id)).toEqual({
        supersedes_suggestion_id: original.id,
      });
    });
  });
});
