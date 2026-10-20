import { Injectable, Logger, OnModuleDestroy, ServiceUnavailableException } from '@nestjs/common';
import { BrowserContext, chromium } from 'playwright';
import * as path from 'path';

export interface GoogleResult {
  title: string;
  url: string;
  snippet: string;
}

// Shared with scripts/google-warmup.mjs: both must open the same profile for the
// cookies collected during warm-up to be reused here.
export const GOOGLE_PROFILE_DIR = process.env.GOOGLE_PROFILE_DIR || path.join(process.cwd(), '.google-profile');

const RESULTS_PER_PAGE = 10;
const IDLE_CLOSE_MS = 5 * 60 * 1000; // Chrome holds ~300MB; don't keep it alive between bursts
const BLOCK_COOLDOWN_MS = 30 * 60 * 1000; // Retrying straight after a CAPTCHA keeps the profile flagged
const MIN_GAP_MS = 4000;
const MAX_GAP_MS = 8000;

/**
 * Runs Google searches in a real browser with a persistent profile.
 *
 * Google answers plain HTTP with a "JavaScript required" page, and hands a CAPTCHA to
 * a fresh browser profile. A profile that has been opened once in a visible browser
 * (npm run google:warmup) gets trusted cookies that last months, so we keep reusing it
 * and pace searches to avoid getting it flagged again.
 */
@Injectable()
export class GoogleBrowserService implements OnModuleDestroy {
  private readonly logger = new Logger(GoogleBrowserService.name);
  private context: Promise<BrowserContext> | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private lastSearchAt = 0;
  private blockedUntil = 0;
  private idleTimer: NodeJS.Timeout | null = null;

  /** Searches are serialized: one browser, one tab, one query at a time. */
  search(query: string, page = 1): Promise<GoogleResult[]> {
    const run = this.queue.then(() => this.runSearch(query, page));
    this.queue = run.catch(() => undefined);
    return run;
  }

  async onModuleDestroy() {
    await this.closeContext();
  }

  private async runSearch(query: string, pageNumber: number): Promise<GoogleResult[]> {
    if (Date.now() < this.blockedUntil) {
      const minutes = Math.ceil((this.blockedUntil - Date.now()) / 60000);
      throw new ServiceUnavailableException(`Google is rate limiting searches, try again in ${minutes} min`);
    }

    const gap = MIN_GAP_MS + Math.random() * (MAX_GAP_MS - MIN_GAP_MS);
    const wait = this.lastSearchAt + gap - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));

    if (this.idleTimer) clearTimeout(this.idleTimer);
    const context = await this.getContext();
    const page = await context.newPage();
    try {
      // udm=14 is Google's plain "Web" tab: without it Google often drops the
      // site: operator and returns unrelated pages.
      const params = new URLSearchParams({ q: query, hl: 'en', udm: '14' });
      if (pageNumber > 1) params.set('start', String((pageNumber - 1) * RESULTS_PER_PAGE));
      await page.goto(`https://www.google.com/search?${params}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      this.lastSearchAt = Date.now();

      if (page.url().includes('consent.google.')) {
        await page.locator('button:has-text("Accept all"), button:has-text("Reject all")').first().click();
        await page.waitForURL(/\/search/, { timeout: 15000 });
      }

      if (page.url().includes('/sorry/')) {
        this.blockedUntil = Date.now() + BLOCK_COOLDOWN_MS;
        this.logger.warn('Google returned a CAPTCHA; run `npm run google:warmup` if this persists');
        throw new ServiceUnavailableException('Google is rate limiting searches, try again later');
      }

      await page.waitForSelector('a h3', { timeout: 10000 }).catch(() => undefined);
      const raw = await this.extractResults(page);

      // Result links are /goto?url=... redirects; resolve them with the same cookies.
      const results: GoogleResult[] = [];
      for (const r of raw) {
        const url = await this.resolveUrl(context, r.href);
        if (url) results.push({ title: r.title, url, snippet: r.snippet });
      }
      return results;
    } finally {
      await page.close().catch(() => undefined);
      this.scheduleIdleClose();
    }
  }

  // Selectors rely on structure (a link wrapping an h3) rather than Google's
  // obfuscated class names, which change every few weeks.
  private extractResults(page: import('playwright').Page) {
    return page.$$eval('a:has(h3)', (anchors) =>
      anchors.map((a) => {
        const h3 = a.querySelector('h3') as HTMLElement;
        let container: Element = a;
        while (
          container.parentElement &&
          container.parentElement.id !== 'rso' &&
          container.parentElement.querySelectorAll('h3').length === 1
        ) {
          container = container.parentElement;
        }
        // The snippet is the longest leaf text block outside the title link.
        let snippet = '';
        container.querySelectorAll('div, span').forEach((el) => {
          if (a.contains(el) || el.contains(a) || el.querySelector('div')) return;
          const text = (el as HTMLElement).innerText?.trim() ?? '';
          if (text.length > snippet.length) snippet = text;
        });
        return { title: h3.innerText.trim(), href: a.getAttribute('href') ?? '', snippet };
      }),
    );
  }

  private async resolveUrl(context: BrowserContext, href: string): Promise<string | null> {
    if (!href) return null;
    const absolute = new URL(href, 'https://www.google.com');
    if (!absolute.hostname.endsWith('google.com')) return absolute.toString();

    const direct = absolute.searchParams.get('q') || absolute.searchParams.get('url');
    if (absolute.pathname === '/url' && direct?.startsWith('http')) return direct;

    try {
      const res = await context.request.get(absolute.toString(), { maxRedirects: 0, timeout: 10000 });
      return res.headers()['location'] ?? null;
    } catch (error) {
      this.logger.warn(`Could not resolve Google redirect: ${error.message}`);
      return null;
    }
  }

  private getContext(): Promise<BrowserContext> {
    if (!this.context) {
      this.context = chromium
        .launchPersistentContext(GOOGLE_PROFILE_DIR, {
          headless: process.env.GOOGLE_HEADLESS !== 'false',
          channel: process.env.GOOGLE_BROWSER_CHANNEL || 'chromium',
          proxy: this.proxyConfig(),
          locale: 'en-US',
          viewport: { width: 1366, height: 900 },
          args: ['--disable-blink-features=AutomationControlled'],
        })
        .catch((error) => {
          this.context = null;
          this.logger.error(`Failed to launch browser: ${error.message}`);
          throw new ServiceUnavailableException('Search browser is not available');
        });
    }
    return this.context;
  }

  // GOOGLE_PROXY_URL=http://user:pass@host:port — needed on data-center hosts, whose IPs Google distrusts.
  private proxyConfig() {
    const raw = process.env.GOOGLE_PROXY_URL;
    if (!raw) return undefined;
    const url = new URL(raw);
    return {
      server: `${url.protocol}//${url.host}`,
      username: url.username ? decodeURIComponent(url.username) : undefined,
      password: url.password ? decodeURIComponent(url.password) : undefined,
    };
  }

  private scheduleIdleClose() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => void this.closeContext(), IDLE_CLOSE_MS);
    this.idleTimer.unref();
  }

  private async closeContext() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    const context = this.context;
    this.context = null;
    if (context) await (await context.catch(() => null))?.close().catch(() => undefined);
  }
}
