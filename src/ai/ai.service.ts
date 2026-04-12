import { HttpException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import axios from 'axios';
import { AiChatDto, AnalyzeJobDto, ChatDto } from './dto/analyze-job.dto';
import { CvService } from 'src/cv/cv.service';
import { ConfigService } from '@nestjs/config';
import { SupabaseStorageService } from 'src/cv/supabase-storage.service';
import { JobService } from 'src/job/job.service';
import { UserService } from 'src/user/user.service';

@Injectable()
export class AiService {
  private readonly apiKey = process.env.GEMINI_API_KEY;
  private readonly logger = new Logger(AiService.name);
  constructor(private readonly configService: ConfigService,
    private readonly cvService: CvService,
    private readonly storageService: SupabaseStorageService,
    private readonly jobService: JobService,
    private readonly userService: UserService
  ) { }
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
  private async extractJobTitles(prompt: string, cvText?: string): Promise<string[]> {
    const input = cvText
      ? `Search query: "${prompt}"\n\nCV:\n${cvText}`
      : `"${prompt}"`;

    const { data } = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${this.apiKey}`,
      {
        contents: [
          {
            parts: [
              {
                text: `
Extract the core job-related search terms from the text.

Rules:
- Only extract what is explicitly mentioned or directly implied (e.g. Angular → frontend)
- 1 level of implication max — do not chain (frontend → React → TypeScript → ...)
- Include English and Georgian version of each term
- Use stems, not full phrases (e.g. "დეველოპერ" not "დეველოპერი", "front-end" not "front-end developer")
- Max 8 terms total
- All lowercase, no duplicates
- Ignore fonts, colors, formatting, and document styling (Arial, Calibri, bold, italic etc.)
${cvText ? '- If both a search query and CV are provided, prioritize terms that appear in BOTH' : ''}

Examples:
"ვეძებ ანგულარ დეველოპერის ვაკანსიებს" → ["angular","ანგულარ","frontend","ფრონტენდ","developer","დეველოპერ"]
"python backend engineer" → ["python","პითონ","backend","ბექენდ","engineer","ინჟინერ","developer","დეველოპერ"]
"მინდა ვიპოვო product designer ვაკანსია" → ["designer","დიზაინერ","product design","ui","ux","ფრონტენდ"]
"devops vacancy tbilisi" → ["devops","დევოფს","engineer","ინჟინერ","cloud","კლაუდ"]

Return ONLY a raw JSON array of lowercase strings.
No explanation, no markdown, no backticks.

Text: ${input}
`.trim(),
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0,
          responseMimeType: 'application/json',
        },
      },
      { headers: { 'Content-Type': 'application/json' }, timeout: 15000 }
    );

    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '[]';

    try {
      return JSON.parse(raw);
    } catch {
      const clean = raw.replace(/```json|```/gi, '').trim();
      try {
        return JSON.parse(clean);
      } catch {
        return [];
      }
    }
  }
  async aiChat(
    userId: number,
    body: AiChatDto,
    files?: Express.Multer.File[]
  ): Promise<{ response: any, comment: string }> {

    // Extract CV text from uploaded files
    let cvText = '';
    if (files?.length) {
      for (const file of files) {
        if (file.mimetype === 'application/pdf' || file.mimetype.startsWith('text/')) {
          cvText += file.buffer.toString('utf-8') + '\n';
        }
      }
    }

    const promptKeywords = await this.extractJobTitles(body.prompt, cvText);
    let searchQuery = promptKeywords;

    const jobs = await this.jobService.findAllByQuery(searchQuery);
    console.log('Search query:', searchQuery);
    console.log('Jobs found:', jobs.length);

    const hasCV = cvText.trim().length > 0;

    const prompt = `
You are an expert Technical Recruiter and Career Matching AI.

## YOUR TASK
You will receive a search query, a list of job vacancies${hasCV ? ', and a CV' : ''}.
Your job is to:
1. ${hasCV ? 'Deeply analyze the CV to build a complete picture of the candidate.' : 'Use the search query to infer what the candidate is looking for.'}
2. Evaluate every vacancy against the candidate profile.
3. Prioritize vacancies that match the search query AND ${hasCV ? 'the CV experience' : 'the inferred profile'}.
4. Return all vacancies that meaningfully match, ranked by fit score.

---

${hasCV ? `## STEP 1 — UNDERSTAND THE CANDIDATE
Read the entire CV carefully. Extract:
- **Primary Role:** The job title that best describes them today
- **Core Skills & Tech Stack:** Technologies, tools, and frameworks they know well
- **Secondary Skills:** Things they have exposure to but are not specialists in
- **Seniority Level:** Intern / Junior / Mid / Senior / Lead / Principal (based on years of experience and scope of responsibility)
- **Industry/Domain Background:** Sectors they've worked in (fintech, healthtech, e-commerce, etc.)
- **Location Preference:** Inferred from CV address or remote history
- **Career Direction:** What kind of role they are likely looking for next, based on their trajectory

### IMPORTANT — CV vs Search Query alignment:
The search query reflects what the candidate is actively looking for RIGHT NOW.
Cross-reference the CV with the search query:
- Skills in the CV that match the search query → highest priority vacancies
- Skills in the CV not in the search query → still relevant for CV-based scoring
- Search query terms not found in CV → lower confidence match, flag in matchGaps

---` : ''}

## STEP 2 — EVALUATE & SCORE EACH VACANCY
For every vacancy compute a match score (0–100) using this priority order:

### Primary factor — search query alignment (up to +30 bonus)
- Does the vacancy title, description, or required stack directly match the search query?
- If yes: apply a +30 bonus on top of the CV-based score.
- If partially: apply +10 to +20.
- If no relation to the query: no bonus.

${hasCV ? `### Secondary factors — CV fit (base score 0–70)
- **Seniority alignment** — does the required level match the candidate's experience?
- **Tech stack overlap** — what fraction of the required stack does the candidate know?
- **Domain/industry fit** — does the job's sector align with their background?
- **Location compatibility** — is it in their city, remote-friendly, or a mismatch?
- **Career trajectory fit** — does the role represent a natural next step for them?` : `### Secondary factors — inferred profile fit (base score 0–70)
- **Role relevance** — does the vacancy match the role inferred from the search query?
- **Tech stack overlap** — does the vacancy require skills implied by the search query?
- **Seniority** — infer seniority from the query if possible (e.g. "senior", "junior")`}

### Score range guidelines:
- **85–100:** Query match + strong CV fit
- **65–84:** Query match with minor gaps, OR strong CV fit without query match
- **50–64:** Partial query match or decent fit with noticeable gaps
- **Below 50:** Weak on both axes — omit unless fewer than 3 vacancies pass the threshold

---

## STEP 3 — FILTER & RANK
- Include ALL vacancies with a final score ≥ 50.
- If fewer than 3 vacancies reach 50, include the top 3 regardless of score.
- Sort results by final score descending (best fit first).
- Do not pad results with poor matches to hit an artificial count.

---

## IMPORTANT CONSTRAINTS
- Return ONLY valid JSON. No markdown, no explanation outside the JSON.
- Use ONLY the provided vacancy data — do not invent or modify fields.
- Do not duplicate vacancies.
- **Salary Range:**
  1. If the vacancy data contains salary info, use it directly.
  2. If not, estimate a realistic market salary range based on the vacancy title, seniority, company, and location.
     Format as: "$X,XXX – $X,XXX/mo (est.)" or "₾X,XXX – ₾X,XXX/mo (est.)" depending on the likely pay currency.
  3. Never return null, "N/A", or empty string.

---

## OUTPUT FORMAT

{
  "candidateProfile": {
    "detectedRole": "string",
    "seniorityLevel": "string",
    "primarySkills": ["string"],
    "secondarySkills": ["string"],
    "domains": ["string"],
    "locationPreference": "string",
    "careerDirection": "string"
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
      "queryMatch": boolean,
      "matchReason": "string",
      "matchGaps": ["string"]
    }
  ]
}

---

SEARCH QUERY: ${JSON.stringify(searchQuery)}

${hasCV ? `CV:\n${cvText}` : ''}

JOB VACANCIES DATA:
${JSON.stringify(jobs)}
  `.trim();

    try {
      const parts: any[] = [{ text: prompt }];

      // Attach image files as inline data (e.g. scanned CV image)
      if (files?.length) {
        for (const file of files) {
          if (file.mimetype.startsWith('image/')) {
            parts.push({
              inline_data: {
                mime_type: file.mimetype,
                data: file.buffer.toString('base64'),
              },
            });
          }
        }
      }

      const { data } = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${this.apiKey}`,
        {
          contents: [{ parts }],
          generationConfig: {
            temperature: 0.1,
            responseMimeType: 'application/json', // 👈 forces pure JSON response, no markdown
          },
        },
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 120000,
        }
      );

      const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
      const responseText = typeof raw === 'string' ? raw : JSON.stringify(raw);
      
      // Extract the first complete JSON object from the response — bulletproof against markdown fences
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        this.logger.warn('No JSON found in Gemini response');
        return { response: responseText, comment: 'შეცდომა' };
      }
      
      try {
        const parsedResponse = JSON.parse(jsonMatch[0]);
        await this.userService.update(userId, { searchQuery: searchQuery });
        if (files) {
          await this.cvService.uploadCv(userId, files[0]);
        }
        return { response: parsedResponse, comment: `ნაპოვნია ${parsedResponse.topJobs.length} ვაკანსია` };
      } catch (parseErr) {
        this.logger.warn('Failed to parse Gemini JSON', parseErr);
        return { response: responseText, comment: 'შეცდომა' };
      }
      
    } catch (err: any) {
      this.logger.error('Gemini call failed', err?.response?.data ?? err.message);
      throw new HttpException(
        err?.response?.data ?? 'Gemini error',
        err?.response?.status ?? 500
      );
    }
    
  }
}
