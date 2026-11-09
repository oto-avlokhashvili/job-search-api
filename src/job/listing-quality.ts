/**
 * Rules that keep the public job list trustworthy: which LinkedIn results are really in Georgia
 * (the country) and how titles are cleaned. Shared by the LinkedIn scraper, the merge and the cleanup.
 */

// ── Titles ─────────────────────────────────────────────────────────────

/**
 * Removes employers' internal requisition ids from a title: "HVAC Instructor (65897)" → "HVAC Instructor".
 * Only bracketed or #-prefixed runs of 4+ digits go; years in text ("2026 წლის") and salaries stay.
 */
export function cleanJobTitle(title: string): string {
  if (!title) return title;
  const cleaned = title
    .replace(/\s*[(\[]\s*(?:#|id[:\s#]*|req[:\s#.-]*)?\d{4,}\s*[)\]]/gi, '')
    .replace(/\s+#\d{4,}\b/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/[\s\-–—|,]+$/, '')
    .trim();
  return cleaned || title.trim();
}

// ── Georgia (the country) vs. Georgia (the US state) ─────────────────────

/** Georgian cities, towns and regions as LinkedIn and the portals spell them (English and Georgian). */
const GEORGIAN_PLACES = [
  'tbilisi', 'batumi', 'kutaisi', 'rustavi', 'gori', 'zugdidi', 'poti', 'telavi', 'akhaltsikhe',
  'ozurgeti', 'mtskheta', 'sighnaghi', 'signagi', 'kobuleti', 'khashuri', 'samtredia', 'senaki',
  'zestafoni', 'marneuli', 'kaspi', 'borjomi', 'bakuriani', 'gudauri', 'mestia', 'kvareli',
  'gurjaani', 'sagarejo', 'akhalkalaki', 'tskhaltubo', 'chiatura', 'ambrolauri', 'lagodekhi',
  'adjara', 'ajara', 'imereti', 'kakheti', 'kvemo kartli', 'shida kartli', 'samegrelo', 'guria',
  'svaneti', 'samtskhe',
  'თბილისი', 'ბათუმი', 'ქუთაისი', 'რუსთავი', 'გორი', 'ზუგდიდი', 'ფოთი', 'თელავი', 'ახალციხე',
  'ოზურგეთი', 'მცხეთა', 'სიღნაღი', 'ქობულეთი', 'ხაშური', 'სამტრედია', 'სენაკი', 'ზესტაფონი',
  'მარნეული', 'ბორჯომი', 'ბაკურიანი', 'გუდაური', 'მესტია',
];

/** Signals that a "Georgia" posting is in the United States. */
const US_MARKERS = [
  /united states/i,
  /\busa\b/i,
  /,\s*ga\b/i,                     // "Atlanta, GA"
  /(?:-|–|—)\s*ga\s*(?:-|–|—)/i,   // "Payroll Specialist - GA - On site"
  /\b(?:atlanta|savannah|augusta|macon|athens|alpharetta|marietta|roswell|sandy springs|columbus|albany|valdosta|duluth|kennesaw|lawrenceville|norcross|peachtree)\b/i,
];

/**
 * US employers seen posting US-state jobs into the Georgia feed. A safety net: their postings are
 * rejected even when the location happens to name a Georgian place.
 */
const US_COMPANIES = [
  'uei college', 'acadia healthcare', 'dhl ecommerce', 'centene', 'vensure', 'tokio marine',
  'intervarsity', 'greenleaf behavioral', 'john deere', 'emory', 'piedmont healthcare',
  'northside hospital', 'wellstar', 'home depot', 'delta air lines', 'coca-cola consolidated',
];

/**
 * True when a LinkedIn posting is in Georgia the country. LinkedIn writes both countries as
 * "Georgia", so a bare "Georgia" is rejected: the location must name a Georgian city or region.
 */
export function isGeorgianLinkedinJob(job: { location?: string | null; vacancy?: string | null; company?: string | null }): boolean {
  const location = (job.location || '').trim();
  const vacancy = job.vacancy || '';
  const company = (job.company || '').toLowerCase();

  if (US_MARKERS.some((re) => re.test(location) || re.test(vacancy))) return false;
  if (US_COMPANIES.some((name) => company.includes(name))) return false;

  const loc = location.toLowerCase();
  return GEORGIAN_PLACES.some((place) => loc.includes(place));
}
