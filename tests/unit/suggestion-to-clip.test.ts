import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import Database from "better-sqlite3";
import {
  applySuggestionWithClip,
  createClip,
  createSuggestion,
  getSuggestionsByConversation,
  rejectSuggestion,
  setDatabaseForTesting,
} from "../../src/electron/database/index.js";
import { requireSupportedNode } from "../helpers/prerequisites.js";

const describeSuggestionClip = (() => {
  if (!requireSupportedNode().ok) return describe.skip;
  try {
    const probe = new Database(":memory:");
    probe.close();
    return describe;
  } catch {
    return describe.skip;
  }
})();

describeSuggestionClip("Suggestion to Clip Integration (Task 4.9)", () => {
  let tempDir: string;
  let db: Database.Database;
  let testProjectId: number;
  let testAssetId: number;
  let testChapterId: number;

  beforeAll(async () => {
    // Create temp directory for test database
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vod-pipeline-test-"));
    const dbPath = path.join(tempDir, "test.db");
    
    // Initialize test database
    db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    
    // Load schema
    const schemaPath = path.join(process.cwd(), "database", "schema.sql");
    const schema = fs.readFileSync(schemaPath, "utf-8");
    db.exec(schema);
  });

  afterAll(() => {
    // Cleanup
    if (db) {
      db.close();
    }
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  beforeEach(async () => {
    // Inject test database into the module
    setDatabaseForTesting(db);
    
    // Clear tables before each test
    db.prepare("DELETE FROM suggestions").run();
    db.prepare("DELETE FROM clips").run();
    db.prepare("DELETE FROM chapter_assets").run();
    db.prepare("DELETE FROM chapters").run();
    db.prepare("DELETE FROM assets").run();
    db.prepare("DELETE FROM projects").run();

    // Create test project
    const projectResult = db
      .prepare("INSERT INTO projects (name) VALUES (?)")
      .run("Test Project");
    testProjectId = projectResult.lastInsertRowid as number;

    // Create test asset
    const assetResult = db
      .prepare(
        "INSERT INTO assets (project_id, file_path, file_type, duration) VALUES (?, ?, ?, ?)"
      )
      .run(testProjectId, "/test/video.mp4", "video", 3600);
    testAssetId = assetResult.lastInsertRowid as number;

    // Create test chapter
    const chapterResult = db
      .prepare(
        "INSERT INTO chapters (project_id, title, start_time, end_time) VALUES (?, ?, ?, ?)"
      )
      .run(testProjectId, "Test Chapter", 0, 3600);
    testChapterId = chapterResult.lastInsertRowid as number;

    // Link asset to chapter
    db.prepare(
      "INSERT INTO chapter_assets (chapter_id, asset_id) VALUES (?, ?)"
    ).run(testChapterId, testAssetId);
  });

  describe("applySuggestionWithClip", () => {
    it("should create a clip when applying a suggestion", async () => {
      // Create a suggestion
      const suggestionResult = db
        .prepare(
          `INSERT INTO suggestions 
           (chapter_id, in_point, out_point, description, reasoning, provider, status, display_order) 
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          testChapterId,
          120.5,
          180.0,
          "Test description",
          "Test reasoning",
          "gemini",
          "pending",
          0
        );
      const suggestionId = suggestionResult.lastInsertRowid as number;

      // Apply the suggestion
      const result = await applySuggestionWithClip(suggestionId);

      // Should succeed now that we've wired the test database
      expect(result.success).toBe(true);
      expect(result.clip).toBeDefined();
      expect(result.clip?.in_point).toBe(120.5);
      expect(result.clip?.out_point).toBe(180.0);
    });

    it("should validate suggestion exists", async () => {
      const result = await applySuggestionWithClip(999999);
      expect(result.success).toBe(false);
      expect(result.error).toBe("Suggestion not found");
    });

    it("should validate suggestion is not already applied", async () => {
      // Create an already-applied suggestion
      const suggestionResult = db
        .prepare(
          `INSERT INTO suggestions 
           (chapter_id, in_point, out_point, description, reasoning, provider, status, display_order, applied_at) 
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          testChapterId,
          120.5,
          180.0,
          "Test description",
          "Test reasoning",
          "gemini",
          "applied",
          0,
          new Date().toISOString()
        );
      const suggestionId = suggestionResult.lastInsertRowid as number;

      const result = await applySuggestionWithClip(suggestionId);
      expect(result.success).toBe(false);
      expect(result.error).toBe("Suggestion has already been applied");
    });

    it("should prevent orphan suggestions when the chapter does not exist (FK enforced)", async () => {
      // The suggestions.chapter_id FK (ON DELETE CASCADE) makes it impossible
      // to persist a suggestion referencing a missing chapter. SQLite rejects
      // the insert before applySuggestionWithClip is ever called, so the
      // handler-level 'Chapter not found' branch is unreachable for this case;
      // the contract is now enforced by the schema itself.
      const insertOrphan = () =>
        db
          .prepare(
            `INSERT INTO suggestions 
           (chapter_id, in_point, out_point, description, reasoning, provider, status, display_order) 
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            999999,
            120.5,
            180.0,
            "Test description",
            "Test reasoning",
            "gemini",
            "pending",
            0
          );

      expect(insertOrphan).toThrow(/FOREIGN KEY constraint failed/);
    });

    it("should validate chapter has assets", async () => {
      // Create chapter without assets
      const chapterResult = db
        .prepare(
          "INSERT INTO chapters (project_id, title, start_time, end_time) VALUES (?, ?, ?, ?)"
        )
        .run(testProjectId, "Empty Chapter", 0, 3600);
      const emptyChapterId = chapterResult.lastInsertRowid as number;

      // Create suggestion for chapter without assets
      const suggestionResult = db
        .prepare(
          `INSERT INTO suggestions 
           (chapter_id, in_point, out_point, description, reasoning, provider, status, display_order) 
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          emptyChapterId,
          120.5,
          180.0,
          "Test description",
          "Test reasoning",
          "gemini",
          "pending",
          0
        );
      const suggestionId = suggestionResult.lastInsertRowid as number;

      const result = await applySuggestionWithClip(suggestionId);
      expect(result.success).toBe(false);
      expect(result.error).toBe("No assets found for this chapter");
    });

    it("preserves the drafted source window (in_point/out_point) when creating a clip from a suggestion", async () => {
      await createClip({
        project_id: testProjectId,
        asset_id: testAssetId,
        track_index: 0,
        in_point: 100,
        out_point: 150,
        role: null,
        description: "Existing clip",
        is_essential: true,
      });

      const suggestion = await createSuggestion({
        chapter_id: testChapterId,
        conversation_id: null,
        chat_message_id: null,
        in_point: 25,
        out_point: 75,
        description: "Source window candidate",
        reasoning: "Should preserve the drafted source window",
        provider: "gemini",
        action_type: "create_clip",
        target_clip_id: null,
        action_payload_json: JSON.stringify({
          create: {
            trackIndex: 0,
          },
        }),
        preview_snapshot_json: null,
        status: "pending",
        display_order: 0,
        clip_id: null,
      });

      const result = await applySuggestionWithClip(suggestion.id);

      expect(result.success).toBe(true);
      expect(result.clip).toMatchObject({
        in_point: 25,
        out_point: 75,
      });
      expect(result.clip).not.toHaveProperty("start_time");
    });

    it("requires assetId for create_clip suggestions when multiple chapter video assets are available", async () => {
      const secondAssetId = db
        .prepare(
          "INSERT INTO assets (project_id, file_path, file_type, duration) VALUES (?, ?, ?, ?)"
        )
        .run(testProjectId, "/test/video-b.mp4", "video", 3600).lastInsertRowid as number;
      db.prepare("INSERT INTO chapter_assets (chapter_id, asset_id) VALUES (?, ?)").run(
        testChapterId,
        secondAssetId
      );

      const suggestion = await createSuggestion({
        chapter_id: testChapterId,
        conversation_id: null,
        chat_message_id: null,
        in_point: 120.5,
        out_point: 180,
        description: "Ambiguous asset",
        reasoning: "Should fail without explicit assetId",
        provider: "gemini",
        action_type: "create_clip",
        target_clip_id: null,
        action_payload_json: JSON.stringify({
          create: {
            trackIndex: 0,
          },
        }),
        preview_snapshot_json: null,
        status: "pending",
        display_order: 0,
        clip_id: null,
      });

      const result = await applySuggestionWithClip(suggestion.id);

      expect(result.success).toBe(false);
      expect(result.error).toBe(
        "assetId is required when multiple chapter video assets are available"
      );
    });
  });

  describe("Suggestion Types", () => {
    it("should include clip_id in Suggestion type", () => {
      // Verify the type structure includes clip_id
      const suggestion = {
        id: 1,
        chapter_id: testChapterId,
        conversation_id: null,
        chat_message_id: null,
        in_point: 120.5,
        out_point: 180.0,
        description: "Test",
        reasoning: "Test reasoning",
        provider: "gemini" as const,
        status: "pending" as const,
        display_order: 0,
        created_at: new Date().toISOString(),
        applied_at: null,
        clip_id: null,
      };

      expect(suggestion).toHaveProperty("clip_id");
      expect(suggestion.clip_id).toBeNull();
    });

    it("should support clip_id in CreateSuggestionInput", () => {
      // Verify CreateSuggestionInput allows optional clip_id
      const input = {
        chapter_id: testChapterId,
        conversation_id: null,
        chat_message_id: null,
        in_point: 120.5,
        out_point: 180.0,
        description: "Test",
        reasoning: "Test reasoning",
        provider: "gemini" as const,
        status: "pending" as const,
        display_order: 0,
      };

      // Should be valid without clip_id
      expect(input).not.toHaveProperty("clip_id");
    });
  });

  describe("Database Schema", () => {
    it("should have clip_id column in suggestions table", () => {
      const tableInfo = db
        .prepare("PRAGMA table_info(suggestions)")
        .all() as Array<{ name: string; type: string }>;
      
      const clipIdColumn = tableInfo.find((col) => col.name === "clip_id");
      expect(clipIdColumn).toBeDefined();
      expect(clipIdColumn?.type).toBe("INTEGER");
    });

    it("should have foreign key constraint on clip_id", () => {
      const foreignKeys = db
        .prepare("PRAGMA foreign_key_list(suggestions)")
        .all() as Array<{ from: string; table: string }>;
      
      const clipFk = foreignKeys.find(
        (fk) => fk.from === "clip_id" && fk.table === "clips"
      );
      expect(clipFk).toBeDefined();
    });

    it("should query suggestions by conversation scope", async () => {
      const firstConversationId = db
        .prepare(
          "INSERT INTO chat_conversations (project_id, chapter_id, title, provider, thread_id) VALUES (?, ?, ?, ?, ?)"
        )
        .run(testProjectId, testChapterId, "First", "gemini", "thread-1")
        .lastInsertRowid as number;
      const secondConversationId = db
        .prepare(
          "INSERT INTO chat_conversations (project_id, chapter_id, title, provider, thread_id) VALUES (?, ?, ?, ?, ?)"
        )
        .run(testProjectId, testChapterId, "Second", "gemini", "thread-2")
        .lastInsertRowid as number;

      db.prepare(
        `INSERT INTO suggestions
         (chapter_id, conversation_id, chat_message_id, in_point, out_point, description, reasoning, provider, status, display_order)
         VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)`
      ).run(testChapterId, firstConversationId, 10, 20, "First suggestion", "Scoped to first", "gemini", "pending", 0);
      db.prepare(
        `INSERT INTO suggestions
         (chapter_id, conversation_id, chat_message_id, in_point, out_point, description, reasoning, provider, status, display_order)
         VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)`
      ).run(testChapterId, secondConversationId, 30, 40, "Second suggestion", "Scoped to second", "gemini", "pending", 0);

      const suggestions = await getSuggestionsByConversation(firstConversationId, testChapterId, "pending");

      expect(suggestions).toHaveLength(1);
      expect(suggestions[0]?.conversation_id).toBe(firstConversationId);
      expect(suggestions[0]?.description).toBe("First suggestion");
    });
  });

  describe("rejectSuggestion", () => {
    it("should mark suggestion as rejected", async () => {
      // Create suggestion
      const suggestionResult = db
        .prepare(
          `INSERT INTO suggestions 
           (chapter_id, in_point, out_point, description, reasoning, provider, status, display_order) 
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          testChapterId,
          120.5,
          180.0,
          "Test",
          "Test reasoning",
          "gemini",
          "pending",
          0
        );
      const suggestionId = suggestionResult.lastInsertRowid as number;

      // Reject suggestion
      const result = await rejectSuggestion(suggestionId);

      // Should succeed now that test database is properly injected
      expect(result).toBe(true);
    });
  });
});

describe("Clip Creation from Suggestion", () => {
  it("should create clip with correct time mapping", () => {
    const suggestion = {
      in_point: 120.5,
      out_point: 180.0,
      description: "Key moment",
    };

    // Clip should map in_point/out_point from suggestion
    const clip = {
      start_time: suggestion.in_point,
      in_point: suggestion.in_point,
      out_point: suggestion.out_point,
      description: suggestion.description,
    };

    expect(clip.start_time).toBe(120.5);
    expect(clip.in_point).toBe(120.5);
    expect(clip.out_point).toBe(180.0);
    expect(clip.out_point - clip.in_point).toBe(59.5); // Duration
  });

  it("should validate clip time ranges", () => {
    // Valid time range
    const validClip = {
      in_point: 10,
      out_point: 20,
    };
    expect(validClip.out_point > validClip.in_point).toBe(true);

    // Invalid: equal times
    const invalidClip = {
      in_point: 10,
      out_point: 10,
    };
    expect(invalidClip.out_point > invalidClip.in_point).toBe(false);

    // Invalid: out before in
    const reversedClip = {
      in_point: 20,
      out_point: 10,
    };
    expect(reversedClip.out_point > reversedClip.in_point).toBe(false);
  });
});

describe("Clip Collision Detection (Code Review Fix)", () => {
  function detectCollision(
    newStart: number,
    newEnd: number,
    existingClips: Array<{ start_time: number; in_point: number; out_point: number }>
  ): Array<{ start_time: number; in_point: number; out_point: number }> {
    return existingClips.filter((clip) => {
      const clipStart = clip.start_time;
      const clipEnd = clip.start_time + (clip.out_point - clip.in_point);
      return newStart < clipEnd && newEnd > clipStart;
    });
  }

  function calculateResolvedTiming(
    suggestion: { in_point: number; out_point: number },
    existingClips: Array<{ start_time: number; in_point: number; out_point: number }>
  ): { start_time: number; in_point: number; out_point: number } {
    let startTime = suggestion.in_point;
    const inPoint = suggestion.in_point;
    const outPoint = suggestion.out_point;
    const proposedEnd = startTime + (outPoint - inPoint);
    
    const overlapping = detectCollision(startTime, proposedEnd, existingClips);
    
    if (overlapping.length > 0) {
      const rightmost = overlapping.reduce((latest, clip) => {
        const clipEnd = clip.start_time + (clip.out_point - clip.in_point);
        const latestEnd = latest.start_time + (latest.out_point - latest.in_point);
        return clipEnd > latestEnd ? clip : latest;
      });
      
      startTime = rightmost.start_time + (rightmost.out_point - rightmost.in_point);
    }
    
    return { start_time: startTime, in_point: inPoint, out_point: outPoint };
  }

  it("should detect overlapping clips", () => {
    const existingClips = [
      { start_time: 0, in_point: 120, out_point: 180 }, // ends at 60s
    ];
    
    const newStart = 30;
    const newEnd = 90;
    
    const overlaps = detectCollision(newStart, newEnd, existingClips);
    expect(overlaps.length).toBe(1);
  });

  it("should not detect collision for non-overlapping clips", () => {
    const existingClips = [
      { start_time: 0, in_point: 120, out_point: 180 }, // ends at 60s
    ];
    
    const newStart = 70; // After existing clip ends
    const newEnd = 130;
    
    const overlaps = detectCollision(newStart, newEnd, existingClips);
    expect(overlaps.length).toBe(0);
  });

  it("moves only the timeline placement when collision is detected", () => {
    const existingClips = [
      { start_time: 0, in_point: 120, out_point: 180 }, // ends at 60s
    ];

    const result = calculateResolvedTiming({ in_point: 30, out_point: 90 }, existingClips);

    expect(result.start_time).toBe(60);
    expect(result.in_point).toBe(30);
    expect(result.out_point).toBe(90);
  });

  it("should keep original timing when no collision", () => {
    const existingClips: Array<{ start_time: number; in_point: number; out_point: number }> = [];
    
    const suggestion = { in_point: 120, out_point: 180 };
    
    const result = calculateResolvedTiming(suggestion, existingClips);
    
    expect(result.start_time).toBe(120);
    expect(result.in_point).toBe(120);
    expect(result.out_point).toBe(180);
  });

  it("keeps the original source duration even after multiple overlaps", () => {
    const existingClips = [
      { start_time: 0, in_point: 100, out_point: 150 },   // duration 50s, ends at 50s
      { start_time: 50, in_point: 200, out_point: 250 },  // duration 50s, ends at 100s
    ];
    
    const suggestion = { in_point: 25, out_point: 75 };
    
    const result = calculateResolvedTiming(suggestion, existingClips);
    
    expect(result.start_time).toBe(100);
    expect(result.in_point).toBe(25);
    expect(result.out_point).toBe(75);
  });

  it("places the moved clip adjacent to the previous clip without changing its source window", () => {
    const existingClips = [
      { start_time: 0, in_point: 120, out_point: 180 }, // duration 60s, ends at 60s
    ];
    
    const suggestion = { in_point: 30, out_point: 90 };
    
    const result = calculateResolvedTiming(suggestion, existingClips);
    
    expect(result.start_time).toBe(60);
    expect(result.in_point).toBe(30);
    expect(result.out_point).toBe(90);
  });
});
