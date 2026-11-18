import { JOB_CATEGORY_KEYS } from './job-category';

/** The most vacancies one search shows, across all its pages. */
export const MAX_SEARCH_RESULTS = 60;

/**
 * A search needs something to search for. A source or a date alone would just page through the
 * catalogue, so they only narrow a search.
 */
export function hasSearchCriterion(filter: { query?: string; location?: string; category?: string; salary?: string }): boolean {
  return (
    !!filter.query?.trim() ||
    !!filter.location?.trim() ||
    (!!filter.category?.trim() && JOB_CATEGORY_KEYS.includes(filter.category.trim())) ||
    filter.salary === 'true' ||
    filter.salary === '1'
  );
}
