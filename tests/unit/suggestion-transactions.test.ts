import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import Database from "better-sqlite3";
import {
  applySuggestionWithClip,
  createSuggestion,
  setDatabaseForTesting,
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
  });
});
