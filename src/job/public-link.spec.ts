import { jobPageUrl, publicJobLink, stripHiddenLinks } from './public-link';

class FakeEntity {
  constructor(public id: number, public vacancy: string, public link: string) {}
}

describe('public-link', () => {
  it('keeps LinkedIn and Job Up links only', () => {
    expect(publicJobLink('https://ge.linkedin.com/jobs/view/123')).toBe('https://ge.linkedin.com/jobs/view/123');
    expect(publicJobLink('https://www.linkedin.com/jobs/view/123')).toBe('https://www.linkedin.com/jobs/view/123');
    expect(publicJobLink('https://jobup.ge/vacancies/5')).toBe('https://jobup.ge/vacancies/5');
    expect(publicJobLink('https://jobs.ge/ge/?view=jobs&id=1')).toBeNull();
    expect(publicJobLink('https://www.hr.ge/announcement/1')).toBeNull();
    expect(publicJobLink('https://myjobs.ge/ka/vacancy/1')).toBeNull();
    expect(publicJobLink('https://fake-linkedin.com.evil.ge/x')).toBeNull();
    expect(publicJobLink(null)).toBeNull();
  });

  it('strips hidden links from vacancy-shaped objects, entities and nested lists, without mutating', () => {
    const job = { id: 1, vacancy: 'Dev', company: 'X', link: 'https://jobs.ge/ge/?id=1' };
    const li = new FakeEntity(2, 'QA', 'https://www.linkedin.com/jobs/view/2');
    const ent = new FakeEntity(3, 'PM', 'https://awork.ge/job/3');
    const out = stripHiddenLinks({ data: [job, li, ent], total: 3 });
    expect(out.data[0].link).toBeNull();
    expect(out.data[1].link).toBe('https://www.linkedin.com/jobs/view/2');
    expect(out.data[2].link).toBeNull();
    expect(job.link).toBe('https://jobs.ge/ge/?id=1');
    expect(ent.link).toBe('https://awork.ge/job/3');
  });

  it('shows an hr.ge link only when the vacancy names no email to quick-apply to', () => {
    const hr = 'https://hr.ge/announcement/502505';
    const out = stripHiddenLinks([
      { id: 1, vacancy: 'მოლარე', link: hr, applyEmail: '' },
      { id: 2, vacancy: 'მოლარე', link: hr, applyEmail: 'hr@company.ge' },
      { id: 3, vacancy: 'მოლარე', link: hr, applyEmail: null, description: 'განაცხადი hr.ge-ზე' },
      { id: 4, vacancy: 'მოლარე', link: hr, applyEmail: null, description: 'CV: jobs@company.ge' },
      { id: 5, vacancy: 'მოლარე', link: hr },
      { id: 6, vacancy: 'მოლარე', link: 'https://jobs.ge/ge/?id=1', applyEmail: '' },
      { id: 7, vacancy: 'მოლარე', link: 'https://cv.ge/announcement/1', applyEmail: '' },
    ]);
    expect(out.map((j) => j.link)).toEqual([hr, null, hr, null, null, null, null]);
  });

  it('leaves non-vacancy links alone unless they point at a portal', () => {
    const out = stripHiddenLinks([
      { link: 'https://jobup.ge/interview/abc' },
      { link: 'https://meet.google.com/abc-defg-hij' },
      { link: 'https://hr.ge/announcement/9', count: 2 },
    ]);
    expect(out[0].link).toBe('https://jobup.ge/interview/abc');
    expect(out[1].link).toBe('https://meet.google.com/abc-defg-hij');
    expect(out[2].link).toBeNull();
  });

  it('sends notifications to the Job Up page for hidden links', () => {
    expect(jobPageUrl({ id: 7, link: 'https://jobs.ge/ge/?id=7' })).toMatch(/\/vacancies\/7$/);
    expect(jobPageUrl({ id: 8, link: 'https://www.linkedin.com/jobs/view/8' })).toBe('https://www.linkedin.com/jobs/view/8');
  });
});
