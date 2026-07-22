import { randomUUID } from 'node:crypto';
import type {
  ChatConversation,
  ChatConversationMessage,
  CreateChatConversationInput,
  CreateChatConversationMessageInput,
  UpdateChatConversationInput,
} from '../../../shared/types/database.js';
import { DEFAULT_CONVERSATION_TITLE } from '../../../shared/utils/conversation-title.js';
import { getDatabase, withTransaction } from '../client.js';
import { cleanupPendingSuggestionsForMessages } from './suggestions.js';

function touchConversation(
  database: Awaited<ReturnType<typeof getDatabase>>,
  conversationId: number,
  updatedAt = new Date().toISOString()
): void {
  database.prepare(
    'UPDATE chat_conversations SET updated_at = ? WHERE id = ?'
  ).run(updatedAt, conversationId);
}

export async function createChatConversation(
  input: CreateChatConversationInput
): Promise<ChatConversation> {
  const database = await getDatabase();
  const now = new Date().toISOString();
  const threadId = input.thread_id?.trim() || randomUUID();
  const title = input.title?.trim() || DEFAULT_CONVERSATION_TITLE;

  const result = database.prepare(
    `INSERT INTO chat_conversations (project_id, chapter_id, title, provider, thread_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    input.project_id,
    input.chapter_id,
    title,
    input.provider ?? null,
    threadId,
    now,
    now
  );

  return {
    id: result.lastInsertRowid as number,
    project_id: input.project_id,
    chapter_id: input.chapter_id,
    title,
    provider: input.provider ?? null,
    thread_id: threadId,
    created_at: now,
    updated_at: now,
  };
}

export async function getChatConversation(id: number): Promise<ChatConversation | null> {
  const database = await getDatabase();
  const result = database.prepare(
    `SELECT id, project_id, chapter_id, title, provider, thread_id, created_at, updated_at
     FROM chat_conversations
     WHERE id = ?`
  ).get(id) as ChatConversation | undefined;

  return result || null;
}

export async function getChatConversationsByChapter(
  projectId: number,
  chapterId: number
): Promise<ChatConversation[]> {
  const database = await getDatabase();
  return database.prepare(
    `SELECT id, project_id, chapter_id, title, provider, thread_id, created_at, updated_at
     FROM chat_conversations
     WHERE project_id = ? AND chapter_id = ?
     ORDER BY updated_at DESC, created_at DESC`
  ).all(projectId, chapterId) as ChatConversation[];
}

export async function updateChatConversation(
  id: number,
  updates: UpdateChatConversationInput
): Promise<boolean> {
  const database = await getDatabase();
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.title !== undefined) {
    fields.push('title = ?');
    values.push(updates.title.trim() || DEFAULT_CONVERSATION_TITLE);
  }
  if (updates.provider !== undefined) {
    fields.push('provider = ?');
    values.push(updates.provider ?? null);
  }
  if (updates.thread_id !== undefined) {
    fields.push('thread_id = ?');
    values.push(updates.thread_id.trim() || randomUUID());
  }

  if (fields.length === 0) {
    return true;
  }

  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);

  const result = database.prepare(
    `UPDATE chat_conversations SET ${fields.join(', ')} WHERE id = ?`
  ).run(...values);

  return result.changes > 0;
}

export async function deleteChatConversation(id: number): Promise<boolean> {
  const database = await getDatabase();
  const result = database.prepare('DELETE FROM chat_conversations WHERE id = ?').run(id);

  return result.changes > 0;
}

export async function createChatMessage(
  input: CreateChatConversationMessageInput
): Promise<ChatConversationMessage> {
  const database = await getDatabase();
  const now = new Date().toISOString();
  const result = database.prepare(
    `INSERT INTO chat_messages (conversation_id, role, content, thinking_markdown, trace_json, mentions_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    input.conversation_id,
    input.role,
    input.content,
    input.thinking_markdown ?? null,
    input.trace_json ?? null,
    input.mentions_json ?? null,
    now
  );

  touchConversation(database, input.conversation_id, now);

  return {
    id: result.lastInsertRowid as number,
    conversation_id: input.conversation_id,
    role: input.role,
    content: input.content,
    thinking_markdown: input.thinking_markdown ?? null,
    trace_json: input.trace_json ?? null,
    mentions_json: input.mentions_json ?? null,
    created_at: now,
  };
}

export async function getChatMessagesByConversation(
  conversationId: number
): Promise<ChatConversationMessage[]> {
  const database = await getDatabase();
  return database.prepare(
    `SELECT id, conversation_id, role, content, thinking_markdown, trace_json, mentions_json, created_at
     FROM chat_messages
     WHERE conversation_id = ?
     ORDER BY created_at ASC, id ASC`
  ).all(conversationId) as ChatConversationMessage[];
}

export async function getChatMessageByConversation(
  conversationId: number,
  messageId: number
): Promise<ChatConversationMessage | null> {
  const database = await getDatabase();
  const result = database.prepare(
    `SELECT id, conversation_id, role, content, thinking_markdown, trace_json, mentions_json, created_at
     FROM chat_messages
     WHERE id = ? AND conversation_id = ?`
  ).get(messageId, conversationId) as ChatConversationMessage | undefined;

  return result || null;
}

export async function updateUserChatMessageContent(
  conversationId: number,
  messageId: number,
  content: string,
  mentionsJson: string | null = null
): Promise<boolean> {
  const database = await getDatabase();
  const result = database.prepare(
    `UPDATE chat_messages
     SET content = ?, mentions_json = ?
     WHERE id = ? AND conversation_id = ? AND role = 'user'`
  ).run(content, mentionsJson, messageId, conversationId);

  if (result.changes > 0) {
    touchConversation(database, conversationId);
  }

  return result.changes > 0;
}

export async function deleteChatMessagesAfter(
  conversationId: number,
  messageId: number
): Promise<number> {
  const database = await getDatabase();
  const target = await getChatMessageByConversation(conversationId, messageId);
  if (!target) {
    return 0;
  }

  const result = await withTransaction(async () => {
    const messageIds = (database.prepare(
      `SELECT id FROM chat_messages
       WHERE conversation_id = ?
         AND (created_at > ? OR (created_at = ? AND id > ?))`
    ).all(conversationId, target.created_at, target.created_at, messageId) as Array<{ id: number }>)
      .map(({ id }) => id);
    await cleanupPendingSuggestionsForMessages(messageIds);
    return database.prepare(
      `DELETE FROM chat_messages
       WHERE id IN (${messageIds.map(() => '?').join(', ') || 'NULL'})`
    ).run(...messageIds);
  });

  if (result.changes > 0) {
    touchConversation(database, conversationId);
  }

  return result.changes;
}

export async function cloneChatMessagesThrough(
  sourceConversationId: number,
  targetConversationId: number,
  throughMessageId: number
): Promise<number> {
  const database = await getDatabase();
  const sourceMessages = await getChatMessagesByConversation(sourceConversationId);
  const throughIndex = sourceMessages.findIndex((message) => message.id === throughMessageId);
  if (throughIndex < 0) {
    return 0;
  }

  const messagesToClone = sourceMessages.slice(0, throughIndex + 1);
  const insertMessage = database.prepare(
    `INSERT INTO chat_messages (conversation_id, role, content, thinking_markdown, trace_json, mentions_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const cloneMessages = database.transaction((messages: ChatConversationMessage[]) => {
    for (const message of messages) {
      insertMessage.run(
        targetConversationId,
        message.role,
        message.content,
        message.thinking_markdown ?? null,
        message.trace_json ?? null,
        message.mentions_json ?? null,
        message.created_at
      );
    }
  });

  cloneMessages(messagesToClone);

  if (messagesToClone.length > 0) {
    touchConversation(database, targetConversationId);
  }

  return messagesToClone.length;
}
