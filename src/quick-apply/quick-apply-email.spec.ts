import { attachmentName, buildQuickApplyEmail, logoUrl } from './quick-apply-email';

describe('buildQuickApplyEmail', () => {
  const input = {
    jobTitle: 'German-Speaking   Customer Support',
    company: 'Acme & Co',
    candidateName: 'ნინო <b>ბერიძე</b>',
    candidateEmail: 'nino@example.com',
    candidatePhone: '+995 599 12 34 56',
    toEmail: 'hr@acme.ge',
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

  it('tells the employer why they got it, naming only Job Up', () => {
    const { html } = buildQuickApplyEmail(input);
    expect(html).toContain('You received this because hr@acme.ge is listed in the vacancy "German-Speaking Customer Support". ');
    expect(html).toContain('ეს წერილი მიიღეთ, რადგან მისამართი hr@acme.ge მითითებულია');
    expect(html).toContain('Job Up</a> quick apply');
    expect(html).not.toContain('affiliated');
  });

  it('shows the Job Up logo from the public site', () => {
    expect(buildQuickApplyEmail(input).html).toContain('<img src="https://jobup.ge/icons/logo-light.png"');
    expect(logoUrl('http://localhost:4200')).toBe('https://jobup.ge/icons/logo-light.png');
    expect(logoUrl('not a url')).toBe('https://jobup.ge/icons/logo-light.png');
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
