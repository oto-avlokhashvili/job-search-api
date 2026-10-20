// Opens a visible browser on the same profile the API uses for Google searches.
// Google hands fresh/headless profiles a CAPTCHA; one visible visit (solve the CAPTCHA
// if shown, run a search) gives the profile trusted cookies that last for months.
// Usage: npm run google:warmup   — then close the window when results show.
import 'dotenv/config';
import path from 'node:path';
import { chromium } from 'playwright';

const profileDir = process.env.GOOGLE_PROFILE_DIR || path.join(process.cwd(), '.google-profile');
const context = await chromium.launchPersistentContext(profileDir, {
  headless: false,
  channel: process.env.GOOGLE_BROWSER_CHANNEL || 'chromium',
  locale: 'en-US',
  viewport: null,
  args: ['--disable-blink-features=AutomationControlled'],
});
const page = context.pages()[0] ?? (await context.newPage());
const query = 'site:linkedin.com/in ("Angular") "Tbilisi"';
await page.goto(`https://www.google.com/search?hl=en&udm=14&q=${encodeURIComponent(query)}`);

console.log(`Profile: ${profileDir}`);
console.log('Accept cookies / solve the CAPTCHA if Google shows one, then close the browser window.');
await new Promise((resolve) => context.on('close', resolve));
console.log('Done. The API will reuse this profile.');
