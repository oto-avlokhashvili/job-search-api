import { PipelineStage } from 'src/Entities/hr-pipeline-entry.entity';
import { PipelineEventType } from 'src/Entities/hr-pipeline-event.entity';

export const PIPELINE_STAGES = Object.values(PipelineStage);
export const MAX_TAGS = 10;

export interface PipelineState {
  stage: PipelineStage;
  rejectionReason: string | null;
  rating: number | null;
  tags: string[];
}

/** undefined = leave as is; null clears rating / rejection reason. */
export interface PipelineChange {
  stage?: PipelineStage;
  rejectionReason?: string | null;
  rating?: number | null;
  tags?: string[];
}

export interface PipelineEventDraft {
  type: PipelineEventType;
  fromStage?: PipelineStage;
  toStage?: PipelineStage;
  rejectionReason?: string | null;
  rating?: number | null;
}

export const DEFAULT_PIPELINE_STATE: PipelineState = {
  stage: PipelineStage.SOURCED,
  rejectionReason: null,
  rating: null,
  tags: [],
};

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Trimmed, blanks dropped, duplicates removed ignoring case (first spelling wins), at most MAX_TAGS. */
export function normalizeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const tag = clean(raw);
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out.slice(0, MAX_TAGS);
}

/**
 * Applies a board change. Any stage can move to any other (HRs undo moves); the rejection
 * reason lives only on REJECTED. Returns the new state and the history events to record.
 */
export function applyPipelineChange(
  current: PipelineState,
  change: PipelineChange,
): { state: PipelineState; events: PipelineEventDraft[] } {
  const state = { ...current };
  const events: PipelineEventDraft[] = [];
  const reason = change.rejectionReason === undefined ? undefined : clean(change.rejectionReason ?? '') || null;

  if (change.stage !== undefined && change.stage !== current.stage) {
    state.stage = change.stage;
    state.rejectionReason = change.stage === PipelineStage.REJECTED ? (reason ?? null) : null;
    events.push({
      type: PipelineEventType.STAGE_CHANGED,
      fromStage: current.stage,
      toStage: change.stage,
      rejectionReason: state.rejectionReason,
    });
  } else if (reason !== undefined && state.stage === PipelineStage.REJECTED) {
    // Editing the reason of an already rejected candidate
    state.rejectionReason = reason;
  }

  if (change.rating !== undefined && change.rating !== current.rating) {
    state.rating = change.rating;
    events.push({ type: PipelineEventType.RATING_CHANGED, rating: change.rating });
  }

  if (change.tags !== undefined) state.tags = normalizeTags(change.tags);

  return { state, events };
}
