/**
 * Whether a vacancy's deadline is behind us. Scrapers store "DD/MM/YYYY" or "YYYY-MM-DD..." (the same
 * formats JobService's expiry SQL reads); anything else counts as open. The deadline day itself is
 * still open, counted in Georgian time (UTC+4, no DST), where the vacancies and employers are.
 */
export function deadlinePassed(deadline: string | null | undefined, now: Date = new Date()): boolean {
  const value = (deadline ?? '').trim();
  let day: string | null = null;

  const dmy = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (dmy) day = `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
  else if (iso) day = `${iso[1]}-${iso[2]}-${iso[3]}`;
  if (!day) return false;

  const todayInGeorgia = new Date(now.getTime() + 4 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return day < todayInGeorgia;
}
