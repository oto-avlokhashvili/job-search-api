import { attachmentName, buildQuickApplyEmail } from './quick-apply-email';

describe('buildQuickApplyEmail', () => {
  const input = {
    jobTitle: 'German-Speaking   Customer Support',
    company: 'Acme & Co',
    candidateName: 'ნინო <b>ბერიძე</b>',
    candidateEmail: 'nino@example.com',
    candidatePhone: '+995 599 12 34 56',
    siteUrl: 'https://jobup.ge',
  };

  it('puts the position and the candidate in the subject', () => {
    expect(buildQuickApplyEmail(input).subject).toBe('CV: German-Speaking Customer Support — ნინო <b>ბერიძე</b>');
  });

  it('escapes what the candidate and the scraped vacancy typed', () => {
    const { html } = buildQuickApplyEmail(input);
    expect(html).toContain('ნინო &lt;b&gt;ბერიძე&lt;/b&gt;');
    expect(html).toContain('Acme &amp; Co');
    expect(html).not.toContain('<b>ბერიძე</b>');
  });

  it('lists the contacts, leaving out a missing phone', () => {
    expect(buildQuickApplyEmail(input).html).toContain('+995 599 12 34 56');
    expect(buildQuickApplyEmail({ ...input, candidatePhone: null }).html).not.toContain(' · ');
  });

  it('shortens a very long title', () => {
    expect(buildQuickApplyEmail({ ...input, jobTitle: 'x'.repeat(300) }).subject.length).toBeLessThan(200);
  });
});

describe('attachmentName', () => {
  it.each([
    ['ნინო ბერიძე', 'abc.PDF', 'CV - ნინო ბერიძე.pdf'],
    ['John/Doe', 'cv.docx', 'CV - JohnDoe.docx'],
    ['', 'noext', 'CV - candidate.noext'],
  ])('%s, %s → %s', (name, original, expected) => {
    expect(attachmentName(name, original)).toBe(expected);
  });
});
