import { ipcMain } from 'electron';
import type { Clip } from '../../../../shared/types/database.js';
import type { TimelineAction } from '../../../../shared/types/agent-ipc.js';
import {
  createClip,
  getAssetsByProject,
  getAssetsForChapter,
  getChapter,
  getClip,
  getProject,
  updateClip,
} from '../../../database/index.js';
import { normalizeTimelineActions, toNumberOrNull } from '../../handler-support.js';
import { IPC_CHANNELS, IPC_ERROR_CODES } from '../../channels.js';
import { createErrorResponse, createSuccessResponse } from '../../shared.js';
import { logger } from './shared.js';

export function registerAgentApplyActionsHandler(): void {
  ipcMain.handle(IPC_CHANNELS.AGENT_APPLY_ACTIONS, async (_, payload) => {
    const projectId = toNumberOrNull(payload?.projectId);
    const chapterId = toNumberOrNull(payload?.chapterId);
    const actionsRaw = Array.isArray(payload?.actions) ? payload.actions : [];

    logger.info('agent:apply-actions', projectId, chapterId, actionsRaw.length);

    try {
      if (!projectId) {
        return createErrorResponse('Project ID is required', IPC_ERROR_CODES.VALIDATION_ERROR);
      }

      const project = await getProject(projectId);
      if (!project) {
        return createErrorResponse('Project not found', IPC_ERROR_CODES.NOT_FOUND);
      }

      let chapter = null as Awaited<ReturnType<typeof getChapter>> | null;
      let chapterAssetIds: number[] = [];
      let chapterDuration: number | null = null;

      if (chapterId !== null) {
        chapter = await getChapter(chapterId);
        if (!chapter) {
          return createErrorResponse('Chapter not found', IPC_ERROR_CODES.NOT_FOUND);
        }
        if (chapter.project_id !== projectId) {
          return createErrorResponse('Chapter does not belong to project', IPC_ERROR_CODES.VALIDATION_ERROR);
        }

        chapterAssetIds = await getAssetsForChapter(chapter.id);
        chapterDuration = Math.max(0, chapter.end_time - chapter.start_time);
      }

      const projectAssets = await getAssetsByProject(projectId);
      const projectAssetIdSet = new Set(projectAssets.map((asset) => asset.id));
      const chapterAssetIdSet = new Set(chapterAssetIds);

      const results: Array<{
        index: number;
        action: TimelineAction;
        success: boolean;
        clip?: Clip;
        error?: string;
      }> = [];

      const toGlobalTime = (localSeconds: number): number => {
        if (!chapter) return localSeconds;
        return chapter.start_time + localSeconds;
      };

      const ensureChapterLocalTime = (value: number, fieldName: string) => {
        if (!chapter || chapterDuration === null) return;
        if (value < 0 || value > chapterDuration) {
          throw new Error(`${fieldName} (${value}) must be within chapter range 0-${chapterDuration.toFixed(2)}s`);
        }
      };

      for (let index = 0; index < actionsRaw.length; index += 1) {
        const rawAction = actionsRaw[index];
        const [action] = normalizeTimelineActions([rawAction]);

        if (!action) {
          results.push({
            index,
            action: {
              type: 'create_clip',
              inPoint: 0,
              outPoint: 0.01,
              reasoning: 'Invalid action payload',
            },
            success: false,
            error: 'Invalid timeline action payload',
          });
          continue;
        }

        try {
          if (action.type === 'create_clip') {
            const chapterLocalInPoint = action.inPoint;
            const chapterLocalOutPoint = action.outPoint;

            ensureChapterLocalTime(chapterLocalInPoint, 'inPoint');
            ensureChapterLocalTime(chapterLocalOutPoint, 'outPoint');

            const inPoint = toGlobalTime(chapterLocalInPoint);
            const outPoint = toGlobalTime(chapterLocalOutPoint);

            if (outPoint <= inPoint) {
              throw new Error('Out point must be greater than in point');
            }
            if (inPoint < 0) {
              throw new Error('Times must be non-negative');
            }

            let assetId = action.assetId;
            if (!assetId) {
              const fallbackAssets = chapter ? chapterAssetIds : projectAssets.map((asset) => asset.id);
              if (fallbackAssets.length === 1) {
                assetId = fallbackAssets[0];
              }
            }

            if (!assetId) {
              throw new Error('assetId is required when multiple assets are available');
            }
            if (!projectAssetIdSet.has(assetId)) {
              throw new Error(`Asset ${assetId} does not belong to project ${projectId}`);
            }
            if (chapter && !chapterAssetIdSet.has(assetId)) {
              throw new Error(`Asset ${assetId} is not linked to chapter ${chapter.id}`);
            }

            const clip = await createClip({
              project_id: projectId,
              asset_id: assetId,
              track_index: action.trackIndex ?? 0,
              in_point: inPoint,
              out_point: outPoint,
              role: action.role ?? null,
              description: action.description ?? null,
              is_essential: action.isEssential ?? false,
            });

            results.push({ index, action, success: true, clip });
            continue;
          }

          const existingClip = await getClip(action.clipId);
          if (!existingClip) {
            throw new Error(`Clip not found: ${action.clipId}`);
          }
          if (existingClip.project_id !== projectId) {
            throw new Error(`Clip ${action.clipId} does not belong to project ${projectId}`);
          }
          if (chapter && !chapterAssetIdSet.has(existingClip.asset_id)) {
            throw new Error(`Clip ${action.clipId} is not linked to chapter ${chapter.id}`);
          }
          if (action.type === 'delete_clip' || action.type === 'split_clip') {
            throw new Error(`${action.type} must be applied through the reversible suggestion preview flow`);
          }

          const updates: Partial<Clip> = {};
          if (action.updates.inPoint !== undefined) {
            ensureChapterLocalTime(action.updates.inPoint, 'inPoint');
            updates.in_point = toGlobalTime(action.updates.inPoint);
          }
          if (action.updates.outPoint !== undefined) {
            ensureChapterLocalTime(action.updates.outPoint, 'outPoint');
            updates.out_point = toGlobalTime(action.updates.outPoint);
          }
          if (action.updates.role !== undefined) {
            updates.role = action.updates.role;
          }
          if (action.updates.description !== undefined) {
            updates.description = action.updates.description;
          }
          if (action.updates.isEssential !== undefined) {
            updates.is_essential = action.updates.isEssential;
          }

          const effectiveIn = updates.in_point ?? existingClip.in_point;
          const effectiveOut = updates.out_point ?? existingClip.out_point;
          if (effectiveOut <= effectiveIn) {
            throw new Error('Out point must be greater than in point');
          }
          if (effectiveIn < 0) {
            throw new Error('Times must be non-negative');
          }

          const updated = await updateClip(action.clipId, updates);
          if (!updated) {
            throw new Error(`Failed to update clip ${action.clipId}`);
          }

          const refreshed = await getClip(action.clipId);
          results.push({ index, action, success: true, clip: refreshed ?? undefined });
        } catch (error) {
          results.push({
            index,
            action,
            success: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      return createSuccessResponse({ results });
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.UNKNOWN_ERROR);
    }
  });
}
