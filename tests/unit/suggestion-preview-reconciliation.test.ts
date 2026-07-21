import { describe, it, expect, beforeAll, afterEach, beforeEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import Database from "better-sqlite3";
import {
  getSchemaVersion,
  reconcilePendingSuggestionPreviews,
  setDatabaseForTesting,
  setSchemaVersion,
} from "../../src/electron/database/index.js";
import type { SuggestionPreviewReconciliationStats } from "../../src/electron/database/migrations.js";
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
const describeMigration = canUseNativeSqlite ? describe : describe.skip;

interface ClipRow {
  id: number;
  project_id: number;
  asset_id: number;
  track_index: number;
  in_point: number;
  out_point: number;
  role: string | null;
  description: string | null;
  is_essential: number;
  created_at: string;
}

type Fixtures = {
  projectId: number;
  assetId: number;
  chapterId: number;
};

function previewSnapshotJson(clip: ClipRow): string {
  return JSON.stringify({
    clip: {
      id: clip.id,
      in_point: clip.in_point,
      out_point: clip.out_point,
      role: clip.role,
      description: clip.description,
      is_essential: Boolean(clip.is_essential),
    },
  });
}

describeMigration("schema-version-3 pending preview reconciliation", () => {
  let db: Database.Database;
  let schema: string;

  beforeAll(() => {
    schema = fs.readFileSync(path.join(process.cwd(), "database", "schema.sql"), "utf-8");
  });

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    db.exec(schema);
    setDatabaseForTesting(db);
  });

  afterEach(closeDb);

  function closeDb() {
    if (db?.open) {
      db.close();
    }
    setDatabaseForTesting(null);
  }

  function insertFixtures(): Fixtures {
    const projectId = db
      .prepare("INSERT INTO projects (name) VALUES (?)")
      .run("Recon Project").lastInsertRowid as number;
    const assetId = db
      .prepare(
        "INSERT INTO assets (project_id, file_path, file_type, duration) VALUES (?, ?, ?, ?)"
      )
      .run(projectId, "/test/video.mp4", "video", 3600).lastInsertRowid as number;
    const chapterId = db
      .prepare(
        "INSERT INTO chapters (project_id, title, start_time, end_time) VALUES (?, ?, ?, ?)"
      )
      .run(projectId, "Recon Chapter", 0, 3600).lastInsertRowid as number;
    db.prepare(
      "INSERT INTO chapter_assets (chapter_id, asset_id) VALUES (?, ?)"
    ).run(chapterId, assetId);
    return { projectId, assetId, chapterId };
  }

  function insertClip(
    fixtures: Fixtures,
    overrides: Partial<ClipRow> & { in_point: number; out_point: number }
  ): ClipRow {
    const id = db
      .prepare(
        `INSERT INTO clips (project_id, asset_id, track_index, in_point, out_point, role, description, is_essential, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        fixtures.projectId,
        overrides.asset_id ?? fixtures.assetId,
        overrides.track_index ?? 0,
        overrides.in_point,
        overrides.out_point,
        overrides.role ?? null,
        overrides.description ?? "preview",
        overrides.is_essential ?? 1,
        overrides.created_at ?? "2026-04-24T00:00:00.000Z"
      )
      .lastInsertRowid as number;
    return db.prepare(
      "SELECT id, project_id, asset_id, track_index, in_point, out_point, role, description, is_essential, created_at FROM clips WHERE id = ?"
    ).get(id) as ClipRow;
  }

  function insertCreateSuggestion(
    chapterId: number,
    clipId: number | null,
    overrides: { in_point?: number; out_point?: number; action_payload_json?: string | null; status?: string } = {}
  ): number {
    return db
      .prepare(
        `INSERT INTO suggestions
         (chapter_id, in_point, out_point, description, reasoning, provider, action_type, target_clip_id, action_payload_json, preview_snapshot_json, status, display_order, clip_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        chapterId,
        overrides.in_point ?? 120,
        overrides.out_point ?? 180,
        "preview create",
        "reason",
        "gemini",
        "create_clip",
        null,
        overrides.action_payload_json ?? JSON.stringify({ create: { trackIndex: 0 } }),
        null,
        overrides.status ?? "pending",
        0,
        clipId
      )
      .lastInsertRowid as number;
  }

  function insertUpdateSuggestion(
    chapterId: number,
    targetClipId: number,
    snapshotJson: string | null,
    overrides: { action_payload_json?: string | null; in_point?: number; out_point?: number; status?: string; clip_id?: number | null } = {}
  ): number {
    return db
      .prepare(
        `INSERT INTO suggestions
         (chapter_id, in_point, out_point, description, reasoning, provider, action_type, target_clip_id, action_payload_json, preview_snapshot_json, status, display_order, clip_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        chapterId,
        overrides.in_point ?? 0,
        overrides.out_point ?? 140,
        "preview update",
        "reason",
        "gemini",
        "update_clip",
        targetClipId,
        overrides.action_payload_json ?? JSON.stringify({ update: { outPoint: 140 } }),
        snapshotJson,
        overrides.status ?? "pending",
        0,
        overrides.clip_id ?? targetClipId
      )
      .lastInsertRowid as number;
  }

  function getSuggestionRow(id: number) {
    return db.prepare(
      "SELECT status, clip_id, preview_snapshot_json FROM suggestions WHERE id = ?"
    ).get(id) as { status: string; clip_id: number | null; preview_snapshot_json: string | null };
  }

  it("skips when user_version is already >= 3", async () => {
    await setSchemaVersion(3, db);
    const stats = reconcilePendingSuggestionPreviews(db);
    expect(stats.skipped).toBe(true);
    expect(stats.createClipsDeleted).toBe(0);
  });

  it("deletes an exact untouched create preview clip and unlinks the suggestion", () => {
    const fixtures = insertFixtures();
    // Build a clip that exactly matches what previewSuggestionWithClip would create
    // for a create_clip suggestion with in/out 120/180 and default payload.
    const clip = insertClip(fixtures, {
      in_point: 120,
      out_point: 180,
      description: "preview create",
      role: null,
      is_essential: 1,
    });
    const suggestionId = insertCreateSuggestion(fixtures.chapterId, clip.id);

    const stats = reconcilePendingSuggestionPreviews(db);

    expect(stats.createClipsDeleted).toBe(1);
    expect(stats.createClipsPreserved).toBe(0);
    expect(db.prepare("SELECT 1 FROM clips WHERE id = ?").get(clip.id)).toBeUndefined();
    const row = getSuggestionRow(suggestionId);
    expect(row.status).toBe("pending");
    expect(row.clip_id).toBeNull();
    expect(row.preview_snapshot_json).toBeNull();
  });

  it("preserves and unlinks a manually diverged create preview clip", () => {
    const fixtures = insertFixtures();
    const clip = insertClip(fixtures, {
      in_point: 120,
      out_point: 180,
      description: "edited by user", // diverges from suggestion.description "preview create"
      role: "payoff",                  // diverges from default null role
      is_essential: 1,
    });
    const suggestionId = insertCreateSuggestion(fixtures.chapterId, clip.id);

    const stats = reconcilePendingSuggestionPreviews(db);

    expect(stats.createClipsPreserved).toBe(1);
    expect(stats.createClipsDeleted).toBe(0);
    expect(db.prepare("SELECT 1 FROM clips WHERE id = ?").get(clip.id)).toBeDefined();
    const row = getSuggestionRow(suggestionId);
    expect(row.status).toBe("pending");
    expect(row.clip_id).toBeNull();
  });

  it("restores an exact untouched update preview from its snapshot", () => {
    const fixtures = insertFixtures();
    // Pre-preview clip state (the snapshot).
    const original = insertClip(fixtures, {
      in_point: 100,
      out_point: 200,
      description: "original",
      role: "setup",
      is_essential: 1,
    });
    // Live clip carries the previewed edit (out_point moved to 140).
    const live = insertClip(fixtures, {
      in_point: 100,
      out_point: 140,
      description: "original",
      role: "setup",
      is_essential: 1,
    });
    // The suggestion targets the live clip and stores the original as snapshot.
    // Use the live clip id for both the target and the snapshot id (the snapshot
    // id field is informational only; the migration restores onto target_clip_id).
    const snapshot = {
      clip: {
        id: live.id,
        in_point: original.in_point,
        out_point: original.out_point,
        role: original.role,
        description: original.description,
        is_essential: Boolean(original.is_essential),
      },
    };
    const suggestionId = insertUpdateSuggestion(
      fixtures.chapterId,
      live.id,
      JSON.stringify(snapshot),
      { in_point: 0, out_point: 140 }
    );

    const stats = reconcilePendingSuggestionPreviews(db);

    expect(stats.updateSnapshotsRestored).toBe(1);
    expect(stats.updateClipsPreserved).toBe(0);
    const restored = db.prepare(
      "SELECT in_point, out_point, role, description FROM clips WHERE id = ?"
    ).get(live.id) as { in_point: number; out_point: number; role: string | null; description: string | null };
    expect(restored.in_point).toBe(100);
    expect(restored.out_point).toBe(200);
    expect(restored.role).toBe("setup");
    expect(restored.description).toBe("original");
    const row = getSuggestionRow(suggestionId);
    expect(row.status).toBe("pending");
    expect(row.clip_id).toBeNull();
    expect(row.preview_snapshot_json).toBeNull();
  });

  it("preserves and unlinks a manually diverged update preview clip", () => {
    const fixtures = insertFixtures();
    const original = insertClip(fixtures, {
      in_point: 100,
      out_point: 200,
      description: "original",
      role: "setup",
      is_essential: 1,
    });
    // The live clip has been manually edited after the preview: description changed.
    const live = insertClip(fixtures, {
      in_point: 100,
      out_point: 140,
      description: "user edited",
      role: "setup",
      is_essential: 1,
    });
    const snapshot = {
      clip: {
        id: live.id,
        in_point: original.in_point,
        out_point: original.out_point,
        role: original.role,
        description: original.description,
        is_essential: Boolean(original.is_essential),
      },
    };
    const suggestionId = insertUpdateSuggestion(
      fixtures.chapterId,
      live.id,
      JSON.stringify(snapshot),
      { in_point: 0, out_point: 140 }
    );

    const stats = reconcilePendingSuggestionPreviews(db);

    expect(stats.updateClipsPreserved).toBe(1);
    expect(stats.updateSnapshotsRestored).toBe(0);
    // The clip keeps the user's diverged state.
    const preserved = db.prepare(
      "SELECT in_point, out_point, description FROM clips WHERE id = ?"
    ).get(live.id) as { in_point: number; out_point: number; description: string | null };
    expect(preserved.out_point).toBe(140);
    expect(preserved.description).toBe("user edited");
    const row = getSuggestionRow(suggestionId);
    expect(row.status).toBe("pending");
    expect(row.clip_id).toBeNull();
    expect(row.preview_snapshot_json).toBeNull();
  });

  it("unlinks dangling create preview references without deleting anything", () => {
    const fixtures = insertFixtures();
    // Create a real clip, link it to a suggestion, then delete the clip with FK
    // off so the suggestion.clip_id becomes a dangling reference.
    const clip = insertClip(fixtures, { in_point: 120, out_point: 180, description: "preview create", role: null });
    const suggestionId = insertCreateSuggestion(fixtures.chapterId, clip.id);
    db.pragma("foreign_keys = OFF");
    db.prepare("DELETE FROM clips WHERE id = ?").run(clip.id);
    db.pragma("foreign_keys = ON");

    const stats = reconcilePendingSuggestionPreviews(db);

    expect(stats.danglingUnlinked).toBe(1);
    expect((db.prepare("SELECT COUNT(*) AS n FROM clips").get() as { n: number }).n).toBe(0);
    const row = getSuggestionRow(suggestionId);
    expect(row.clip_id).toBeNull();
  });

  it("unlinks dangling update preview references without touching clips", () => {
    const fixtures = insertFixtures();
    const clip = insertClip(fixtures, { in_point: 100, out_point: 200, description: "orig", role: "setup" });
    const suggestionId = insertUpdateSuggestion(
      fixtures.chapterId,
      clip.id,
      previewSnapshotJson(clip)
    );
    db.pragma("foreign_keys = OFF");
    db.prepare("DELETE FROM clips WHERE id = ?").run(clip.id);
    db.pragma("foreign_keys = ON");

    const stats = reconcilePendingSuggestionPreviews(db);

    expect(stats.danglingUnlinked).toBe(1);
    const row = getSuggestionRow(suggestionId);
    expect(row.clip_id).toBeNull();
    expect(row.preview_snapshot_json).toBeNull();
  });

  it("leaves applied suggestions and their committed clips untouched", async () => {
    const fixtures = insertFixtures();
    const clip = insertClip(fixtures, { in_point: 120, out_point: 180 });
    const suggestionId = insertCreateSuggestion(fixtures.chapterId, clip.id, { status: "applied" });
    db.prepare("UPDATE suggestions SET applied_at = ? WHERE id = ?").run("2026-04-24T00:00:00.000Z", suggestionId);

    const stats = reconcilePendingSuggestionPreviews(db);

    expect(stats.createClipsDeleted).toBe(0);
    expect(stats.createClipsPreserved).toBe(0);
    expect(stats.danglingUnlinked).toBe(0);
    expect(db.prepare("SELECT 1 FROM clips WHERE id = ?").get(clip.id)).toBeDefined();
    const row = getSuggestionRow(suggestionId);
    expect(row.status).toBe("applied");
    expect(row.clip_id).toBe(clip.id);
  });

  it("is idempotent: a second run reconcils nothing", () => {
    const fixtures = insertFixtures();
    const clip = insertClip(fixtures, { in_point: 120, out_point: 180, description: "preview create", role: null });
    insertCreateSuggestion(fixtures.chapterId, clip.id);

    const first = reconcilePendingSuggestionPreviews(db);
    expect(first.createClipsDeleted).toBe(1);

    const second = reconcilePendingSuggestionPreviews(db);
    expect(second.createClipsDeleted).toBe(0);
    expect(second.createClipsPreserved).toBe(0);
    expect(second.updateSnapshotsRestored).toBe(0);
    expect(second.updateClipsPreserved).toBe(0);
    expect(second.danglingUnlinked).toBe(0);
  });

  it("is idempotent across an interrupted run (version not yet stamped)", async () => {
    const fixtures = insertFixtures();
    const clip = insertClip(fixtures, { in_point: 120, out_point: 180, description: "preview create", role: null });
    insertCreateSuggestion(fixtures.chapterId, clip.id);

    // Simulate bootstrap running the reconciliation but crashing before
    // setSchemaVersion(3). The version stays < 3 so the next bootstrap reruns.
    const first = reconcilePendingSuggestionPreviews(db);
    expect(first.createClipsDeleted).toBe(1);
    const versionAfterFirst = await getSchemaVersion(db);
    expect(versionAfterFirst).toBeLessThan(3);

    const second = reconcilePendingSuggestionPreviews(db);
    expect(second.createClipsDeleted).toBe(0);
    expect(second.danglingUnlinked).toBe(0);
  });

  it("restores the base snapshot for sequential update previews on one clip", () => {
    const fixtures = insertFixtures();
    // The live clip holds the newest preview state (A 100-200 -> B 100-140
    // -> C 100-150). Only the base snapshot A may be restored.
    const live = insertClip(fixtures, { in_point: 100, out_point: 150, description: "orig", role: "setup" });
    const baseSnapshot = previewSnapshotJson({ ...live, out_point: 200 });
    const middleSnapshot = previewSnapshotJson({ ...live, out_point: 140 });

    const olderSuggestionId = insertUpdateSuggestion(fixtures.chapterId, live.id, baseSnapshot, {
      action_payload_json: JSON.stringify({ update: { outPoint: 140 } }),
    });
    const newerSuggestionId = insertUpdateSuggestion(fixtures.chapterId, live.id, middleSnapshot, {
      action_payload_json: JSON.stringify({ update: { outPoint: 150 } }),
    });

    const stats = reconcilePendingSuggestionPreviews(db);

    expect(stats.updateSnapshotsRestored).toBe(1);
    expect(stats.updateClipsPreserved).toBe(0);
    const restored = db.prepare("SELECT out_point, description FROM clips WHERE id = ?").get(live.id) as { out_point: number; description: string | null };
    expect(restored.out_point).toBe(200);
    expect(restored.description).toBe("orig");
    for (const suggestionId of [olderSuggestionId, newerSuggestionId]) {
      const row = getSuggestionRow(suggestionId);
      expect(row.clip_id).toBeNull();
      expect(row.preview_snapshot_json).toBeNull();
    }
  });

  it("keeps a diverged chain state when the live clip does not match the newest preview", () => {
    const fixtures = insertFixtures();
    // The user edited the clip past the newest preview, so nothing is restored.
    const live = insertClip(fixtures, { in_point: 100, out_point: 111, description: "user edit", role: "setup" });
    const baseSnapshot = previewSnapshotJson({ ...live, in_point: 100, out_point: 200, description: "orig" });
    const middleSnapshot = previewSnapshotJson({ ...live, in_point: 100, out_point: 140, description: "orig" });

    insertUpdateSuggestion(fixtures.chapterId, live.id, baseSnapshot, {
      action_payload_json: JSON.stringify({ update: { outPoint: 140 } }),
    });
    insertUpdateSuggestion(fixtures.chapterId, live.id, middleSnapshot, {
      action_payload_json: JSON.stringify({ update: { outPoint: 150 } }),
    });

    const stats = reconcilePendingSuggestionPreviews(db);

    expect(stats.updateSnapshotsRestored).toBe(0);
    expect(stats.updateClipsPreserved).toBe(2);
    const kept = db.prepare("SELECT out_point, description FROM clips WHERE id = ?").get(live.id) as { out_point: number; description: string | null };
    expect(kept.out_point).toBe(111);
    expect(kept.description).toBe("user edit");
  });

  it("reconstructs the preview chain from snapshot links, not suggestion ids", () => {
    const fixtures = insertFixtures();
    // The clip went A(100-200) -> B(100-140) -> C(100-150), but the row that
    // produced A->B was created after the row that produced B->C.
    const live = insertClip(fixtures, { in_point: 100, out_point: 150, description: "orig", role: "setup" });
    const newerStateSuggestionId = insertUpdateSuggestion(
      fixtures.chapterId,
      live.id,
      previewSnapshotJson({ ...live, out_point: 140 }),
      { action_payload_json: JSON.stringify({ update: { outPoint: 150 } }) }
    );
    const baseSuggestionId = insertUpdateSuggestion(
      fixtures.chapterId,
      live.id,
      previewSnapshotJson({ ...live, out_point: 200 }),
      { action_payload_json: JSON.stringify({ update: { outPoint: 140 } }) }
    );

    const stats = reconcilePendingSuggestionPreviews(db);

    expect(stats.updateSnapshotsRestored).toBe(1);
    expect(stats.updateClipsPreserved).toBe(0);
    const restored = db.prepare("SELECT out_point FROM clips WHERE id = ?").get(live.id) as { out_point: number };
    expect(restored.out_point).toBe(200);
    for (const suggestionId of [newerStateSuggestionId, baseSuggestionId]) {
      const row = getSuggestionRow(suggestionId);
      expect(row.clip_id).toBeNull();
      expect(row.preview_snapshot_json).toBeNull();
    }
  });

  it("keeps the live clip when a user edit breaks the snapshot chain", () => {
    const fixtures = insertFixtures();
    // A(100-200) -> preview B(100-140), user edit to X(100-999), then preview
    // X -> C(100-150). The live clip matches the newest preview, but the
    // chain is broken, so nothing is restored.
    const live = insertClip(fixtures, { in_point: 100, out_point: 150, description: "orig", role: "setup" });
    insertUpdateSuggestion(
      fixtures.chapterId,
      live.id,
      previewSnapshotJson({ ...live, out_point: 200 }),
      { action_payload_json: JSON.stringify({ update: { outPoint: 140 } }) }
    );
    insertUpdateSuggestion(
      fixtures.chapterId,
      live.id,
      previewSnapshotJson({ ...live, out_point: 999 }),
      { action_payload_json: JSON.stringify({ update: { outPoint: 150 } }) }
    );

    const stats = reconcilePendingSuggestionPreviews(db);

    expect(stats.updateSnapshotsRestored).toBe(0);
    expect(stats.updateClipsPreserved).toBe(2);
    const kept = db.prepare("SELECT out_point FROM clips WHERE id = ?").get(live.id) as { out_point: number };
    expect(kept.out_point).toBe(150);
  });

  it("reconciles a mixed batch of create and update previews in one pass", () => {
    const fixtures = insertFixtures();

    // Exact create preview -> delete.
    const exactCreate = insertClip(fixtures, { in_point: 10, out_point: 20, description: "preview create", role: null });
    insertCreateSuggestion(fixtures.chapterId, exactCreate.id, { in_point: 10, out_point: 20 });

    // Diverged create preview -> preserve.
    const divergedCreate = insertClip(fixtures, { in_point: 30, out_point: 40, description: "kept", role: "payoff" });
    insertCreateSuggestion(fixtures.chapterId, divergedCreate.id, { in_point: 30, out_point: 40 });

    // Exact update preview -> restore.
    const originalForUpdate = insertClip(fixtures, { in_point: 100, out_point: 200, description: "orig", role: "setup" });
    const exactUpdateLive = insertClip(fixtures, { in_point: 100, out_point: 140, description: "orig", role: "setup" });
    insertUpdateSuggestion(
      fixtures.chapterId,
      exactUpdateLive.id,
      previewSnapshotJson(originalForUpdate),
      { in_point: 0, out_point: 140 }
    );

    // Diverged update preview -> preserve.
    const divergedUpdateLive = insertClip(fixtures, { in_point: 100, out_point: 140, description: "edited", role: "setup" });
    insertUpdateSuggestion(
      fixtures.chapterId,
      divergedUpdateLive.id,
      previewSnapshotJson(originalForUpdate),
      { in_point: 0, out_point: 140 }
    );

    const stats = reconcilePendingSuggestionPreviews(db);

    expect(stats).toEqual<SuggestionPreviewReconciliationStats>({
      skipped: false,
      createClipsDeleted: 1,
      createClipsPreserved: 1,
      updateSnapshotsRestored: 1,
      updateClipsPreserved: 1,
      danglingUnlinked: 0,
      rowsFailed: 0,
    });

    // Exact create clip gone; diverged create kept; exact update restored; diverged update kept.
    expect(db.prepare("SELECT 1 FROM clips WHERE id = ?").get(exactCreate.id)).toBeUndefined();
    expect(db.prepare("SELECT 1 FROM clips WHERE id = ?").get(divergedCreate.id)).toBeDefined();
    const restored = db.prepare("SELECT out_point FROM clips WHERE id = ?").get(exactUpdateLive.id) as { out_point: number };
    expect(restored.out_point).toBe(200);
    const preserved = db.prepare("SELECT out_point, description FROM clips WHERE id = ?").get(divergedUpdateLive.id) as { out_point: number; description: string | null };
    expect(preserved.out_point).toBe(140);
    expect(preserved.description).toBe("edited");
  });

  it("preserves a diverged create preview when the payload specifies an out-of-chapter asset", () => {
    const fixtures = insertFixtures();
    // Suggestion asks for assetId 999 which is not a linked chapter asset -> the
    // migration cannot confirm the clip is untouched, so it must preserve it.
    const clip = insertClip(fixtures, { in_point: 120, out_point: 180, description: "preview create", role: null });
    const suggestionId = insertCreateSuggestion(fixtures.chapterId, clip.id, {
      action_payload_json: JSON.stringify({ create: { assetId: 999, trackIndex: 0 } }),
    });

    const stats = reconcilePendingSuggestionPreviews(db);

    expect(stats.createClipsPreserved).toBe(1);
    expect(stats.createClipsDeleted).toBe(0);
    expect(db.prepare("SELECT 1 FROM clips WHERE id = ?").get(clip.id)).toBeDefined();
    const row = getSuggestionRow(suggestionId);
    expect(row.clip_id).toBeNull();
  });

  it("deletes an exact create preview that uses an explicit payload assetId", () => {
    const fixtures = insertFixtures();
    const clip = insertClip(fixtures, { in_point: 120, out_point: 180, description: "preview create", role: null });
    const suggestionId = insertCreateSuggestion(fixtures.chapterId, clip.id, {
      action_payload_json: JSON.stringify({ create: { assetId: fixtures.assetId, trackIndex: 0 } }),
    });

    const stats = reconcilePendingSuggestionPreviews(db);

    expect(stats.createClipsDeleted).toBe(1);
    expect(db.prepare("SELECT 1 FROM clips WHERE id = ?").get(clip.id)).toBeUndefined();
    const row = getSuggestionRow(suggestionId);
    expect(row.clip_id).toBeNull();
  });

  it("leaves pending suggestions without a preview untouched", () => {
    const fixtures = insertFixtures();
    const suggestionId = insertCreateSuggestion(fixtures.chapterId, null);

    const stats = reconcilePendingSuggestionPreviews(db);

    expect(stats.createClipsDeleted).toBe(0);
    expect(stats.createClipsPreserved).toBe(0);
    expect(stats.danglingUnlinked).toBe(0);
    const row = getSuggestionRow(suggestionId);
    expect(row.status).toBe("pending");
    expect(row.clip_id).toBeNull();
  });

  it("preserves an update preview when the snapshot is missing but the clip exists", () => {
    const fixtures = insertFixtures();
    const live = insertClip(fixtures, { in_point: 100, out_point: 140, description: "no snapshot" });
    // preview_snapshot_json is null but clip_id is set: cannot prove untouched.
    const suggestionId = insertUpdateSuggestion(fixtures.chapterId, live.id, null);

    const stats = reconcilePendingSuggestionPreviews(db);

    expect(stats.updateClipsPreserved).toBe(1);
    expect(db.prepare("SELECT 1 FROM clips WHERE id = ?").get(live.id)).toBeDefined();
    const row = getSuggestionRow(suggestionId);
    expect(row.clip_id).toBeNull();
    expect(row.preview_snapshot_json).toBeNull();
  });

  it("reconciles good rows even when another pending preview cannot be resolved", () => {
    const fixtures = insertFixtures();

    // A well-formed exact create preview that should be deleted.
    const goodClip = insertClip(fixtures, { in_point: 10, out_point: 20, description: "preview create", role: null });
    const goodSuggestionId = insertCreateSuggestion(fixtures.chapterId, goodClip.id, { in_point: 10, out_point: 20 });

    // A second create preview whose chapter has since been deleted. The
    // migration cannot reconstruct its expected clip (no chapter), so it must
    // preserve the clip and unlink the suggestion instead of crashing.
    const orphanChapterId = db
      .prepare("INSERT INTO chapters (project_id, title, start_time, end_time) VALUES (?, ?, ?, ?)")
      .run(fixtures.projectId, "Doomed Chapter", 0, 3600).lastInsertRowid as number;
    const orphanClip = insertClip(fixtures, { in_point: 30, out_point: 40, description: "orphan preview", role: null });
    const orphanSuggestionId = insertCreateSuggestion(orphanChapterId, orphanClip.id, { in_point: 30, out_point: 40 });
    db.pragma("foreign_keys = OFF");
    db.prepare("DELETE FROM chapters WHERE id = ?").run(orphanChapterId);
    db.pragma("foreign_keys = ON");

    const stats = reconcilePendingSuggestionPreviews(db);

    // The good row was reconciled (deleted) and the orphan row was preserved.
    expect(stats.createClipsDeleted).toBe(1);
    expect(stats.createClipsPreserved).toBe(1);
    expect(db.prepare("SELECT 1 FROM clips WHERE id = ?").get(goodClip.id)).toBeUndefined();
    expect(db.prepare("SELECT 1 FROM clips WHERE id = ?").get(orphanClip.id)).toBeDefined();
    expect(db.prepare("SELECT status FROM suggestions WHERE id = ?").get(goodSuggestionId) as { status: string }).toEqual({ status: "pending" });
    const orphanRow = getSuggestionRow(orphanSuggestionId);
    expect(orphanRow.status).toBe("pending");
    expect(orphanRow.clip_id).toBeNull();
  });

  it("counts rows that fail reconciliation and leaves them for a later retry", () => {
    const fixtures = insertFixtures();
    const clip = insertClip(fixtures, { in_point: 120, out_point: 180, description: "preview create", role: null });
    const suggestionId = insertCreateSuggestion(fixtures.chapterId, clip.id);

    db.exec(
      "CREATE TRIGGER fail_clip_delete BEFORE DELETE ON clips BEGIN SELECT RAISE(ABORT, 'forced failure'); END;"
    );

    const stats = reconcilePendingSuggestionPreviews(db);

    expect(stats.rowsFailed).toBe(1);
    expect(stats.createClipsDeleted).toBe(0);
    expect(stats.createClipsPreserved).toBe(0);
    const row = getSuggestionRow(suggestionId);
    expect(row.clip_id).toBe(clip.id);
    expect(db.prepare("SELECT 1 FROM clips WHERE id = ?").get(clip.id)).toBeDefined();
  });
});
