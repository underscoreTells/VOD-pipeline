import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import Database from "better-sqlite3";
import {
  cloneChatMessagesThrough,
  setDatabaseForTesting,
  createChatConversation,
  getChatConversation,
  getChatConversationsByChapter,
  createChatMessage,
  deleteChatMessagesAfter,
  getChatMessageByConversation,
  getChatMessagesByConversation,
  deleteChatConversation,
  updateUserChatMessageContent,
  updateChatConversation,
  createChapterProxy,
  getChapterProxyByChapterAsset,
  updateChapterProxyStatus,
  updateChapterProxyMetadata,
} from "../../src/electron/database/index.js";

const canUseNativeSqlite = (() => {
  try {
    const probe = new Database(":memory:");
    probe.close();
    return true;
  } catch {
    return false;
  }
})();

const describeNative = canUseNativeSqlite ? describe : describe.skip;

describeNative("Chat conversation persistence", () => {
  let tempDir: string;
  let db: Database.Database;
  let projectId: number;
  let chapterId: number;
  let assetId: number;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vod-pipeline-chat-test-"));
    const dbPath = path.join(tempDir, "test.db");
    db = new Database(dbPath);
    db.pragma("journal_mode = WAL");

    const schemaPath = path.join(process.cwd(), "database", "schema.sql");
    db.exec(fs.readFileSync(schemaPath, "utf-8"));
  });

  beforeEach(() => {
    setDatabaseForTesting(db);

    db.prepare("DELETE FROM chat_messages").run();
    db.prepare("DELETE FROM chat_conversations").run();
    db.prepare("DELETE FROM chapter_proxies").run();
    db.prepare("DELETE FROM chapter_assets").run();
    db.prepare("DELETE FROM chapters").run();
    db.prepare("DELETE FROM assets").run();
    db.prepare("DELETE FROM projects").run();

    projectId = db.prepare("INSERT INTO projects (name) VALUES (?)").run("Project").lastInsertRowid as number;
    assetId = db
      .prepare("INSERT INTO assets (project_id, file_path, file_type, duration) VALUES (?, ?, ?, ?)")
      .run(projectId, "/tmp/vod.mp4", "video", 300)
      .lastInsertRowid as number;
    chapterId = db
      .prepare("INSERT INTO chapters (project_id, title, start_time, end_time) VALUES (?, ?, ?, ?)")
      .run(projectId, "Chapter", 10, 70)
      .lastInsertRowid as number;
    db.prepare("INSERT INTO chapter_assets (chapter_id, asset_id) VALUES (?, ?)").run(chapterId, assetId);
  });

  afterAll(() => {
    if (typeof setDatabaseForTesting === "function") {
      setDatabaseForTesting(null);
    }
    if (db) {
      db.close();
    }
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("creates and lists chapter-locked conversations", async () => {
    const one = await createChatConversation({
      project_id: projectId,
      chapter_id: chapterId,
      title: "First",
      provider: "gemini",
      model: "gemini-3.6-flash",
      reasoning_effort: null,
      thread_id: "thread-1",
    });

    const two = await createChatConversation({
      project_id: projectId,
      chapter_id: chapterId,
      title: "Second",
      provider: "gemini",
      thread_id: "thread-2",
    });

    expect(one.chapter_id).toBe(chapterId);
    expect(one.model).toBe('gemini-3.6-flash');
    expect(two.chapter_id).toBe(chapterId);

    const listed = await getChatConversationsByChapter(projectId, chapterId);
    expect(listed).toHaveLength(2);
    expect(listed.some((conversation) => conversation.id === one.id)).toBe(true);
    expect(listed.some((conversation) => conversation.id === two.id)).toBe(true);
  });

  it("persists conversation message history", async () => {
    const conversation = await createChatConversation({
      project_id: projectId,
      chapter_id: chapterId,
      title: "History",
      provider: "gemini",
      thread_id: "thread-history",
    });

    await createChatMessage({
      conversation_id: conversation.id,
      role: "user",
      content: "hello",
      thinking_markdown: null,
      trace_json: null,
    });
    await createChatMessage({
      conversation_id: conversation.id,
      role: "assistant",
      content: "world",
      thinking_markdown: "## Reasoning\n\nThe response is grounded in the chapter context.",
      trace_json: JSON.stringify([
        {
          id: "trace-1",
          status: "processing_chat",
          label: "Thinking...",
          createdAt: "2026-04-18T12:00:00.000Z",
        },
      ]),
    });

    const messages = await getChatMessagesByConversation(conversation.id);
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("user");
    expect(messages[0].content).toBe("hello");
    expect(messages[1].role).toBe("assistant");
    expect(messages[1].content).toBe("world");
    expect(messages[1].thinking_markdown).toBe("## Reasoning\n\nThe response is grounded in the chapter context.");
    expect(messages[1].trace_json).toContain("trace-1");
  });

  it('persists per-conversation model and reasoning configuration', async () => {
    const conversation = await createChatConversation({
      project_id: projectId,
      chapter_id: chapterId,
      title: 'Configured',
      provider: 'gemini',
      model: 'gemini-3.6-flash',
      reasoning_effort: null,
      thread_id: 'thread-configured',
    });

    await updateChatConversation(conversation.id, {
      provider: 'openai',
      model: 'gpt-5.6-terra',
      reasoning_effort: 'high',
    });

    expect(await getChatConversation(conversation.id)).toMatchObject({
      provider: 'openai',
      model: 'gpt-5.6-terra',
      reasoning_effort: 'high',
    });
  });

  it("updates a persisted user message in place", async () => {
    const conversation = await createChatConversation({
      project_id: projectId,
      chapter_id: chapterId,
      title: "Editable",
      provider: "gemini",
      thread_id: "thread-editable",
    });

    const userMessage = await createChatMessage({
      conversation_id: conversation.id,
      role: "user",
      content: "initial question",
      thinking_markdown: null,
      trace_json: null,
    });

    const updated = await updateUserChatMessageContent(
      conversation.id,
      userMessage.id,
      "revised question"
    );
    const reloaded = await getChatMessageByConversation(conversation.id, userMessage.id);

    expect(updated).toBe(true);
    expect(reloaded?.content).toBe("revised question");
  });

  it("deletes conversation history after the selected message", async () => {
    const conversation = await createChatConversation({
      project_id: projectId,
      chapter_id: chapterId,
      title: "Tail delete",
      provider: "gemini",
      thread_id: "thread-tail-delete",
    });

    const first = await createChatMessage({
      conversation_id: conversation.id,
      role: "user",
      content: "first",
      thinking_markdown: null,
      trace_json: null,
    });
    await createChatMessage({
      conversation_id: conversation.id,
      role: "assistant",
      content: "second",
      thinking_markdown: null,
      trace_json: null,
    });
    await createChatMessage({
      conversation_id: conversation.id,
      role: "user",
      content: "third",
      thinking_markdown: null,
      trace_json: null,
    });

    const deletedCount = await deleteChatMessagesAfter(conversation.id, first.id);
    const remaining = await getChatMessagesByConversation(conversation.id);

    expect(deletedCount).toBe(2);
    expect(remaining.map((message) => message.content)).toEqual(["first"]);
  });

  it("clones messages into a branched conversation through the selected message", async () => {
    const sourceConversation = await createChatConversation({
      project_id: projectId,
      chapter_id: chapterId,
      title: "Source",
      provider: "gemini",
      thread_id: "thread-source",
    });
    const targetConversation = await createChatConversation({
      project_id: projectId,
      chapter_id: chapterId,
      title: "Source (Branch)",
      provider: "gemini",
      thread_id: "thread-branch",
    });

    const first = await createChatMessage({
      conversation_id: sourceConversation.id,
      role: "user",
      content: "keep this",
      thinking_markdown: null,
      trace_json: null,
      mentions_json: JSON.stringify([
        { type: "clip", id: 31, label: "Opening clip" },
        { type: "suggestion", id: 42, label: "Trim suggestion" },
      ]),
    });
    const second = await createChatMessage({
      conversation_id: sourceConversation.id,
      role: "assistant",
      content: "keep that",
      thinking_markdown: "## Reasoning\n\nImportant context.",
      trace_json: "{\"id\":\"trace-1\"}",
    });
    await createChatMessage({
      conversation_id: sourceConversation.id,
      role: "user",
      content: "drop this tail",
      thinking_markdown: null,
      trace_json: null,
    });

    const clonedCount = await cloneChatMessagesThrough(
      sourceConversation.id,
      targetConversation.id,
      second.id
    );
    const clonedMessages = await getChatMessagesByConversation(targetConversation.id);

    expect(clonedCount).toBe(2);
    expect(clonedMessages).toHaveLength(2);
    expect(clonedMessages[0]?.content).toBe("keep this");
    expect(clonedMessages[0]?.created_at).toBe(first.created_at);
    expect(clonedMessages[0]?.mentions_json).toBe(JSON.stringify([
      { type: "clip", id: 31, label: "Opening clip" },
    ]));
    expect(clonedMessages[1]?.content).toBe("keep that");
    expect(clonedMessages[1]?.thinking_markdown).toBe("## Reasoning\n\nImportant context.");
    expect(clonedMessages[1]?.trace_json).toBe("{\"id\":\"trace-1\"}");
  });

  it("deletes conversation with cascading messages", async () => {
    const conversation = await createChatConversation({
      project_id: projectId,
      chapter_id: chapterId,
      title: "Delete me",
      provider: "gemini",
      thread_id: "thread-delete",
    });

    await createChatMessage({
      conversation_id: conversation.id,
      role: "user",
      content: "to be deleted",
      thinking_markdown: null,
      trace_json: null,
    });

    const deleted = await deleteChatConversation(conversation.id);
    expect(deleted).toBe(true);

    const messages = await getChatMessagesByConversation(conversation.id);
    expect(messages).toHaveLength(0);
  });

  it("stores and updates chapter-trimmed proxies", async () => {
    const chapterProxy = await createChapterProxy({
      chapter_id: chapterId,
      asset_id: assetId,
      file_path: "/tmp/chapter-proxy.mp4",
      preset: "ai_analysis_chapter",
      start_time: 10,
      end_time: 70,
      width: null,
      height: null,
      framerate: null,
      file_size: null,
      duration: null,
      status: "pending",
      error_message: null,
    });

    await updateChapterProxyMetadata(chapterProxy.id, {
      width: 640,
      height: 360,
      framerate: 5,
      duration: 60,
      file_size: 1024,
    });
    await updateChapterProxyStatus(chapterProxy.id, "ready");

    const fetched = await getChapterProxyByChapterAsset(chapterId, assetId);
    expect(fetched).not.toBeNull();
    expect(fetched?.status).toBe("ready");
    expect(fetched?.duration).toBe(60);
    expect(fetched?.file_path).toContain("chapter-proxy");
  });
});
