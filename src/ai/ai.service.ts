import { HttpException, Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { AnalyzeJobDto } from './dto/analyze-job.dto';

@Injectable()
export class AiService {
  private readonly apiKey = process.env.GEMINI_API_KEY;
  private readonly logger = new Logger(AiService.name);

  /** Fetch the raw text of the job listing page for extra context. */
  private async fetchPageText(url: string): Promise<string> {
    try {
      const { data } = await axios.get<string>(url, {
        timeout: 10_000,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (compatible; JobSalaryBot/1.0)',
        },
        responseType: 'text',
      });

      // Strip HTML tags and collapse whitespace
      return data
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim()
        .slice(0, 4000); // Limit to avoid huge prompts
    } catch (err: any) {
      this.logger.warn(`Could not fetch job page: ${err.message}`);
      return '(page could not be fetched)';
    }
  }

  async analyze(job: AnalyzeJobDto): Promise<{
    minSalary: number;
    maxSalary: number;
    averageSalary: number;
    currency: string;
    notes: string;
  }> {
    const pageText = await this.fetchPageText(job.link);

    const prompt = `
You are a salary estimation expert for the Georgian (country) job market.

Your task is to ALWAYS provide a salary estimate — even if the job listing does not explicitly state a salary.
Use your knowledge of Georgian market rates for the given role, industry, and company to make a reasonable estimate.
NEVER return null for any salary field. Always return real numbers.

Rules:
- Base your estimate on: job title, company name, industry, location (if available), and typical Georgian salary ranges.
- If the scraped page confirms a specific salary, use that. If not, estimate confidently from market knowledge.
- Salaries are in GEL (Georgian Lari).
- minSalary should be the low end, maxSalary the high end, averageSalary the midpoint.
- notes should be one sentence explaining your reasoning.

Return ONLY valid JSON — no markdown, no code fences, no explanation outside the JSON.

Required JSON format:
{
  "minSalary": <number>,
  "maxSalary": <number>,
  "averageSalary": <number>,
  "currency": "GEL",
  "notes": "<one-sentence reasoning>"
}

Job listing:
${JSON.stringify(job, null, 2)}

Scraped page content (may be empty or unhelpful — still provide an estimate):
${pageText}
`.trim();

    try {
      const { data } = await axios.post(
        `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash-lite:generateContent?key=${this.apiKey}`,
        {
          contents: [{ parts: [{ text: prompt }] }],
        },
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 30_000,
        },
      );

      const raw: string = data.candidates[0].content.parts[0].text;

      // Strip possible markdown code fences
      const cleaned = raw
        .replace(/```json/gi, '')
        .replace(/```/g, '')
        .trim();

      return JSON.parse(cleaned);
    } catch (err: any) {
      this.logger.error('Gemini call failed', err?.response?.data ?? err.message);
      throw new HttpException(
        err.response?.data ?? 'Gemini error',
        err.response?.status ?? 500,
      );
    }
  }
}
