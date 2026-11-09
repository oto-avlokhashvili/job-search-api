/**
 * Job categories for the list's category filter, worked out from the title alone. Computed once when
 * a job is saved and stored on it (JobEntity.categories), like the salary: the filter and the counts
 * read the column, so what is tested here is exactly what runs.
 *
 * Precision first: every keyword was checked against ~1,500 real titles from all portals (Nov 2026)
 * and kept only when the jobs it caught belonged in the category. Words that also mean something else
 * are left out or only used inside a phrase or with an exclusion, e.g. "ოპერატორ" (call centre, but
 * also packing and CNC operators), "ადმინისტრატორ" (bar, hotel, shop, clinic), "აგენტ" (hotline,
 * delivery), "analyst", "design", "engineer" (half the English ones are software). Titles that fit no
 * category ("ფილიალის მენეჯერი", "ოპერაციების მენეჯერი") get none and show only under "all categories".
 *
 * Term syntax: "word" matches the whole word; "stem*" matches words starting with it (Georgian
 * endings: "ბუღალტ*" → ბუღალტერი, ბუღალტრის); "re:<regex>" is a raw pattern (exclusions, anchors).
 * Matching is case-insensitive and starts at a word boundary, Georgian letters included.
 */

export interface JobCategory {
  key: string;
  terms: string[];
  /** Not assigned when the title is already in one of these ("Sales Engineer" is sales, "Software Engineer" IT) */
  unlessIn?: string[];
}

export const JOB_CATEGORIES: JobCategory[] = [
  {
    key: 'it',
    terms: [
      'linux*', 'observability', 'technical product owner',
      're:დეველოპერ(?!ულ)', 're:(?<!ოპერატორ-)პროგრამისტ', 'პროგრამული*', 'პროგრამირებ*', 'ტესტერ*',
      'სისტემური ადმინისტრატორ*', 'it', 'აიტი*', 'მონაცემთა ბაზ*', 'მონაცემთა ანალიტიკ*', 'მონაცემთა მეცნიერ*',
      'მონაცემთა ინჟინერ*', 'კიბერუსაფრთხოებ*', 'ინფორმაციული უსაფრთხოებ*', 'ინფორმაციული ტექნოლოგ*',
      'ქსელის ადმინისტრატორ*', 'ქსელის ინჟინერ*', 'ბიზნეს ანალიტიკოს*',
      'developer*', 'programmer', 'software', 'frontend', 'front-end', 'front end', 'backend', 'back-end',
      'back end', 'full stack', 'fullstack', 'full-stack', 'devops', 'mlops', 'qa', 'test automation',
      'data engineer*', 'data scien*', 'data analyst*', 'machine learning', 'ml engineer', 'ai engineer',
      'cybersecurity', 'cyber security', 'information security', 'security engineer', 'network engineer',
      'network administrator', 'system administrator', 'sysadmin', 'helpdesk', 'help desk', 'it support',
      'support engineer', 'android', 'ios', 'java', 'javascript', 'typescript', 'python', 'golang', '.net',
      'php', 'react', 'angular', 'node.js', 'kotlin', 'sql', 'dba', 'cloud engineer', 'solution architect',
      'solutions architect', 'software architect', 'scrum master', 'ui/ux', 'ux/ui', 'ux', 'business analyst',
    ],
  },
  {
    key: 'sales',
    terms: [
      'პრისეილერ*', 'პრისელერ*', 'პრისიელერ*', 'მერჩენდიაზერ*', 'продаж*', 'bdm',
      'გაყიდვ*', 're:(?<!სივრცის |ბიზნეს |სერვისის |სერვის |ეროვნული |ტექნოლოგ-)კონსულტანტ', 'მოლარე*',
      'გამყიდველ*', 'მერჩენდაიზერ*', 'პრომოუტერ*', 'ტელემარკეტ*', 'სავაჭრო წარმომადგენ*', 'მაღაზიის მენეჯერ*',
      'მაღაზიის ადმინისტრატორ*', 'დისტრიბუტორ*', 'უძრავი ქონების აგენტ*', 'სადაზღვევო აგენტ*',
      'sales', 'salesperson', 'cashier', 'merchandiser*', 'account executive', 'account manager',
      'business development', 'store manager', 'shop assistant', 'promoter', 'telesales', 'key account',
    ],
  },
  {
    key: 'finance',
    terms: [
      'ინკასატორ*', 'ინკასაცი*', 'შემფასებელ*', 'სასესხო*', 'საბანკო*', 'ბანკომატ*', 'ანგარიშსწორებ*',
      'ფინანს*', 'ბუღალტ*', 'საბუღალტრო*', 'აუდიტ*', 'ეკონომისტ*', 'საკრედიტო*', 'სესხ*', 'კრედიტ*',
      'დაკრედიტებ*', 'განვადებ*', 'ბანკირ*', 'ბანკის', 'ბანკში', 'ხაზინ*', 'საგადასახად*', 'გადასახად*',
      'აქტუარ*', 'ანდერაიტერ*', 'ინვესტიც*', 'საინვესტიციო*', 'საკასო*', 'სალარო*', 'რისკ*',
      'accountant*', 'accounting', 'finance', 'financial', 'audit*', 'credit', 'loan*', 'treasury',
      'financial controller', 'tax', 'payroll', 'actuar*', 'economist', 'bookkeep*', 'underwrit*',
      'investment*', 'banker', 'teller', 'fp&a', 'cfo', 'risk manager', 'risk analyst',
    ],
  },
  {
    key: 'customer-service',
    terms: [
      're:speaking operator', 'მომხმარებელთა ოპერაციების*', 'დისტანციური მომსახურების*', 'საინფორმაციო ცენტრ*', 'customer expert',
      'ქოლ*', 'კონტაქტ ცენტრ*', 'ცხელი ხაზ*', 'ზარების ოპერატორ*', 'დიჯითალ ოპერატორ*', 'live ოპერატორ*',
      're:[ა-ჰ]+ენოვანი ოპერატორ', 'კლიენტთა მომსახურ*', 'მომხმარებელთა მომსახურ*', 'კლიენტთა მრჩეველ*',
      'მომხმარებელთა მრჩეველ*', 'მომხმარებელზე ზრუნვ*', 'მომხმარებელთა მხარდაჭერ*', 'ციფრული მხარდაჭერ*',
      'მხარდაჭერის ოპერატორ*', 'სივრცის კონსულტანტ*',
      'customer service', 'customer support', 'customer care', 'customer success', 'customer experience',
      'client service*', 'call center', 'call centre', 'contact center', 'support agent', 'support specialist',
      'online support', 'chat support', 'technical support',
    ],
  },
  {
    key: 'admin',
    terms: [
      'ხელმძღვანელის ასისტენტ*', 'ტალანტების მოზიდვ*',
      're:(?<!ბექ-|ბექ |back-)ოფისის', 'ოფის-მენეჯერ*', 'ადმინისტრაციულ*', 'პირადი ასისტენტ*',
      'აღმასრულებელი ასისტენტ*', 're:^მენეჯერის ასისტენტ', 'დირექტორის ასისტენტ*', 'დირექტორის თანაშემწე*',
      'მდივან*', 'თარჯიმ*', 'კადრების*', 'რეკრუტერ*', 'პერსონალის შერჩ*', 'პერსონალის მართვ*',
      'ადამიანური რესურს*', 're:(?<![/$\\d])hr(?![a-z0-9ა-ჿ])', 'საქმისმწარმოებ*', 'საქმის მწარმოებ*',
      'არქივ*', 'რესეფშენ*', 'აღრიცხვის ოპერატორ*',
      're:(?<!front )office manager', 'office administrator', 'administrative', 'admin assistant',
      'executive assistant', 'personal assistant', 'secretary', 'translator', 'interpreter', 'recruiter',
      'recruitment', 'talent acquisition', 'human resources', 'receptionist', 'data entry',
    ],
  },
  {
    key: 'medicine',
    terms: [
      'რევმატოლოგ*', 'დერმატოლოგ*', 'ენდოკრინოლოგ*', 'ონკოლოგ*', 'უროლოგ*', 'ტრავმატოლოგ*', 'ორთოპედ*', 'გასტროენტეროლოგ*', 'ალერგოლოგ*', 'ოტორინოლარინგოლოგ*', 'მეან*', 'ბებიაქალ*', 'პაციენტ*', 'rn', 'lpn',
      'ექიმ*', 'ექთან*', 'მედდ*', 'ფარმაცევტ*', 'პროვიზორ*', 'სამედიცინო*', 'კლინიკ*', 'სტომატოლოგ*',
      're:(?<!ხარისხის )ლაბორანტ', 'ლაბორატორიის მედდ*', 'რადიოლოგ*', 'ანესთეზიოლოგ*', 'ფიზიოთერაპ*',
      'ფსიქოლოგ*', 'ვეტერინარ*', 'რეზიდენტ*', 'სანიტარ*', 'ფლებოტომ*', 'რენტგენ*', 'ექოსკოპ*', 'ოფთალმოლოგ*',
      'კარდიოლოგ*', 'გინეკოლოგ*', 'პედიატრ*', 'ნევროლოგ*', 'ქირურგ*', 'თერაპევტ*', 'ფარმაცი*', 'აფთიაქ*',
      'doctor', 'physician', 'nurse', 'nursing', 'medical', 'clinic*', 'dentist', 'dental', 'pharmac*',
      'radiolog*', 'physiotherap*', 'psycholog*', 'therapist', 'veterinar*', 'pediatric*', 'surgeon',
      'phlebotom*', 'caregiver',
    ],
  },
  {
    key: 'hospitality',
    terms: [
      'შეფი', 'შეფის', 'სუ შეფ*', 'შეფმზარეულ*', 'შეფ-მზარეულ*', 'მიქსოლოგ*', 'ბელბოი*', 'კაფე*', 'კაფის',
      'მზარეულ*', 'ბარმენ*', 'მიმტან*', 'ოფიციანტ*', 'ბარისტა*', 'სასტუმრო*', 'ტურიზმ*', 'ტურისტ*',
      'ტუროპერატორ*', 're:(?<!ბიზნეს )გიდი(?![ა-ჰ])', 'რესტორ*', 'კონდიტერ*', 'საკონდიტრო*', 'მცხობელ*',
      'პიცა*', 'ჰოსტეს*', 'სომელიე*', 'სამზარეულო*', 'ჭურჭლის მრეცხავ*', 'სტიუარდ*', 'კაზინო*', 'კრუპიე*',
      'ბანქო*', 'სლოტ*', 'ბარის ადმინისტრატორ*', 'დარბაზის ადმინისტრატორ*',
      'chef', 'cook', 'sous chef', 'bartender', 'waiter', 'waitress', 'barista', 'hotel*', 'housekeep*',
      'touris*', 'tour guide', 'restaurant*', 'pastry', 'baker', 'hostess', 'front desk', 'concierge',
      'kitchen', 'dishwasher', 'steward', 'casino', 'croupier', 'sommelier', 'room attendant', 'f&b',
      'food and beverage',
    ],
  },
  {
    key: 'marketing',
    terms: [
      'advertising', 'creator*',
      'მარკეტინგ*', 'მარკეტოლოგ*', 'ბრენდ მენეჯერ*', 'ბრენდის მენეჯერ*', 'ბრენდინგ*', 'კონტენტ*', 'კოპირაიტ*',
      'დიზაინერ*', 'გრაფიკული დიზაინ*', 'ფოტოგრაფ*', 'ვიდეომონტაჟ*', 'ვიდეო მონტაჟ*', 'ვიდეოგრაფ*',
      'მემონტაჟე*', 'ჟურნალისტ*', 'რედაქტორ*', 'სოციალური მედი*', 'სოციალური ქსელ*', 'სარეკლამო*',
      'რეკლამის მენეჯერ*', 'პიარ*', 'კომუნიკაციებ*', 'დასურათებ*', 'ტარგეტოლოგ*',
      'marketing', 'marketer', 'smm', 'brand*', 'content', 'copywrit*', 'designer', 'graphic design*',
      'photograph*', 'videographer', 'journalist', 'editor', 'social media', 'seo', 'sem', 'ppc',
      'public relations', 'pr', 'communications', 'user acquisition', 'performance marketing', 'animator',
      'motion design*', 'illustrator',
    ],
  },
  {
    key: 'logistics',
    terms: [
      'ფიქერ*', 'picker', 'მომმარაგებელ*',
      'მძღოლ*', 'კურიერ*', 'ლოგისტ*', 'ლოჯისტ*', 'საწყობ*', 'ექსპედიტორ*', 'მტვირთავ*',
      're:(?<!მომსახურების )მიწოდებ', 'შესყიდვ*', 'დისტრიბუცი*', 'ტრანსპორტ*', 'გადაზიდვ*', 'საბაჟო*',
      'დეკლარანტ*', 'ფორკლიფტ*', 'დისპეჩერ*', 'ავტოპარკ*', 'ინვენტარიზაც*',
      'driver', 'courier', 'logistic*', 'warehouse', 'loader', 'supply chain', 'procurement', 'purchasing',
      'distribution', 'transport*', 'freight', 'shipping', 'delivery driver', 'dispatch*', 'forklift',
      'customs', 'fleet',
    ],
  },
  {
    key: 'engineering',
    unlessIn: ['it', 'medicine', 'sales'],
    terms: [
      'ავეჯის ამწყობ*', 'ხარჯთაღმრიცხველ*', 'ხარჯთაღრიცხვ*', 'lineman', 'ტექნიკური მომსახურების*', 'ტექნიკური სამსახურის*',
      'ინჟინერ*', 'მშენებ*', 'სამშენებლო*', 'ელექტრიკ*', 'ელექტრომონტ*', 'ელექტროინჟინერ*', 'სანტექნიკ*',
      'შემდუღებ*', 'ტექნიკოს*', 'მექანიკ*', 'ხელოსან*', 'არქიტექტ*', 'პრორაბ*', 'ზეინკალ*', 'მონტაჟნიკ*',
      'ინსტალატორ*', 'შემკეთებ*', 'ვულკანიზაც*', 'ხარატ*', 'დურგალ*', 'მღებავ*', 'ბეტონ*', 'ამწის*',
      'ექსკავატორ*', 'გეოდეზ*', 'ტოპოგრაფ*', 'ენერგეტიკ*', 'საამქრო*', 're:(?<!საქმის )წარმოებ',
      'საწარმოო*', 'დაფასოებ*', 'პომპის*', 'ხარისხის კონტროლ*', 'კონდიციონერ*',
      'civil engineer*', 'electrical engineer*', 'mechanical engineer*', 'industrial engineer*',
      'structural engineer*', 'process engineer*', 'design engineer*', 'site engineer*', 'supply engineer*',
      'construction', 'electrician', 'electrical', 'plumb*', 'welder', 'technician', 'mechanic*', 'architect*',
      'hvac', 'maintenance technician', 'maintenance engineer', 'site manager', 'foreman', 'manufactur*',
      'installer', 'carpenter', 'mep', 'surveyor', 'quality control', 'cnc',
    ],
  },
  {
    key: 'education',
    terms: [
      'მწვრთნელ*', 'სასწავლო*',
      'მასწავლებ*', 'პედაგოგ*', 'ლექტორ*', 'ტრენერ*', 'რეპეტიტორ*', 'აღმზრდელ*', 'ძიძა*', 'განათლებ*',
      'მენტორ*', 'საბავშვო ბაღ*', 'ლოგოპედ*', 'დეფექტოლოგ*', 'ტრენინგ*', 'ინსტრუქტორ*',
      'teacher', 'lecturer', 'lector', 'trainer', 'tutor', 'instructor', 'educat*', 'nanny', 'professor',
      'mentor', 'teaching', 'kindergarten', 'academic',
    ],
  },
  {
    key: 'legal',
    terms: [
      'იურისტ*', 'იურიდიულ*', 'ადვოკატ*', 'ნოტარ*', 'შესაბამისობის*', 'სამართალ*', 'სამართლებრივ*',
      'აღსრულებ*', 'იურისკონსულტ*',
      'lawyer', 'legal', 'attorney', 'notary', 'compliance', 'paralegal', 'legal counsel', 'general counsel',
      'solicitor', 'aml',
    ],
  },
  {
    key: 'services',
    terms: [
      'უსაფრთხოების სამსახურის თანამშრომ*', 'დაცვის ოფიცერ*', 'ფიზიკური უსაფრთხოებ*', 'ვიდეომონიტორინგ*',
      'დამლაგებ*', 'დასუფთავებ*', 'დიასახლის*', 'დაცვის თანამშრომ*', 'დაცვის აგენტ*', 'დაცვის სამსახურ*',
      'უსაფრთხოების თანამშრომ*', 'დარაჯ*', 'მცველ*', 'კოსმეტოლოგ*', 'სტილისტ*', 'მანიკ*', 'პედიკ*', 'ბარბერ*',
      'პარიკმახ*', 'ვიზაჟ*', 'ესთეტიკ*', 'მასაჟისტ*', 'ფიტნეს*', 'მებაღ*', 'ავტომრეცხავ*', 'სამრეცხაო*',
      'cleaner', 'cleaning', 'janitor', 'security guard', 'security officer', 'cosmetolog*', 'stylist',
      'beauty', 'barber', 'hairdresser', 'manicur*', 'massage', 'fitness', 'gym', 'personal trainer',
      'gardener',
    ],
  },
];

export const JOB_CATEGORY_KEYS = JOB_CATEGORIES.map((c) => c.key);

// Latin and Georgian letters and digits: what counts as "inside a word"
const WORD = 'a-z0-9ა-ჿ';

function termPattern(term: string): string {
  if (term.startsWith('re:')) return `(?<![${WORD}])(?:${term.slice(3)})`;
  const stem = term.endsWith('*');
  const text = (stem ? term.slice(0, -1) : term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return `(?<![${WORD}])${text}${stem ? '' : `(?![${WORD}])`}`;
}

const MATCHERS = JOB_CATEGORIES.map((c) => ({
  ...c,
  regex: new RegExp(c.terms.map(termPattern).join('|'), 'iu'),
}));

/** Category keys for a job title, in JOB_CATEGORIES order; [] when none fits. */
export function categorizeJob(title: string | null | undefined): string[] {
  const text = (title || '').toLowerCase();
  if (!text) return [];
  const found = MATCHERS.filter((c) => c.regex.test(text)).map((c) => c.key);
  return found.filter((key) => {
    const unless = MATCHERS.find((c) => c.key === key)?.unlessIn;
    return !unless?.some((other) => found.includes(other));
  });
}

/** Stored form: ",it,sales," so one category is matched with LIKE '%,it,%'; '' = none fits. */
export function toCategoryColumn(categories: string[]): string {
  return categories.length ? `,${categories.join(',')},` : '';
}

/** For audits and tests: which terms of a category match a title. */
export function matchingTerms(key: string, title: string): string[] {
  const category = JOB_CATEGORIES.find((c) => c.key === key);
  if (!category) return [];
  const text = title.toLowerCase();
  return category.terms.filter((t) => new RegExp(termPattern(t), 'iu').test(text));
}
