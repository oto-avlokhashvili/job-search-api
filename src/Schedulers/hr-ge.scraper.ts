// src/scraper/scraper.service.ts
import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import * as cheerio from 'cheerio';
export class JobDto {
  title: string;
  company: string;
  location: string;
  salary?: string;
  deadline?: string;
  url: string;
}
@Injectable()
export class HR_GE_ScraperService {
  private readonly logger = new Logger(HR_GE_ScraperService.name);
  private readonly baseUrl = 'https://hr.ge';

  async scrapeJobs(page = 1, keyword = ''): Promise<JobDto[]> {
    const url = `${this.baseUrl}/en/jobs?page=${page}&q=${encodeURIComponent(keyword)}`;

    this.logger.log(`Scraping: ${url}`);

    const { data } = await axios.get(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });

    const $ = cheerio.load(data);
    const jobs: JobDto[] = [];

    // Adjust selectors based on hr.ge's actual HTML structure
    $('.job-item, .vacancy-item, article.job').each((_, el) => {
      const title = $(el).find('.job-title, h2, h3').first().text().trim();
      const company = $(el).find('.company-name, .employer').first().text().trim();
      const location = $(el).find('.location, .city').first().text().trim();
      const salary = $(el).find('.salary').first().text().trim() || undefined;
      const deadline = $(el).find('.deadline, .date').first().text().trim() || undefined;
      const href = $(el).find('a').first().attr('href') || '';
      const jobUrl = href.startsWith('http') ? href : `${this.baseUrl}${href}`;

      if (title) {
        jobs.push({ title, company, location, salary, deadline, url: jobUrl });
      }
    });

    this.logger.log(`Found ${jobs.length} jobs on page ${page}`);
    return jobs;
  }

  async scrapeAllPages(keyword = '', maxPages = 5): Promise<JobDto[]> {
    const allJobs: JobDto[] = [];

    for (let page = 1; page <= maxPages; page++) {
      const jobs = await this.scrapeJobs(page, keyword);
      if (jobs.length === 0) break; // No more results
      allJobs.push(...jobs);

      // Polite delay between requests
      await new Promise((r) => setTimeout(r, 1500));
    }

    return allJobs;
  }

  async scrapeJobDetail(jobUrl: string): Promise<Record<string, string>> {
    const { data } = await axios.get(jobUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });

    const $ = cheerio.load(data);

    return {
      title: $('.job-title, h1').first().text().trim(),
      description: $('.job-description, .description').first().text().trim(),
      requirements: $('.requirements').first().text().trim(),
      company: $('.company-name').first().text().trim(),
    };
  }
}