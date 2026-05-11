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
import mammoth from 'mammoth';
import { CvParserService } from 'src/cv/cv-parser.service';

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
    private readonly cvParserService: CvParserService,
  ) { }



async summarizeCv(
  cvFile: Express.Multer.File,
  retries = 3,
  delayMs = 2000,
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

## SEARCH QUERIES — 8–14 tokens total used to match this candidate to job vacancies:

### What QUALIFIES as a search query token (pick from these categories only):
  1. Role nouns — the job titles a recruiter would search for
     (e.g. "developer", "engineer", "analyst", "designer", "architect")
  2. Primary technology / framework / platform the candidate is strongly identified with
     (e.g. "angular", "react", "django", — only the 2–3 most defining ones, not every skill)
  3. Domain words — the industry or product area they work in
     (e.g. "frontend", "backend", "mobile", "devops", "data")

### What does NOT qualify:
  - Generic tools everyone uses: git, agile, scrum, jira, docker, rest, api, sql, html, css
  - Acronyms and patterns (spa, mvc, oop, ci/cd)
  - Any skill already in primarySkills or secondarySkills (no duplication)
  - Seniority words: junior, mid, senior, lead
  - City names, company names, certification names

### Formatting rules:
  - 1 word per token (no spaces, no multi-word phrases)
  - Every token must appear TWICE: once in English, once in Georgian translation
    (e.g. "developer" AND "დეველოპერი" as two separate entries)
  - For tokens with a hyphenated variant, include BOTH forms as separate tokens:
    "frontend" → also add "front-end" (each still needs its Georgian pair)
  - No duplicates

## SALARY ESTIMATES — infer realistic market rates for this candidate:

### Inputs to consider (in order of priority):
  1. seniorityLevel (already detected above)
  2. detectedRole and primarySkills (some stacks pay more than others)
  3. locationPreference — if the candidate is explicitly local, weight the local market more
  4. Any salary expectations mentioned in the CV (use as a signal, not a hard constraint)

### Markets to always return (all two, every time):
  - "georgia" — Tbilisi local market, gross monthly in GEL
  - "remote" — Remote/international roles, gross monthly in GEL
    (convert from USD using approximate current rate: 1 USD ≈ 2.7 GEL)

### Rules:
  - Return a formatted string: "MIN-MAX GEL" (e.g. "0000-0000 GEL")
  - Ranges should reflect the realistic hiring band for this role + seniority,
    not the absolute floor or ceiling of the market
  - Round to the nearest 100
  - If the role is niche or the stack is high-demand, skew the range upward slightly
  - Do NOT return null or omit any market — estimate even if uncertain

Return ONLY valid raw JSON, no markdown, no backticks:
{
  "detectedRole": "string",
  "seniorityLevel": "Junior | Mid | Senior | Lead | Principal",
  "primarySkills": ["string"],
  "secondarySkills": ["string"],
  "domains": ["string"],
  "locationPreference": "string",
  "careerDirection": "string",
  "searchQueries": ["string"],
  "salaryEstimates": {
  "georgia": "string",
  "remote": "string"
}
}
`.trim();

  let contents: object[];

  const isPdf =
    cvFile.mimetype === 'application/pdf' ||
    cvFile.originalname?.endsWith('.pdf');

  if (isPdf) {
    contents = [
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
    ];
  } else {
    let extractedText: string;

    try {
      extractedText = await this.cvParserService.parseCV(cvFile);
    } catch (err) {
      this.logger.warn('summarizeCv: failed to parse CV file', err.message);
      return null;
    }

    if (!extractedText?.trim()) {
      this.logger.warn('summarizeCv: extracted empty text from CV');
      return null;
    }

    contents = [
      {
        parts: [
          {
            text: `CV Content:\n\n${extractedText}\n\n${CV_SUMMARY_PROMPT}`,
          },
        ],
      },
    ];
  }

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const { data } = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${this.apiKey}`,
        {
          contents,
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
          this.logger.warn('summarizeCv: failed to parse Gemini response', raw);
          return null;
        }
      }
    } catch (err: any) {
      const status = err.response?.data?.error?.code;
      const isRetryable = status === 503 || status === 429;

      this.logger.warn(
        `summarizeCv: attempt ${attempt}/${retries} failed (${status})`,
        JSON.stringify(err.response?.data, null, 2),
      );

      if (!isRetryable || attempt === retries) {
        throw err;
      }

      const wait = delayMs * attempt; // 2s, 4s, 6s
      this.logger.log(`summarizeCv: retrying in ${wait}ms...`);
      await new Promise((res) => setTimeout(res, wait));
    }
  }

  return null;
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
    } catch (e: any) {
  this.logger.warn(
    `Could not summarize CV for user ${userId}: ${e.message}`,
    JSON.stringify(e.response?.data, null, 2),
  );
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
- EXCLUDE any vacancy that is NOT in ${summary.domains}
- EXCLUDE any vacancy that is NOT in secondarySkills or primary skills ${summary.secondarySkills}

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
  "searchQueries": ${summary.searchQueries},
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
You are a friendly, knowledgeable general-purpose assistant embedded in a career platform.

## Core behavior
- Answer ANY question the user asks — career, general knowledge, coding, life advice, etc.
- ALWAYS reply in the EXACT same language the user used. If they write in Georgian, reply in Georgian. If French, reply in French. Never switch languages unless asked.
- Be conversational, warm, and genuinely helpful.
- Use previous messages for context — never restart the conversation.

## Career & CV assistance
When the user asks career-related questions:
- Help improve their CV, cover letters, and LinkedIn profile
- Analyze their background and suggest career paths
- Give detailed, actionable interview and job application advice
${cvContext ? `- Use the user's CV context below when relevant` : ''}

## Job listing / job search questions — IMPORTANT
If the user asks something like:
- "What jobs do you have?"
- "Show me job openings"
- "Are there any vacancies for [role]?"
- "Find me a job in [field/city]"
- or any similar request to browse, list, or find specific job postings

Then do NOT attempt to list jobs yourself. Instead, guide them clearly:
  1. Explain that live job listings are available in the Job Search section of the platform
  2. Tell them to switch to "Job Search" mode (or navigate to the Jobs tab)
  3. Suggest useful search tips: what keywords, filters, or location to use based on their question
  4. If their CV context is available, optionally mention roles that seem like a good fit and suggest searching for those
  5. Do not suggest to improve linkedin profile.

## Response format
Always respond ONLY as valid JSON:
{
  "response": "your response here"
}

${cvContext ? `## User CV context\n${cvContext}` : ''}
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
}
