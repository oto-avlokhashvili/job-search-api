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
Analyze the CV to determine the candidate's **Primary Professional Identity** (e.g., Angular Developer, DevOps Engineer) and their **Seniority Level** (Junior, Mid, Senior, Lead).

### STEP 2: SENIORITY-FIRST MATCHING LOGIC
Compare the CV against "JOB VACANCIES DATA" using these strict priority rules:

1. **Seniority Alignment (60% of Match Score):** - Start by identifying the candidate's level (Senior, Mid, Junior, Intern).
   - **Perfect Alignment:** If the job title matches the candidate's level (e.g., Senior to Senior), assign **60 points**.
   - **Partial Mismatch:** If the candidate is one level above/below (e.g., Senior to Mid), assign **30 points**.
   - **Hard Mismatch:** If the candidate is a **Senior** and the job is an **Intern (სტაჟიორი)** or **Junior**, assign **0 points** for this category.

2. **Skill & Tech Stack (30% of Match Score):** - If the Primary Tech Stack (e.g., Angular) matches, add **30 points**.
   - If the Tech Stack is different but related, add **10 points**.

3. **Search Query & Location (10% of Match Score):**
   - If it matches terms in ${JSON.stringify(searchQuery)} and is in Tbilisi/Remote, add **10 points**.

### STEP 3: MATCH SCORE CALIBRATION (MANDATORY)
- **90-100%:** Only for jobs that match BOTH Seniority and Tech Stack.
- **50-70%:** Jobs that match the Tech Stack but have a **Seniority Mismatch** (e.g., a Senior looking at an Intern role).
- **Below 40%:** Jobs with no Tech or Seniority match.

**EXAMPLE RULE:** An "Angular სტაჟიორი" (Intern) role for a **Senior Developer** MUST be calculated as: 0 (Seniority) + 30 (Tech) + 10 (Location) = **40% Match**.

### IMPORTANT CONSTRAINTS:
- Return ONLY valid JSON.
- No markdown, no conversational filler.
- Use ONLY provided vacancy data.

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
      "match": "number"
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
