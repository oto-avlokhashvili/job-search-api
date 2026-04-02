import { HttpException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import axios from 'axios';
import { AnalyzeJobDto } from './dto/analyze-job.dto';
import { CvService } from 'src/cv/cv.service';
import { ConfigService } from '@nestjs/config';
import { SupabaseStorageService } from 'src/cv/supabase-storage.service';
import { JobService } from 'src/job/job.service';

@Injectable()
export class AiService {
  private readonly apiKey = process.env.GEMINI_API_KEY;
  private readonly logger = new Logger(AiService.name);
  constructor(private readonly configService: ConfigService,
    private readonly cvService: CvService,
    private readonly storageService: SupabaseStorageService,
    private readonly jobService: JobService) { }
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


  async analyzeCvAndTopJobs(userId: number, searchQuery: string[]): Promise<string> {
    const cv = await this.cvService.getCvByUser(userId);
    const base64Data = cv.buffer?.toString('base64');
    const jobs = await this.jobService.findAllByQuery(searchQuery);
const prompt = `
You are an expert Technical Recruiter and Job Matching AI. 

### STEP 1: CV ROLE IDENTIFICATION
Carefully analyze the provided CV to determine the candidate's **Primary Professional Identity** (e.g., the specific type of developer or engineer they are based on their most recent roles and projects).

### STEP 2: DYNAMIC MATCHING LOGIC
The user has provided a specific database filter via these search terms: ${JSON.stringify(searchQuery)}. 

Compare the CV against "JOB VACANCIES DATA" using these priority tiers:
1. **Implicit Role Match:** Prioritize vacancies that match the **Primary Professional Identity** you identified in Step 1. If the candidate is a specialist in a specific framework or language, those vacancies MUST be ranked #1.
2. **Search Query Enforcement:** Within the results, prioritize jobs that contain terms from the search query array provided above.
3. **Location & Seniority:** Prioritize matches in Georgia (Tbilisi) or remote, and align the vacancy with the candidate's experience and current education.

### STEP 3: OUTPUT REQUIREMENTS
1. **Identify Top 5:** Select the 5 best matches. If a vacancy exists that perfectly aligns with the candidate's primary tech stack and the search query, it must be the top result.
2. **Salary Estimation:** Provide a realistic range in GEL for the Tbilisi market based on the candidate's specific profile.
3. **Gap Analysis:** Identify any missing skills relative to the specific requirements of the top-ranked jobs.

### IMPORTANT CONSTRAINTS:
- Return ONLY valid JSON.
- No markdown, no conversational filler.
- Do not hallucinate vacancies; use ONLY provided data.

RESPONSE FORMAT:
{
  "summary": "string",
  "strengths": ["string"],
  "skillGaps": ["string"],
  "topJobs": [
    {
      "id": number,
      "vacancy": "string",
      "location": "string",
      "company": "string",
      "link": "string",
      "publishDate": "string",
      "deadline": "string",
      "page": number,
      "archived": boolean,
      "salaryRange": "string",
      "match": "string (percentage)"
    }
  ]
}

JOB VACANCIES DATA:
${JSON.stringify(jobs)}
`;

    try {
      const { data } = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${this.apiKey}`,
        {
          contents: [
            {
              parts: [
                { text: prompt },
                {
                  inline_data: {
                    mime_type: cv.mimeType,  // 'application/pdf'
                    data: base64Data,
                  },
                },
              ],
            },
          ],
          generationConfig: {
            response_mime_type: "application/json",
            temperature: 0.2
          }
        },
        { headers: { 'Content-Type': 'application/json' }, timeout: 60_000 }
      );

      return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    } catch (err: any) {
      this.logger.error('Gemini call failed', err?.response?.data ?? err.message);
      throw new HttpException(
        err?.response?.data ?? 'Gemini error',
        err?.response?.status ?? 500,
      );
    }
  }
}
