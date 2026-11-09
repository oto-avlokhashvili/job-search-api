import { categorizeJob, JOB_CATEGORIES, toCategoryColumn } from './job-category';

// Real titles from all portals (Nov 2026). The "not" cases are words that used to put jobs in the
// wrong category; they guard the precision-first rule when keywords are added later.

describe('categorizeJob', () => {
  it.each([
    // IT
    ['Senior Full Stack Developer', ['it']],
    ['IT მხარდაჭერის უმცროსი სპეციალისტი', ['it']],
    ['Java Backend Engineer (all genders)', ['it']],
    ['DevOps/MLOps წამყვანი ინჟინერი', ['it']],
    ['მონაცემთა ბაზების სპეციალისტი', ['it']],
    ['Linux Administrator (Ops)', ['it']],
    ['Sr. AI Solution Architect', ['it']],
    // Sales
    ['გაყიდვების მენეჯერი', ['sales']],
    ['მოლარე-კონსულტანტი', ['sales']],
    ['მერჩენდაიზერი / Samsung', ['sales']],
    ['სავაჭრო წარმომადგენელი - პრისეილერი (თბილისი)', ['sales']],
    ['Digital კონსულტანტი - ბათუმი', ['sales']],
    ['Менеджер по продажам', ['sales']],
    // Finance and banking
    ['მთავარი ბუღალტერი', ['finance']],
    ['სესხის ოფიცერი - ქობულეთი', ['finance']],
    ['ბიზნეს დაკრედიტების ექსპერტი (ეტაპი II) - ბოლნისის ს/ც 2', ['finance']],
    ['RB ბანკირი - დიდი დიღმის ს/ც1', ['finance']],
    ['რეზერვი ოქროს ლომბარდის ექსპერტ-შემფასებელი', ['finance']],
    ['Credit Risk Manager', ['finance']],
    // Customer service
    ['ქოლ-ცენტრის ოპერატორი', ['customer-service']],
    ['კლიენტთა მრჩეველი გორის სერვისცენტრში', ['customer-service']],
    ['გერმანულენოვანი ოპერატორი', ['customer-service']],
    ['დიჯითალ ოპერატორი - რუსთავი', ['customer-service']],
    ['სივრცის კონსულტანტი - რუსთავის ს/ც #6', ['customer-service']],
    ['Customer Support Agent with Ukrainian', ['customer-service']],
    // Admin and HR
    ['ოფისის მენეჯერი', ['admin']],
    ['პერსონალის შერჩევის სპეაციალისტი ( რეკრუტერი)', ['admin']],
    ['HR მენეჯერი', ['admin']],
    ['მენეჯერის ასისტენტი', ['admin']],
    ['აღრიცხვის ოპერატორი - გორი', ['admin']],
    // Medicine
    ['ოჯახის ექიმი', ['medicine']],
    ['ფლებოტომისტი/ლაბორატორიის მედდა', ['medicine']],
    ['ენისა და მეტყველების თერაპევტი', ['medicine']],
    ['ბავშვთა და მოზრდილთა რევმატოლოგი', ['medicine']],
    ['ფარმაცევტი', ['medicine']],
    // Hospitality
    ['სუშის მზარეულის დამხმარე', ['hospitality']],
    ['ბარმენი, მიმტანი', ['hospitality']],
    ['უმცროსი სუ შეფი', ['hospitality']],
    ['დარბაზის ადმინისტრატორი', ['hospitality']],
    ['ბანქოს მჩეხავი', ['hospitality']],
    // Marketing
    ['ციფრული მარკეტინგის სპეციალისტი/ტარგეტოლოგი', ['marketing']],
    ['გრაფიკული დიზაინერი', ['marketing']],
    ['სოციალური მედიის მენეჯერი', ['marketing']],
    // Logistics
    ['C კატეგორიის მძღოლი', ['logistics']],
    ['საწყობის თანამშრომელი (ბათუმი)', ['logistics']],
    ['ლოჯისტიკის კოორდინატორი', ['logistics']],
    ['შესყიდვების მენეჯერი', ['logistics']],
    // Engineering
    ['ელექტრიკოსი', ['engineering']],
    ['მშენებელი ინჟინერი', ['engineering']],
    ['საწარმოო ხაზის უნივერსალური ოპერატორი', ['engineering']],
    ['Electrical Design Engineer', ['engineering']],
    // Education, legal, services
    ['ინგლისური ენის მასწავლებელი', ['education']],
    ['ფეხბურთის მწვრთნელი', ['education']],
    ['იურისტის ასისტენტი', ['legal']],
    ['დამლაგებელი', ['services']],
    ['დიასახლისი / დამლაგებელი', ['services']],
    ['ვიდეომონიტორინგის სპეციალისტი', ['services']],
    // Titles with two real roles get both
    ['მძღოლი-დისტრიბუტორი', ['sales', 'logistics']],
    ['ლიბერთი ბანკის მობილური ფილიალის მოლარე-ოპერატორი - ვანი', ['sales', 'finance']],
    ['სასტუმროს დიასახლისი', ['hospitality', 'services']],
  ])('%s → %j', (title, expected) => {
    expect(categorizeJob(title)).toEqual(expected);
  });

  describe('keeps out words that mean something else', () => {
    it.each([
      // "ოპერატორ" alone is not a call centre
      ['დაფასოების ოპერატორი', 'customer-service'],
      ['CNC რუტერის ოპერატორ-პროგრამისტი', 'customer-service'],
      ['Forklift Operator', 'customer-service'],
      ['მოლარე-ოპერატორი', 'customer-service'],
      // "ადმინისტრატორ" alone is not office work
      ['ბარის ადმინისტრატორი', 'admin'],
      ['სასტუმროს ადმინისტრატორი', 'admin'],
      ['სისტემური ადმინისტრატორი', 'admin'],
      // Agents and assistants of other departments
      ['გერმანულენოვანი ცხელი ხაზის აგენტი', 'sales'],
      ['ლოჯისტიკის მენეჯერის ასისტენტი', 'admin'],
      ['რეზერვი კადრი', 'admin'],
      ['Text Alignment Specialist | $24/hr Remote', 'admin'],
      ['საერთაშორისო სტუდენტთა რეკრუტირების ცენტრის მენეჯერი', 'admin'],
      // IT look-alikes
      ['საკონტაქტო ქსელის ელექტრომონტიორი', 'it'],
      ['დეველოპერული პროექტის გაყიდვების მრჩეველი', 'it'],
      ['Claims Attorney, Cyber', 'it'],
      ['SME საკრედიტო ანალიტიკოსი - ქუთაისი', 'it'],
      ['Tech Lead – Retail and E-commerce', 'sales'],
      // Labs, brands, ads, design and production outside their field
      ['ანაზღაურებადი სტაჟირება ბეტონის ქარხნის ლაბორატორიაში', 'medicine'],
      ['ხარისხის ლაბორანტ-მაკონტროლებელი', 'medicine'],
      ['Customer Support Specialist in Healthcare', 'medicine'],
      ['კონსულტანტი / სამსუნგის ბრენდის ამბასადორი', 'marketing'],
      ['გარე რეკლამის ხელოსანი', 'marketing'],
      ['Electrical Design Engineer', 'marketing'],
      ['HR-მენეჯერი (საქმის წარმოების ნაწილში -მონიტორინგის სპეციალისტი)', 'engineering'],
      ['მომსახურების მიწოდების მენეჯერი', 'logistics'],
      ['Senior Inventory Accountant', 'logistics'],
      ['ბიზნეს გიდი - დიდუბის ფილიალი', 'hospitality'],
      ['SOLO ლაუნჯის სერვისის მენეჯერი', 'hospitality'],
      ['ფილიალის დიასახლისი', 'hospitality'],
      ['Admissions Counselor', 'legal'],
      ['ტრენინგი - ლაბორატორიული ბიოუსაფრთხოება ISO 15190 სტანდარტის შესაბამისად', 'legal'],
      ['ყუთების ამწყობი', 'engineering'],
      // Engineering yields to the job's real field
      ['Senior Sales Engineer- Partner', 'engineering'],
      ['Frontend / UI ინჟინერი – დისტანციური პროექტი', 'engineering'],
      ['რენტგენის ტექნიკოსი', 'engineering'],
      ['Engineering Manager', 'engineering'],
    ])('%s is not %s', (title, category) => {
      expect(categorizeJob(title)).not.toContain(category);
    });
  });

  it.each([
    'ფილიალის მენეჯერი - ბათუმი',
    'ოპერაციების მენეჯერი',
    'უნივერსალური რეზერვი რუსთავის სერვისცენტრში',
    'Operations Supervisor - 3rd Shift',
    'მენეჯერი',
  ])('leaves generic "%s" uncategorized', (title) => {
    expect(categorizeJob(title)).toEqual([]);
  });

  it('handles empty titles', () => {
    expect(categorizeJob('')).toEqual([]);
    expect(categorizeJob(null)).toEqual([]);
  });

  it('only returns known keys', () => {
    const keys = JOB_CATEGORIES.map((c) => c.key);
    expect(categorizeJob('გაყიდვების მენეჯერი / მძღოლი / ბუღალტერი').every((k) => keys.includes(k))).toBe(true);
  });
});

describe('toCategoryColumn', () => {
  it('wraps keys in commas so LIKE "%,it,%" matches one category exactly', () => {
    expect(toCategoryColumn(['sales', 'logistics'])).toBe(',sales,logistics,');
    expect(toCategoryColumn([])).toBe('');
  });
});
