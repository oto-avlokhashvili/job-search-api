/** The email that carries a quick-apply CV to the employer. Pure, so it can be tested without Brevo. */

export interface QuickApplyEmailInput {
  jobTitle: string;
  company: string;
  candidateName: string;
  candidateEmail: string;
  candidatePhone: string | null;
  siteUrl: string;
}

const esc = (s: string | null | undefined) =>
  (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const oneLine = (s: string, max: number) => {
  const line = s.replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
};

/** "CV - Nino Beridze.pdf": the employer sees whose CV it is, not our storage name. */
export function attachmentName(candidateName: string, originalName: string): string {
  const ext = (originalName.split('.').pop() || 'pdf').toLowerCase().replace(/[^a-z0-9]/g, '') || 'pdf';
  const name = oneLine(candidateName, 80).replace(/[\\/:*?"<>|]/g, '');
  return `CV - ${name || 'candidate'}.${ext}`;
}

export function buildQuickApplyEmail(input: QuickApplyEmailInput): { subject: string; html: string } {
  const title = oneLine(input.jobTitle, 150);
  const name = oneLine(input.candidateName, 100);
  // Employers often ask for the position in the subject
  const subject = `CV: ${title} — ${name}`;

  const contacts = [
    `<a href="mailto:${esc(input.candidateEmail)}">${esc(input.candidateEmail)}</a>`,
    input.candidatePhone ? esc(input.candidatePhone) : '',
  ]
    .filter(Boolean)
    .join(' · ');

  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#1f2937;max-width:600px">
  <p>გამარჯობა,</p>
  <p><b>${esc(name)}</b> გიგზავნით CV-ს ვაკანსიაზე <b>„${esc(title)}“</b>${input.company ? ` (${esc(oneLine(input.company, 150))})` : ''}. CV თან ერთვის წერილს.</p>
  <p>კონტაქტი: ${contacts}</p>
  <p>ამ წერილზე პასუხი პირდაპირ კანდიდატს მიუვა.</p>
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0 12px">
  <p style="font-size:12px;color:#6b7280">გაიგზავნა <a href="${esc(input.siteUrl)}" style="color:#6b7280">Job Up</a>-ის სწრაფი განაცხადით, კანდიდატის თანხმობით.<br>
  Sent with Job Up quick apply on behalf of the candidate. Reply to this email to contact them directly.</p>
</div>`;

  return { subject, html };
}
