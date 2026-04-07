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
    const buffer = await this.storageService.downloadFile(cv.storagePath);
    const base64Data = buffer.toString('base64');
    const jobs = await this.jobService.findAllByQuery(searchQuery);
const prompt = `
You are an expert Technical Recruiter and Career Matching AI.

## YOUR TASK
You will receive a CV and a list of job vacancies. Your job is to:
1. Analyze the CV to understand the candidate's identity.
2. Detect the single best search query that represents this candidate.
3. Return exactly 5 vacancies ranked using the two-tier priority system below.

---

## STEP 1 — UNDERSTAND THE CANDIDATE
Read the entire CV carefully. Extract:
- **Primary Role:** The job title that best describes them (e.g. "Senior Frontend Engineer")
- **Core Skills & Tech Stack:** Technologies and tools they know best
- **Seniority Level:** Intern / Junior / Mid / Senior / Lead / Principal (based on years of experience)
- **Primary Search Query:** The single most important keyword or phrase this candidate should search for (e.g. "Angular", "React Native", "DevOps"). This is the anchor for Tier A below.

---

## STEP 2 — TWO-TIER RANKING (CRITICAL — follow exactly)

### Tier A: Query-Matched Vacancies (always shown first)
Identify ALL vacancies whose title, description, or tech stack contains or relates to the Primary Search Query.

- These vacancies MUST appear at the top of the topJobs list, regardless of seniority fit.
- Sort Tier A by match score ASCENDING (lowest score first) so the most query-relevant result leads — even if the candidate is overqualified.
- Assign honest match scores: a Senior candidate matched with an Intern role for their primary tech should score 35–55. Do NOT inflate or deflate scores to reorder within a tier — the tier itself determines priority.

### Tier B: Best Remaining Vacancies
From the remaining vacancies (not in Tier A), pick the best fits by overall skill and seniority alignment.

- Sort Tier B by match score DESCENDING (highest score first).
- Append Tier B after all Tier A results.

### Final list = Tier A (asc by score) + Tier B (desc by score), exactly 5 total.

---

## STEP 3 — SCORING GUIDE (per vacancy)
Think holistically. Consider:
- **Seniority alignment** — does the level match the candidate?
- **Tech stack overlap** — how much of the required stack does the candidate know?
- **Domain/industry fit** — does the job's domain suit their background?
- **Location** — Tbilisi / Remote preferred

Score range guidelines:
- **85–100:** Perfect seniority + tech stack match
- **60–84:** Good tech match, minor seniority gap
- **35–59:** Tech match, significant seniority mismatch (e.g. Senior → Intern)
- **Below 35:** Weak overlap on both axes

---

## IMPORTANT CONSTRAINTS
- Return ONLY valid JSON. No markdown, no explanation outside JSON.
- Use ONLY the provided vacancy data — do not invent or modify fields.
- Do not duplicate vacancies.
- You MUST return exactly 5 vacancies unless fewer than 5 exist in the data.
- **Salary Range:** 
  1. If the vacancy data contains salary info, use it directly.
  2. If not, analyze the vacancy title, seniority level, company, and location together
     to estimate a realistic market salary range for that role in that market 
     (e.g. Tbilisi, Georgia vs Remote international).
     Format as: "$X,XXX – $X,XXX/თვე (დაახლოებით)" or "₾X,XXX – ₾X,XXX/თვე (დაახლოებით)" 
     depending on the likely pay currency for that market.
  3. Never return null, "N/A", or empty string.
---

## OUTPUT FORMAT

{
  "candidateProfile": {
    "detectedRole": "string",
    "seniorityLevel": "string",
    "primarySkills": ["string"],
    "primarySearchQuery": "string"
  },
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
      "match": number,
      "tier": "A" | "B",
      "matchReason": "string"
    }
  ]
}

---

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
            temperature: 0.1
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
