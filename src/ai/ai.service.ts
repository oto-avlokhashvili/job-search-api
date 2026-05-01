import { HttpException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import axios from 'axios';
import { AiChatDto, AnalyzeJobDto, ChatDto } from './dto/analyze-job.dto';
import { CvService } from 'src/cv/cv.service';
import { ConfigService } from '@nestjs/config';
import { SupabaseStorageService } from 'src/cv/supabase-storage.service';
import { JobService } from 'src/job/job.service';
import { UserService } from 'src/user/user.service';
import { jsonrepair } from 'jsonrepair';
import { CvSummaryDetails } from 'src/cv/dto/cv-summary.dto';
import { AiMatchedJobsService } from 'src/ai-matched-jobs/ai-matched-jobs.service';


@Injectable()
export class AiService {
  private readonly apiKey = process.env.GEMINI_API_KEY;
  private readonly logger = new Logger(AiService.name);
  constructor(private readonly configService: ConfigService,
    private readonly cvService: CvService,
    private readonly storageService: SupabaseStorageService,
    private readonly jobService: JobService,
    private readonly userService: UserService,
    private readonly aiMatchedJobsService: AiMatchedJobsService,
  ) { }

  async summarizeCv(
    cvFile: Express.Multer.File,
  ): Promise<CvSummaryDetails | null> {
const CV_SUMMARY_PROMPT = `
Analyze the attached CV and extract a structured candidate profile.

## SENIORITY DETECTION — follow this exact decision tree:

STEP 1 — Check for explicit title in CV (job titles, self-description):
  - Contains "intern" / "სტაჟიორი" / "trainee" → Junior
  - Contains "junior" / "უმცროსი" → Junior
  - Contains "middle" / "mid-level" → Mid
  - Contains "senior" / "უფროსი" → Senior
  - Contains "lead" / "principal" / "architect" / "staff" → Lead or Principal

STEP 2 — If no explicit title, calculate total professional experience in years:
  - Sum only paid work experience (exclude education, bootcamps, personal projects)
  - Count overlapping jobs once (use the longer period)
  - 0–2 years → Junior
  - 2–4 years → Mid
  - 4–7 years → Senior
  - 7+ years → Lead
  - If dates are ambiguous or missing → go to STEP 3

STEP 3 — If years still unclear, look at responsibility scope ONLY:
  - Mentored teams, defined architecture, owned product → Senior or Lead
  - Worked independently on complex features, some mentoring → Mid
  - Worked under supervision, learning on the job, simple tasks → Junior
  - When genuinely uncertain between two adjacent levels → pick the LOWER one
  - NEVER jump more than one level based on complexity alone

STEP 4 — Cross-check: if STEP 1 and STEP 2 conflict, trust STEP 2 (years) over job titles
  (candidates often inflate titles on CVs)

## OTHER RULES:
- Lowercase stems for skills, English only
- Max 8 primary skills (most-used/core technologies)
- Max 6 secondary skills (supporting tools, methodologies)
- Ignore formatting artifacts: font names, colors, bullet styles (Arial, Calibri, bold, etc.)
- locationPreference: extract city if mentioned, otherwise "Not specified"
- careerDirection: infer the direction they are heading, not just current role

## SEARCH QUERIES — 8–14 short keyword tokens for vacancy search:
- Each token: 1–2 words MAX, lowercase
- Each token must be both in english and georgian (for example: "analyst" and "ანალიტიკოსი")
- For hyphenated terms include both forms separately ("frontend" AND "front-end")
- Include domain tokens from the candidate's actual domains
- Include 1–2 Georgian role name translations
- DO NOT include: primary skills as standalone tokens, seniority words (junior/senior/mid),
  city names, phrases longer than 2 words, duplicates, font/formatting words,
  both "developer" and "engineer" forms of the same role

Return ONLY valid raw JSON, no markdown, no backticks:
{
  "detectedRole": "string",
  "seniorityLevel": "Junior | Mid | Senior | Lead | Principal",
  "primarySkills": ["string"],
  "secondarySkills": ["string"],
  "domains": ["string"],
  "locationPreference": "string",
  "careerDirection": "string",
  "searchQueries": ["string"]
}
`.trim();

    const { data } = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${this.apiKey}`,
      {
        contents: [
          {
            parts: [
              {
                inline_data: {
                  mime_type: cvFile.mimetype,
                  data: cvFile.buffer.toString('base64'),
                },
              },
              { text: CV_SUMMARY_PROMPT },
            ],
          },
        ],
        generationConfig: { temperature: 0, responseMimeType: 'application/json' },
      },
      { headers: { 'Content-Type': 'application/json' }, timeout: 30000 },
    );

    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    if (!raw) {
      this.logger.warn('summarizeCv: empty response from Gemini');
      return null;
    }

    try {
      return JSON.parse(raw) as CvSummaryDetails;
    } catch {
      const clean = raw.replace(/```json|```/gi, '').trim();
      try {
        return JSON.parse(clean) as CvSummaryDetails;
      } catch {
        this.logger.warn('summarizeCv: failed to parse response');
        return null;
      }
    }
  }


  async jobsearchWithCv(
  userId: number,
): Promise<{ response: any; comment: string }> {

  // ── 1. Fetch stored CV ────────────────────────────────────────────────────
  const storedCv = await this.cvService.getCvByUser(userId).catch(() => null);

  if (!storedCv) {
    return {
      response: { candidateProfile: null, summary: null, strengths: [], skillGaps: [], topJobs: [] },
      comment: 'CV არ არის ატვირთული',
    };
  }

  // ── 2. Summarize if not yet summarized ───────────────────────────────────
  let summary: CvSummaryDetails | null =
    storedCv.summary && Object.keys(storedCv.summary).length > 0
      ? (storedCv.summary as CvSummaryDetails)
      : null;

  if (!summary) {
    try {
      const buffer = await this.storageService.downloadFile(storedCv.storagePath);
      const cvFile = {
        buffer,
        mimetype: storedCv.mimeType,
        originalname: storedCv.originalName,
        size: storedCv.size,
      } as Express.Multer.File;

      summary = await this.summarizeCv(cvFile);

      if (summary) {
        await this.cvService.updateSummary(userId, summary);
      }
    } catch (e) {
      this.logger.warn(`Could not summarize CV for user ${userId}: ${e.message}`);
    }
  }

  if (!summary) {
    return {
      response: { candidateProfile: null, summary: null, strengths: [], skillGaps: [], topJobs: [] },
      comment: 'CV-ს დამუშავება ვერ მოხერხდა',
    };
  }

  // ── 3. Use searchQueries from summary to find jobs ───────────────────────
  const searchTerms: string[] = summary.searchQueries ?? [];
  await this.userService.update(userId, { searchQuery: searchTerms });
  const jobs = await this.jobService.findAllByQuery(searchTerms);
  this.logger.log(`Search terms: ${JSON.stringify(searchTerms)}`);
  this.logger.log(`Jobs found: ${jobs.length}`);

  // ── 4. Rank & filter jobs via Gemini ─────────────────────────────────────
const prompt = `
You are an expert Technical Recruiter and Career Matching AI.

## YOUR TASK
Evaluate job vacancies against the candidate profile and return ONLY relevant matches.

---

## CRITICAL RULE — ROLE RELEVANCE FILTER
**Before scoring, apply a hard filter:**
- The candidate's detected role is: "${summary.detectedRole}" in "${summary.careerDirection}"
- EXCLUDE any vacancy that is NOT in software/IT development domain
- EXCLUDE roles in: marketing, sales, retail, hospitality, food, logistics, HR, education management, finance (non-dev), or any non-technical field
- If a vacancy title contains no technology or development keywords, EXCLUDE it
- Only include vacancies where the core job function is writing code, building software, or closely related IT work (e.g. systems analyst, technical analyst with dev context)

---

## STEP 1 — SCORE EACH REMAINING VACANCY (0–100)

### Primary role match (0–60 points)
- **+60** if vacancy matches detectedRole exactly: "${summary.detectedRole}"
- **+40–50** if vacancy is in the same domain: "${summary.careerDirection}" (e.g. frontend, web dev)
- **+20–35** if vacancy is adjacent (full-stack, closely related tech)
- **+10–20** if vacancy is in a different dev domain (backend, mobile) but candidate has secondary skills

### Seniority alignment (0–20 points)
- Candidate seniority: "${summary.seniorityLevel}"
- **+20** exact match (Junior→Junior)
- **+10** one level apart (Junior→Mid)
- **+0** two+ levels apart (Junior→Senior) — do not exclude, but penalize heavily

### Tech stack overlap (0–15 points)
- Count how many required technologies match primarySkills: ${JSON.stringify(summary.primarySkills)}
- Count secondary matches from: ${JSON.stringify(summary.secondarySkills)}
- Award proportionally

### Location (0–5 points)
- **+5** matches "${summary.locationPreference}" or remote
- **+0** different city

---

## STEP 2 — FILTER & RANK
- MINIMUM score to include: **50**
- If fewer than 3 vacancies reach 50, include top 3 dev-relevant ones only
- Sort descending by score
- **No marketing, no retail, no non-IT roles — ever**

---

## SALARY ESTIMATION (if not provided)
- Intern → "₾500 – ₾1,000/mo (est.)"
- Junior → "₾1,000 – ₾2,000/mo (est.)"
- Mid → "₾2,500 – ₾4,000/mo (est.)"
- Senior → "₾4,000 – ₾7,000/mo (est.)"
- Lead/Principal → "₾7,000 – ₾12,000/mo (est.)"
- Use ₾ for Georgian roles, $ for international/remote

---

## OUTPUT — STRICT JSON ONLY
Return ONLY this JSON structure. No markdown, no explanation, no extra text.

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
  "searchQueries": ["string"],
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

CANDIDATE PROFILE:
${JSON.stringify(summary)}

JOB VACANCIES:
${JSON.stringify(jobs)}
`.trim();

  try {
    const { data } = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${this.apiKey}`,
      {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
      },
      { headers: { 'Content-Type': 'application/json' }, timeout: 120000 },
    );

    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    const responseText = typeof raw === 'string' ? raw : JSON.stringify(raw);

    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      this.logger.warn('No JSON found in Gemini response');
      return { response: responseText, comment: 'შეცდომა' };
    }

    const repaired = jsonrepair(jsonMatch[0]);
    const parsedResponse = JSON.parse(repaired);
    await this.aiMatchedJobsService.createBulk(userId, parsedResponse.topJobs)
    return {
      response: parsedResponse,
      comment: `ნაპოვნია ${parsedResponse.topJobs?.length ?? 0} ვაკანსია`,
    };

  } catch (err: any) {
    this.logger.error('Gemini call failed', err?.response?.data ?? err.message);

    if (err?.response?.status === 429) {
      this.logger.warn('Gemini rate-limited (429) — returning unranked jobs');
      const rawJobs = jobs.map((job: any) => ({
        ...job,
        salaryRange: null,
        match: null,
        queryMatch: null,
        matchReason: null,
        matchGaps: [],
      }));
      return {
        response: {
          candidateProfile: summary,
          summary: null,
          strengths: [],
          skillGaps: [],
          topJobs: rawJobs,
        },
        comment: `ნაპოვნია ${rawJobs.length} ვაკანსია (AI ანალიზის გარეშე)`,
      };
    }

    throw new HttpException(
      err?.response?.data ?? 'Gemini error',
      err?.response?.status ?? 500,
    );
  }
}
async chat(
  userId: number,
  prompt: string,
  history: { role: 'user' | 'model'; text: string }[] = [],
): Promise<{ response: string }> {
  this.logger.log(`chat called with userId=${userId}`);

  if (!prompt?.trim()) {
    return { response: 'Please provide a message.' };
  }

  const storedCv = await this.cvService.getCvByUser(userId).catch(() => null);

  const existingSummary =
    storedCv?.summary && Object.keys(storedCv.summary).length > 0
      ? (storedCv.summary as CvSummaryDetails)
      : null;

  let cvContext = '';

  if (existingSummary) {
    cvContext = JSON.stringify(existingSummary, null, 2);
  } else if (storedCv?.storagePath) {
    try {
      const buffer = await this.storageService.downloadFile(
        storedCv.storagePath,
      );

      const mockFile: Express.Multer.File = {
        buffer,
        mimetype: storedCv.mimeType,
        originalname: storedCv.storagePath,
        fieldname: 'cv',
        encoding: '7bit',
        size: buffer.length,
        stream: null as any,
        destination: '',
        filename: '',
        path: '',
      };

      const freshSummary = await this.summarizeCv(mockFile);

      if (freshSummary) {
        await this.cvService
          .updateSummary(userId, freshSummary)
          .catch((e) =>
            this.logger.warn(
              `Could not persist CV summary: ${e.message}`,
            ),
          );

        cvContext = JSON.stringify(freshSummary, null, 2);
      }
    } catch (e) {
      this.logger.warn(`Could not load stored CV: ${e.message}`);
    }
  }

  const systemInstruction = {
    parts: [
      {
        text: `
You are a professional career assistant.

Your job:
- Help improve the user's CV
- Analyze their background
- Give detailed, actionable career advice
- Continue conversation naturally using previous messages
- Never restart or ignore context

Always respond ONLY as valid JSON:

{
  "response": "your response here"
}

${cvContext ? `User CV context:\n${cvContext}` : ''}
        `,
      },
    ],
  };

  const contents = [
    ...history.slice(-6).map((msg) => ({
      role: msg.role,
      parts: [{ text: msg.text }],
    })),
    {
      role: 'user',
      parts: [{ text: prompt }],
    },
  ];

  try {
    const { data } = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${this.apiKey}`,
      {
        systemInstruction,
        contents,
        generationConfig: {
          temperature: 0.4,
          responseMimeType: 'application/json',
        },
      },
      {
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: 60000,
      },
    );

    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

    if (!raw) {
      this.logger.warn('Empty Gemini response');
      return { response: 'Sorry, I could not generate a response.' };
    }

    const cleaned = raw
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '');

    try {
      const parsed = JSON.parse(cleaned);

      if (parsed?.response) {
        return { response: parsed.response };
      }

      return { response: cleaned };
    } catch {
      this.logger.warn('Invalid JSON response from Gemini');
      return { response: cleaned };
    }
  } catch (error) {
    console.error('Gemini full error:', error?.response?.data || error);

    this.logger.error(
      `Gemini API error: ${JSON.stringify(
        error?.response?.data || error.message,
        null,
        2,
      )}`,
    );

    return { response: 'Sorry, something went wrong while generating a response.' };
  }
}

  async analyzeJobsForBot(
    userId: number,
    searchQuery: string[]
  ): Promise<{ topJobs: any[]; summary: string }> {

    // Fetch stored CV and summary
    const storedCv = await this.cvService.getCvByUser(userId).catch(() => null);
    const existingSummary = storedCv?.summary && Object.keys(storedCv.summary).length > 0
      ? storedCv.summary as CvSummaryDetails
      : null;

    const hasCV = !!existingSummary;

    // Fetch jobs using the user's search queries
    const jobs = await this.jobService.findAllByQuery(searchQuery);
    console.log(jobs,'jobs');
    
    if (!jobs?.length) {
      this.logger.warn(`No jobs found for user ${userId} with queries: ${searchQuery}`);
      return { topJobs: [], summary: 'ვაკანსიები ვერ მოიძებნა' };
    }

    const prompt = `
You are an expert Technical Recruiter and Career Matching AI.

## YOUR TASK
You will receive a search query, a list of job vacancies${hasCV ? ', and a candidate profile' : ''}.
Your job is to:
1. ${hasCV ? 'Use the provided candidate profile to evaluate each vacancy.' : 'Use the search query to infer what the candidate is looking for.'}
2. Evaluate every vacancy against the candidate profile.
3. Prioritize vacancies that match the search query AND ${hasCV ? 'the candidate profile' : 'the inferred profile'}.
4. Return all vacancies that meaningfully match, ranked by fit score.

---

## STEP 1 — EVALUATE & SCORE EACH VACANCY
For every vacancy compute a match score (0–100) using this priority order:

### Primary factor — search query alignment (up to +30 bonus)
- Does the vacancy title, description, or required stack directly match the search query?
- If yes: apply a +30 bonus on top of the profile-based score.
- If partially: apply +10 to +20.
- If no relation to the query: no bonus.

${hasCV ? `### Secondary factors — profile fit (base score 0–70)
- **Seniority alignment** — does the required level match the candidate's experience?
- **Tech stack overlap** — what fraction of the required stack does the candidate know?
- **Domain/industry fit** — does the job's sector align with their background?
- **Location compatibility** — is it in their city, remote-friendly, or a mismatch?
- **Career trajectory fit** — does the role represent a natural next step for them?` : `### Secondary factors — inferred profile fit (base score 0–70)
- **Role relevance** — does the vacancy match the role inferred from the search query?
- **Tech stack overlap** — does the vacancy require skills implied by the search query?
- **Seniority** — infer seniority from the query if possible (e.g. "senior", "junior")`}

### Score range guidelines:
- **85–100:** Query match + strong profile fit
- **65–84:** Query match with minor gaps, OR strong profile fit without query match
- **50–64:** Partial query match or decent fit with noticeable gaps
- **Below 50:** Omit unless fewer than 3 vacancies pass the threshold

---

## STEP 2 — FILTER & RANK
- Include ALL vacancies with a final score ≥ 50.
- If fewer than 3 vacancies reach 50, include the top 3 regardless of score.
- Sort results by final score descending.
- Do not pad results with poor matches.

---

## IMPORTANT CONSTRAINTS
- Return ONLY valid JSON. No markdown, no explanation outside the JSON.
- Use ONLY the provided vacancy data — do not invent or modify fields.
- Do not duplicate vacancies.
- **Salary Range:**
  1. If the vacancy data contains salary info, use it directly.
  2. If not, estimate based on vacancy title, company, and location:
     - Intern/სტაჟიორი → "₾500 – ₾1,000/mo (est.)"
     - Junior → "₾1,000 – ₾2,000/mo (est.)"
     - Mid → "₾2,500 – ₾4,000/mo (est.)"
     - Senior → "₾4,000 – ₾7,000/mo (est.)"
     - Lead/Principal → "₾7,000 – ₾12,000/mo (est.)"
  3. Detect seniority from title first, then description, then default to Junior.
  4. Use ₾ for Georgian companies/locations, $ for international/remote.
  5. Never return null, "N/A", or empty string.

---

## OUTPUT FORMAT

{
  "summary": "string",
  "topJobs": [
    {
      "id": number,
      "vacancy": "string",
      "location": "string",
      "company": "string",
      "link": "string",
      "publishDate": "string",
      "deadline": "string",
      "salaryRange": "string",
      "match": number,
      "matchReason": "string"
    }
  ]
}

---

SEARCH QUERY: ${JSON.stringify(searchQuery)}

${hasCV ? `CANDIDATE PROFILE:\n${JSON.stringify(existingSummary)}` : ''}

JOB VACANCIES DATA:
${JSON.stringify(jobs)}
  `.trim();

    try {
      const { data } = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${this.apiKey}`,
        {
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.1,
            responseMimeType: 'application/json',
          },
        },
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 120000,
        }
      );

      const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
      const responseText = typeof raw === 'string' ? raw : JSON.stringify(raw);

      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        this.logger.warn(`No JSON in Gemini response for user ${userId}`);
        return { topJobs: [], summary: 'შეცდომა' };
      }

      const repaired = jsonrepair(jsonMatch[0]);
      const parsed = JSON.parse(repaired);

      return {
        topJobs: (parsed.topJobs ?? []).map((job: any) => ({
          ...job,
          page: job.page ?? 0,
          archived: job.archived ?? false,
          queryMatch: job.queryMatch ?? false,
          matchGaps: job.matchGaps ?? [],
        })),
        summary: parsed.summary ?? '',
      };
    } catch (err: any) {
      this.logger.error(`Gemini bot analysis failed for user ${userId}`, err?.response?.data ?? err.message);
      return { topJobs: [], summary: 'შეცდომა' };
    }
  }
}
