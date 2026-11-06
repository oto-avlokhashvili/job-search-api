import { User } from 'src/Entities/user.entity';
import { Cv } from 'src/Entities/cv.entity';
import { HrCandidatesService } from './hr-candidates.service';

const hr = { id: 7, role: 'HR' } as User;

const cv = (id: number, role: string) =>
  ({
    id,
    updatedAt: new Date('2026-10-01'),
    addedByHrId: null,
    userId: null,
    summary: {
      detectedRole: role,
      seniorityLevel: 'Senior',
      primarySkills: ['React'],
      secondarySkills: [],
      domains: ['Fintech'],
      locationPreference: 'Tbilisi',
      careerDirection: role,
      searchQueries: [],
    },
  }) as unknown as Cv;

const profile = { name: 'Nino B', headline: 'React Developer at TBC', url: 'https://www.linkedin.com/in/nino', snippet: 'React, TypeScript' };

const expandAnswer = { keywords: ['react', 'frontend'], titles: ['React Developer'], seniority: 'Senior', location: 'Tbilisi' };

function setup(opts: { linkedin?: () => Promise<any>; quotaLeft?: boolean; rank?: any } = {}) {
  const cvs = [cv(1, 'Frontend Developer'), cv(2, 'React Developer')];
  const generateJson = jest
    .fn()
    .mockResolvedValueOnce(expandAnswer)
    .mockResolvedValueOnce(
      opts.rank === undefined
        ? {
            results: [
              { id: 'li:0', match: 90, reason: 'React developer at a bank', missing: [] },
              { id: 'cv:2', match: 80, reason: 'Senior React', missing: ['fintech'] },
              { id: 'cv:1', match: 60, reason: 'Frontend', missing: [] },
            ],
          }
        : opts.rank,
    );
  const linkedinSearch = jest.fn(opts.linkedin ?? (async () => ({ profiles: [profile] })));
  const limits = {
    getJson: jest.fn(async () => null),
    setJson: jest.fn(),
    consume: jest.fn(),
    tryConsume: jest.fn(async () => opts.quotaLeft ?? true),
  };
  const logs = { insert: jest.fn(async () => undefined) };
  const service = new HrCandidatesService(
    { find: jest.fn(async () => cvs) } as any,
    { find: jest.fn(async () => []) } as any,
    { find: jest.fn(async () => []) } as any,
    logs as any,
    {} as any,
    limits as any,
    { search: linkedinSearch } as any,
    { memberships: jest.fn(async () => new Map()) } as any,
    {} as any,
    { generateJson } as any,
  );
  jest
    .spyOn(service as any, 'findCandidatePool')
    .mockResolvedValue(cvs.map((c, i) => ({ cv: c, score: { match: 90 - i * 10, matchedKeywords: [] } })));
  return { service, generateJson, linkedinSearch, limits, logs };
}

describe('HrCandidatesService AI search', () => {
  it('ranks our CVs and LinkedIn profiles together in one list', async () => {
    const { service, linkedinSearch, limits, logs } = setup();
    const res = await service.searchCvsWithAi(hr, { query: 'Senior React dev, fintech, Tbilisi' });

    expect(linkedinSearch).toHaveBeenCalledWith({ keyword: 'React Developer', location: 'Tbilisi', company: '', university: '', skills: '', languages: '', openToWork: false });
    expect(limits.tryConsume).toHaveBeenCalledWith(expect.stringMatching(/^hr:linkedin:7:/), expect.any(Number), expect.any(Number));
    expect(res.linkedin).toBe('ok');
    expect(res.total).toBe(3);
    expect(res.candidates.map((c) => [c.source, c.match])).toEqual([
      ['linkedin', 90],
      ['cv', 80],
      ['cv', 60],
    ]);
    expect(res.candidates[0]).toMatchObject({ source: 'linkedin', profile, reason: 'React developer at a bank' });
    expect(res.candidates[1]).toMatchObject({ source: 'cv', id: 2, unlocked: false, contact: null, missing: ['fintech'] });
    expect(logs.insert).toHaveBeenCalledWith(expect.objectContaining({ linkedinCount: 1, resultCvIds: [2, 1] }));
  });

  it('applies the company filter to both halves and passes the open-to-work choice on', async () => {
    const { service, linkedinSearch, limits } = setup();
    await service.searchCvsWithAi(hr, { query: 'Senior React dev', company: 'TBC Bank, Liberty', university: 'TSU', openToWork: true });

    expect(linkedinSearch).toHaveBeenCalledWith(
      expect.objectContaining({ company: 'TBC Bank,Liberty', university: 'TSU', openToWork: true }),
    );
    expect((service as any).findCandidatePool).toHaveBeenCalledWith(
      expect.objectContaining({ companies: ['TBC Bank', 'Liberty'], universities: ['TSU'] }),
    );
    // A different filter is a different search, not the cached one
    const [plainKey] = (await (async () => {
      const other = setup();
      await other.service.searchCvsWithAi(hr, { query: 'Senior React dev' });
      return other.limits.setJson.mock.calls[0] as any[];
    })());
    expect(limits.setJson.mock.calls[0][0]).not.toBe(plainKey);
  });

  it('leaves LinkedIn out when the daily LinkedIn quota is used up', async () => {
    const { service, linkedinSearch, limits } = setup({
      quotaLeft: false,
      rank: { results: [{ id: 'cv:2', match: 80, reason: 'Senior React', missing: [] }] },
    });
    const res = await service.searchCvsWithAi(hr, { query: 'React dev' });

    expect(linkedinSearch).not.toHaveBeenCalled();
    expect(res.linkedin).toBe('quota');
    expect(res.candidates.map((c) => c.source)).toEqual(['cv']);
    // Cached briefly only, so a later search can include LinkedIn
    expect(limits.setJson).toHaveBeenCalledWith(expect.any(String), expect.anything(), 5 * 60);
  });

  it('still returns our CVs when LinkedIn fails', async () => {
    const { service } = setup({
      linkedin: async () => {
        throw new Error('captcha');
      },
      rank: { results: [{ id: 'cv:1', match: 70, reason: 'Frontend', missing: [] }] },
    });
    const res = await service.searchCvsWithAi(hr, { query: 'React dev' });

    expect(res.linkedin).toBe('failed');
    expect(res.candidates).toHaveLength(1);
  });

  it('without the AI: CVs by keyword score, then LinkedIn unscored', async () => {
    const { service } = setup({ rank: null });
    const res = await service.searchCvsWithAi(hr, { query: 'React dev' });

    expect(res.aiRanked).toBe(false);
    expect(res.candidates.map((c) => [c.source, c.match])).toEqual([
      ['cv', 90],
      ['cv', 80],
      ['linkedin', null],
    ]);
  });
});
