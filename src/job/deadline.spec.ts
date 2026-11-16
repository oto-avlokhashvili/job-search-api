import { deadlinePassed } from './deadline';

describe('deadlinePassed', () => {
  // 13 Nov 2026, 22:00 UTC = 14 Nov 02:00 in Tbilisi
  const now = new Date('2026-11-13T22:00:00Z');

  it.each([
    ['13/11/2026', true],
    ['14/11/2026', false],
    ['15/11/2026', false],
    ['2026-11-13', true],
    ['2026-11-14T00:00:00.000Z', false],
    ['2025-01-01', true],
  ])('%s → %s', (deadline, expected) => {
    expect(deadlinePassed(deadline, now)).toBe(expected);
  });

  it.each([null, undefined, '', '  ', 'until filled', '14 ნოემბერი'])('treats %p as still open', (deadline) => {
    expect(deadlinePassed(deadline, now)).toBe(false);
  });
});
