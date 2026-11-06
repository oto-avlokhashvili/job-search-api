/**
 * Georgian universities, by the names the HR university filter offers. The CV summary prompt asks
 * the AI to write a Georgian university by exactly this name, so the filter matches it. `aliases`
 * are other ways it's written (English spellings, the Georgian name, abbreviations): the AI uses
 * them to recognize the university, and LinkedIn searches the English ones.
 * Keep the names in sync with the frontend's copy (job-search-app: Core/Constants/georgian-universities.ts).
 */
export const GEORGIAN_UNIVERSITIES: { name: string; aliases?: string[] }[] = [
  // State
  {
    name: 'Akaki Tsereteli State University',
    aliases: ['Kutaisi State University', 'აკაკი წერეთლის სახელმწიფო უნივერსიტეტი', 'ATSU', 'აწსუ'],
  },
  {
    name: 'Akhaltsikhe State Education University',
    aliases: ['Samtskhe-Javakheti State University', 'სამცხე-ჯავახეთის სახელმწიფო უნივერსიტეტი', 'ახალციხის სახელმწიფო'],
  },
  { name: 'Batumi Art Teaching University', aliases: ['ბათუმის ხელოვნების სასწავლო უნივერსიტეტი'] },
  {
    name: 'Batumi Shota Rustaveli State University',
    aliases: ['Shota Rustaveli State University', 'შოთა რუსთაველის სახელმწიფო უნივერსიტეტი', 'BSU', 'ბსუ'],
  },
  { name: 'Batumi State Maritime Academy', aliases: ['ბათუმის სახელმწიფო საზღვაო აკადემია', 'BSMA'] },
  { name: 'Georgian Technical University', aliases: ['საქართველოს ტექნიკური უნივერსიტეტი', 'GTU', 'სტუ'] },
  { name: 'Gori State Teaching University', aliases: ['Gori State University', 'გორის სახელმწიფო'] },
  { name: 'Ilia State University', aliases: ['ილიას სახელმწიფო უნივერსიტეტი', 'ილიაუნი', 'Iliauni'] },
  {
    name: 'International School of Economics at Tbilisi State University',
    aliases: ['International School of Economics at TSU', 'ISET', 'ეკონომიკის საერთაშორისო სკოლა'],
  },
  { name: 'Shota Meskhia Zugdidi State University', aliases: ['Zugdidi State University', 'ზუგდიდის სახელმწიფო'] },
  { name: 'Sokhumi State University', aliases: ['სოხუმის სახელმწიფო უნივერსიტეტი'] },
  {
    name: 'Tbilisi Ivane Javakhishvili State University',
    aliases: [
      'Ivane Javakhishvili Tbilisi State University',
      'Tbilisi State University',
      'თბილისის სახელმწიფო უნივერსიტეტი',
      'ივანე ჯავახიშვილის სახელობის',
      'TSU',
      'თსუ',
    ],
  },
  { name: 'Tbilisi State Academy of Arts', aliases: ['თბილისის სახელმწიფო სამხატვრო აკადემია', 'სამხატვრო აკადემია'] },
  { name: 'Tbilisi State Medical University', aliases: ['თბილისის სახელმწიფო სამედიცინო უნივერსიტეტი', 'TSMU', 'თსსუ'] },
  {
    name: 'Tbilisi Vano Sarajishvili State Conservatory',
    aliases: ['Tbilisi State Conservatoire', 'Tbilisi State Conservatory', 'სახელმწიფო კონსერვატორია'],
  },
  {
    name: 'Telavi Iakob Gogebashvili State University',
    aliases: ['Telavi State University', 'თელავის სახელმწიფო უნივერსიტეტი', 'იაკობ გოგებაშვილის სახელობის'],
  },
  {
    name: 'Shota Rustaveli University of Theater and Cinema',
    aliases: ['Shota Rustaveli Theatre and Film University', 'თეატრისა და კინოს'],
  },
  // Private
  { name: 'Alterbridge University', aliases: ['ალტერბრიჯ'] },
  { name: 'Agricultural University of Georgia', aliases: ['საქართველოს აგრარული უნივერსიტეტი', 'აგრარული უნივერსიტეტი'] },
  { name: 'American University for Humanities Tbilisi Campus', aliases: ['American University for Humanities'] },
  { name: 'BAU International University, Batumi', aliases: ['BAU International University'] },
  { name: 'Business and Technology University', aliases: ['ბიზნესისა და ტექნოლოგიების უნივერსიტეტი', 'BTU'] },
  { name: 'Caucasus International University', aliases: ['კავკასიის საერთაშორისო უნივერსიტეტი'] },
  { name: 'Central Global University' },
  { name: 'Caucasus University', aliases: ['კავკასიის უნივერსიტეტი'] },
  { name: 'David Aghmashenebeli University of Georgia', aliases: ['დავით აღმაშენებლის სახელობის'] },
  { name: 'David Tvildiani Medical University', aliases: ['დავით ტვილდიანის სამედიცინო უნივერსიტეტი'] },
  { name: 'East European University', aliases: ['აღმოსავლეთ ევროპის უნივერსიტეტი'] },
  { name: 'European University', aliases: ['ევროპის უნივერსიტეტი'] },
  { name: 'Free University of Tbilisi', aliases: ['Free University', 'Freeuni', 'თავისუფალი უნივერსიტეტი'] },
  { name: 'Georgian American University', aliases: ['ქართულ-ამერიკული უნივერსიტეტი', 'GAU'] },
  { name: 'Georgian Aviation University', aliases: ['საქართველოს საავიაციო უნივერსიტეტი'] },
  { name: 'Georgian International University', aliases: ['საქართველოს საერთაშორისო უნივერსიტეტი'] },
  { name: 'Georgian Institute of Public Affairs', aliases: ['საქართველოს საზოგადოებრივ საქმეთა ინსტიტუტი', 'GIPA'] },
  { name: 'Georgian National University SEU', aliases: ['Georgian National University', 'საქართველოს ეროვნული უნივერსიტეტი', 'SEU'] },
  { name: 'Grigol Robakidze University', aliases: ['გრიგოლ რობაქიძის სახელობის უნივერსიტეტი', 'გრიგოლ რობაქიძის'] },
  { name: 'Guram Tavartkiladze Tbilisi Teaching University', aliases: ['გურამ თავართქილაძის'] },
  { name: 'International Black Sea University', aliases: ['შავი ზღვის საერთაშორისო უნივერსიტეტი', 'IBSU'] },
  { name: 'Kutaisi University', aliases: ['ქუთაისის უნივერსიტეტი'] },
  { name: 'Kutaisi International University', aliases: ['ქუთაისის საერთაშორისო უნივერსიტეტი', 'KIU'] },
  { name: 'New Vision University', aliases: ['ნიუ ვიჟენ'] },
  { name: 'New Georgian University', aliases: ['ახალი საქართველოს უნივერსიტეტი'] },
  { name: 'Saint Andrews Georgian University', aliases: ['St. Andrews Georgian University', 'წმიდა ანდრია პირველწოდებულის'] },
  {
    name: 'Sulkhan-Saba Orbeliani University',
    aliases: ['Sulkhan-Saba Orbeliani Teaching University', 'სულხან-საბა ორბელიანის'],
  },
  { name: 'Sukhishvili Teaching University', aliases: ['სუხიშვილის სასწავლო უნივერსიტეტი'] },
  { name: 'Petre Shotadze Tbilisi Medical Academy', aliases: ['პეტრე შოთაძის'] },
  { name: 'Tbilisi Medical Academy', aliases: ['თბილისის სამედიცინო აკადემია'] },
  { name: 'Tbilisi Medical Institute Hippocrates', aliases: ['ჰიპოკრატე'] },
  { name: 'Tbilisi Teaching University', aliases: ['თბილისის სასწავლო უნივერსიტეტი'] },
  { name: 'Tbilisi University Metekhi', aliases: ['მეტეხი'] },
  { name: 'Teaching University European Academy', aliases: ['ევროპული აკადემია'] },
  { name: 'Teaching University Geomedi', aliases: ['Geomedi University', 'გეომედი'] },
  { name: 'Teaching University Iveria', aliases: ['ივერია'] },
  { name: 'Teaching University of International Relations of Georgia', aliases: ['საერთაშორისო ურთიერთობების'] },
  { name: 'Teaching University Rvali', aliases: ['რვალი'] },
  { name: 'Teaching University SEU' },
  { name: 'The University of Georgia', aliases: ['University of Georgia', 'საქართველოს უნივერსიტეტი'] },
  { name: 'University Sakartvelo', aliases: ['უნივერსიტეტი საქართველო'] },
];

/** A university filter value with all its aliases, or just the typed text. */
export function universitySearchTerms(value: string): string[] {
  const wanted = value.trim().toLowerCase();
  const known = GEORGIAN_UNIVERSITIES.find((u) => u.name.toLowerCase() === wanted);
  return known ? [known.name, ...(known.aliases ?? [])] : [value.trim()];
}

/**
 * The names to look for in English text (summaries, LinkedIn): the value and its English aliases,
 * without Georgian names and short abbreviations ("TSU" would match unrelated words).
 */
export function universityEnglishNames(value: string): string[] {
  const names = [value.trim(), ...universitySearchTerms(value).filter((t) => !/[\u10A0-\u10FF]/.test(t) && t.length > 5)];
  return Array.from(new Set(names.filter(Boolean)));
}
