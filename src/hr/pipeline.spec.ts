import { PipelineStage } from 'src/Entities/hr-pipeline-entry.entity';
import { PipelineEventType } from 'src/Entities/hr-pipeline-event.entity';
import { applyPipelineChange, DEFAULT_PIPELINE_STATE, MAX_TAGS, normalizeTags } from './pipeline';

describe('applyPipelineChange', () => {
  it('moves a candidate and records the stage change', () => {
    const { state, events } = applyPipelineChange(DEFAULT_PIPELINE_STATE, { stage: PipelineStage.INTERVIEW });
    expect(state.stage).toBe(PipelineStage.INTERVIEW);
    expect(events).toEqual([
      {
        type: PipelineEventType.STAGE_CHANGED,
        fromStage: PipelineStage.SOURCED,
        toStage: PipelineStage.INTERVIEW,
        rejectionReason: null,
      },
    ]);
  });

  it('allows moving backwards', () => {
    const current = { ...DEFAULT_PIPELINE_STATE, stage: PipelineStage.OFFER };
    const { state, events } = applyPipelineChange(current, { stage: PipelineStage.CONTACTED });
    expect(state.stage).toBe(PipelineStage.CONTACTED);
    expect(events).toHaveLength(1);
  });

  it('records nothing when the stage does not change', () => {
    const current = { ...DEFAULT_PIPELINE_STATE, stage: PipelineStage.CONTACTED };
    expect(applyPipelineChange(current, { stage: PipelineStage.CONTACTED }).events).toEqual([]);
  });

  it('keeps a trimmed rejection reason on REJECTED', () => {
    const { state, events } = applyPipelineChange(DEFAULT_PIPELINE_STATE, {
      stage: PipelineStage.REJECTED,
      rejectionReason: '  ხელფასი   არ შეთანხმდა ',
    });
    expect(state.rejectionReason).toBe('ხელფასი არ შეთანხმდა');
    expect(events[0].rejectionReason).toBe('ხელფასი არ შეთანხმდა');
  });

  it('stores a blank rejection reason as null', () => {
    const { state } = applyPipelineChange(DEFAULT_PIPELINE_STATE, { stage: PipelineStage.REJECTED, rejectionReason: '  ' });
    expect(state.rejectionReason).toBeNull();
  });

  it('clears the rejection reason when leaving REJECTED', () => {
    const current = { ...DEFAULT_PIPELINE_STATE, stage: PipelineStage.REJECTED, rejectionReason: 'სხვა' };
    const { state } = applyPipelineChange(current, { stage: PipelineStage.INTERVIEW });
    expect(state.rejectionReason).toBeNull();
  });

  it('ignores a rejection reason for other stages', () => {
    const { state } = applyPipelineChange(DEFAULT_PIPELINE_STATE, { stage: PipelineStage.OFFER, rejectionReason: 'x' });
    expect(state.rejectionReason).toBeNull();
    expect(applyPipelineChange(DEFAULT_PIPELINE_STATE, { rejectionReason: 'x' }).state.rejectionReason).toBeNull();
  });

  it('edits the reason of an already rejected candidate without a stage event', () => {
    const current = { ...DEFAULT_PIPELINE_STATE, stage: PipelineStage.REJECTED, rejectionReason: 'a' };
    const { state, events } = applyPipelineChange(current, { rejectionReason: 'b' });
    expect(state.rejectionReason).toBe('b');
    expect(events).toEqual([]);
  });

  it('sets and clears the rating, recording each change', () => {
    const rated = applyPipelineChange(DEFAULT_PIPELINE_STATE, { rating: 4 });
    expect(rated.state.rating).toBe(4);
    expect(rated.events).toEqual([{ type: PipelineEventType.RATING_CHANGED, rating: 4 }]);

    const cleared = applyPipelineChange(rated.state, { rating: null });
    expect(cleared.state.rating).toBeNull();
    expect(cleared.events).toHaveLength(1);

    expect(applyPipelineChange(rated.state, { rating: 4 }).events).toEqual([]);
  });

  it('leaves fields that were not sent untouched', () => {
    const current = { stage: PipelineStage.OFFER, rejectionReason: null, rating: 3, tags: ['excel'] };
    expect(applyPipelineChange(current, {}).state).toEqual(current);
  });
});

describe('normalizeTags', () => {
  it('trims, drops blanks and removes case-insensitive duplicates', () => {
    expect(normalizeTags([' Excel ', 'excel', '', '  ', 'IFRS', 'ifrs  ', 'top  candidate'])).toEqual([
      'Excel',
      'IFRS',
      'top candidate',
    ]);
  });

  it(`keeps at most ${MAX_TAGS} tags`, () => {
    expect(normalizeTags(Array.from({ length: 15 }, (_, i) => `t${i}`))).toHaveLength(MAX_TAGS);
  });
});
