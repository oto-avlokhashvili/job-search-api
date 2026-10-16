import { HttpException, Injectable, Logger, NotFoundException, Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import axios from 'axios';
import { AiChatDto, AnalyzeJobDto, ChatDto } from './dto/analyze-job.dto';
import { CvService } from 'src/cv/cv.service';
import { JobService } from 'src/job/job.service';
import { UserService } from 'src/user/user.service';
import { jsonrepair } from 'jsonrepair';
import { CV_SUMMARY_PROMPT_VERSION, CvSummaryDetails } from 'src/cv/dto/cv-summary.dto';
import { AiMatchedJobsService } from 'src/ai-matched-jobs/ai-matched-jobs.service';
import mammoth from 'mammoth';
import { CvParserService } from 'src/cv/cv-parser.service';
import { EntitlementService } from 'src/subscription/entitlement.service';

@Injectable()
export class AiService {
  private readonly apiKey = process.env.GEMINI_API_KEY;
  private readonly openrouterKey = process.env.OPENROUTER_KEY;
  private readonly logger = new Logger(AiService.name);
  constructor(
    private readonly configService: ConfigService,
    private readonly cvService: CvService,
    private readonly jobService: JobService,
    @Inject(forwardRef(() => UserService))
    private readonly userService: UserService,
    private readonly aiMatchedJobsService: AiMatchedJobsService,
    private readonly cvParserService: CvParserService,
    private readonly entitlementService: EntitlementService,
    @InjectQueue('ai') private readonly aiQueue: Queue,
  ) { }

  private async callGemini(
    contents: any[],
    generationConfig: any = { temperature: 0.1, responseMimeType: 'application/json' },
    systemInstruction?: any,
  ): Promise<any> {
    if (!this.apiKey) {
      throw new Error('GEMINI_API_KEY is not configured');
    }

    const preferredModel = this.configService.get<string>('GEMINI_MODEL') || 'gemini-3.5-flash';
    const candidateModels = Array.from(new Set([
      preferredModel,
      'gemini-3.5-flash',
      'gemini-2.5-flash-lite',
      'gemini-3.6-flash',
    ]));

    let lastError: any = null;
    for (const model of candidateModels) {
      if (!model) continue;
      try {
        const payload: any = {
          contents,
          generationConfig,
        };
        if (systemInstruction) {
          payload.systemInstruction = systemInstruction;
        }

        const { data } = await axios.post(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.apiKey}`,
          payload,
          { headers: { 'Content-Type': 'application/json' }, timeout: 120000 },
        );

        this.logger.log(`Gemini call succeeded using model: ${model}`);
        return data;
      } catch (err: any) {
        lastError = err;
        const status = err.response?.data?.error?.code || err.response?.status;
        this.logger.warn(
          `Gemini model ${model} failed (${status}): ${err.response?.data?.error?.message || err.message}`,
        );
      }
    }
    throw lastError;
  }

  private async callOpenRouter(
    messages: { role: string; content: string }[],
    jsonMode = false,
    temperature = 0.1,
  ): Promise<string> {
    if (!this.openrouterKey) {
      this.logger.error('OPENROUTER_KEY is not defined in environment variables');
      throw new Error('OPENROUTER_KEY is not configured');
    }

    const messagesToSend = [...messages];
    if (jsonMode) {
      messagesToSend.unshift({
        role: 'system',
        content: 'You are a JSON-only response assistant. You must output ONLY valid raw JSON. Never output any introductory text, markdown formatting, backticks, explanation, or conversational filler. Start your response directly with \'{\' and end it with \'}\'.'
      });
    }

    const freeModels = [
      this.configService.get<string>('OPENROUTER_MODEL') || 'google/gemini-2.0-flash-exp:free',
      'meta-llama/llama-3.3-70b-instruct:free',
      'qwen/qwen-2.5-72b-instruct:free',
      'deepseek/deepseek-chat:free',
      'openrouter/free',
    ];

    let lastError: any = null;
    for (const model of freeModels) {
      try {
        const payload: any = {
          model,
          messages: messagesToSend,
          temperature,
        };

        if (jsonMode) {
          payload.response_format = { type: 'json_object' };
        }

        const { data } = await axios.post(
          'https://openrouter.ai/api/v1/chat/completions',
          payload,
          {
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${this.openrouterKey}`,
              'HTTP-Referer': 'https://github.com/otonika10/job-search-api',
              'X-Title': 'Job Search API',
            },
            timeout: 30000,
          },
        );

        const text = data?.choices?.[0]?.message?.content;
        if (!text || text.startsWith('User Safety:')) {
          throw new Error(`Invalid response from OpenRouter model ${model}`);
        }

        this.logger.log(`OpenRouter call successfully generated content using model: ${model}`);
        return text;
      } catch (err: any) {
        lastError = err;
        this.logger.warn(`OpenRouter model ${model} failed: ${err.response?.data?.error?.message || err.message}`);
      }
    }

    throw lastError;
  }

  private extractJson(text: string): string {
    const markdownMatch = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/i);
    if (markdownMatch) {
      return markdownMatch[1].trim();
    }
    const braceMatch = text.match(/(\{[\s\S]*\})/);
    if (braceMatch) {
      return braceMatch[1].trim();
    }
    return text.trim();
  }




async summarizeCv(cvFile: Express.Multer.File): Promise<CvSummaryDetails | null> {
  const summary = await this.requestCvSummary(cvFile);
  return summary ? { ...summary, promptVersion: CV_SUMMARY_PROMPT_VERSION } : null;
}

private async requestCvSummary(cvFile: Express.Multer.File): Promise<CvSummaryDetails | null> {
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
- The candidate can be from ANY profession or industry (IT, finance, accounting, sales, marketing, healthcare, logistics, hospitality, engineering, law, education, etc.). Never assume an IT background.
- detectedRole: the candidate's actual professional role as it would appear in a job title (e.g. "Financial Analyst", "Accountant", "Sales Manager", "Angular Developer")
- Lowercase stems for skills, English only
- Max 8 primary skills (core professional skills, tools or technologies of their field — e.g. "ifrs", "financial modeling", "sap" for finance; "angular", "typescript" for frontend)
- Max 6 secondary skills (supporting tools, methodologies, soft/domain skills)
- domains: the professional field(s) and industries they work in (e.g. ["finance", "banking"], ["web development"], ["retail sales"])
- Ignore formatting artifacts: font names, colors, bullet styles (Arial, Calibri, bold, etc.)
- locationPreference: extract city if mentioned, otherwise "Not specified"
- careerDirection: infer the direction they are heading, not just current role

## SEARCH QUERIES — role titles and distinctive specializations (NO seniority prefixes):

These queries are matched against vacancy titles on Georgian job portals (jobs.ge, hr.ge, myjobs.ge, LinkedIn).
Generate 6–12 queries that would find vacancies this candidate is qualified for.

### STRICT RULES:
- NEVER include seniority levels (e.g., Do NOT use "Senior", "Mid", "Junior", "Lead", "Head", "უფროსი", "უმცროსი").
- Include the candidate's role title and its close equivalents/synonyms they are qualified for (e.g. "Financial Analyst", "FP&A Analyst", "Finance Specialist").
- Provide both English terms and their standard Georgian job portal equivalents (e.g. "Financial Analyst" + "ფინანსური ანალიტიკოსი", "Accountant" + "ბუღალტერი").
- Add 1–4 distinctive core skills, tools or specializations that appear in vacancy titles of this field (e.g. "Angular", "Cypress", "IFRS", "SAP", "1C").
- Do NOT output standalone generic nouns that match unrelated jobs (e.g. avoid isolated "developer", "manager", "specialist", "analyst", "ინჟინერი", "დეველოპერი", "მენეჯერი", "სპეციალისტი") — always combine them with the field (e.g. "Finance Manager", "ფინანსური მენეჯერი").
- Keep tool/technology names in English when combined with Georgian nouns (e.g., "Angular დეველოპერი", not "ანგულარ დეველოპერი").

---

### QUERY EXAMPLES BY SPECIALIZATION (follow the pattern, not the field):

#### Example 1: Angular Developer
[
  "Angular",
  "Angular Developer",
  "Angular დეველოპერი",
  "Front-end",
  "Frontend"
]

#### Example 2: Financial Analyst / Finance Team Lead
[
  "Financial Analyst",
  "ფინანსური ანალიტიკოსი",
  "Finance Manager",
  "ფინანსური მენეჯერი",
  "FP&A",
  "Financial Controller",
  "Finance",
  "ფინანსების"
]

#### Example 3: Accountant
[
  "Accountant",
  "ბუღალტერი",
  "Accounting",
  "ბუღალტრული აღრიცხვის",
  "IFRS",
  "1C"
]

#### Example 4: Sales Manager
[
  "Sales Manager",
  "გაყიდვების მენეჯერი",
  "Sales Representative",
  "გაყიდვების წარმომადგენელი",
  "B2B Sales",
  "Account Manager"
]

## SALARY ESTIMATES — infer realistic market rates for this candidate:

### Inputs to consider (in order of priority):
  1. seniorityLevel (already detected above)
  2. detectedRole and primarySkills (some fields and specializations pay more than others)
  3. locationPreference — if the candidate is explicitly local, weight the local market more
  4. Any salary expectations mentioned in the CV (use as a signal, not a hard constraint)

### Markets to always return (all two, every time):
  - "georgia" — Tbilisi local market, gross monthly in GEL
  - "remote" — Remote/international roles, gross monthly in GEL
    (convert from USD using approximate current rate: 1 USD ≈ 2.7 GEL)

### Rules:
  - Return a formatted string: "MIN-MAX GEL" (e.g. "3500-5000 GEL")
  - Ranges should reflect the realistic hiring band for this role + seniority, not the absolute floor or ceiling of the market
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
  let extractedText: string | null = null;

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

  try {
    const data = await this.callGemini(contents, { temperature: 0, responseMimeType: 'application/json' });
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
        try {
          return JSON.parse(jsonrepair(clean)) as CvSummaryDetails;
        } catch {
          this.logger.warn('summarizeCv: failed to parse Gemini response', raw);
          return null;
        }
      }
    }
  } catch (geminiError: any) {
    this.logger.warn(
      `summarizeCv: Gemini failed, falling back to OpenRouter. Error: ${geminiError.message || geminiError}`,
    );
    try {
      if (isPdf && !extractedText) {
        try {
          extractedText = await this.cvParserService.parseCV(cvFile);
        } catch (err) {
          this.logger.warn('summarizeCv fallback: failed to parse PDF CV', err.message);
        }
      }

      const promptText = `CV Content:\n\n${extractedText || ''}\n\n${CV_SUMMARY_PROMPT}`;
      const messages = [{ role: 'user', content: promptText }];
      
      const raw = await this.callOpenRouter(messages, true, 0);

      const clean = this.extractJson(raw);
      try {
        return JSON.parse(clean) as CvSummaryDetails;
      } catch {
        try {
          return JSON.parse(jsonrepair(clean)) as CvSummaryDetails;
        } catch {
          this.logger.warn('summarizeCv (OpenRouter fallback): failed to parse response', raw);
          return null;
        }
      }
    } catch (orError: any) {
      this.logger.error(
        `summarizeCv: OpenRouter fallback also failed: ${orError.response?.data || orError.message || orError}`,
      );
      throw geminiError;
    }
  }

  return null;

}

  /**
   * Returns the user's CV summary, regenerating it from the stored CV file when it is
   * missing, incomplete, or was built by an older version of the summary prompt.
   * Falls back to the stored summary's searchQueries if regeneration fails.
   */
  async getUsableCvSummary(
    userId: number,
    storedCv: { summary: CvSummaryDetails | null; storagePath?: string | null },
  ): Promise<CvSummaryDetails | null> {
    const stored = storedCv.summary && typeof storedCv.summary === 'object' ? storedCv.summary : null;
    const hasQueries = Array.isArray(stored?.searchQueries) && stored.searchQueries.length > 0;

    if (stored && hasQueries && stored.detectedRole && stored.promptVersion === CV_SUMMARY_PROMPT_VERSION) {
      return stored;
    }

    if (storedCv.storagePath) {
      try {
        this.logger.log(`Summary missing, incomplete or outdated for user ${userId}. Analyzing CV...`);
        const { buffer, mimeType, originalName } = await this.cvService.downloadCv(userId);
        const cvFile = {
          buffer,
          mimetype: mimeType,
          originalname: originalName,
          size: buffer.length,
        } as Express.Multer.File;

        const fresh = await this.summarizeCv(cvFile);
        if (fresh) {
          await this.cvService.updateSummary(userId, fresh);
          this.logger.log(`CV summary generated and saved for user ${userId}`);
          return fresh;
        }
      } catch (e: any) {
        this.logger.warn(
          `Could not summarize CV for user ${userId}: ${e.message}`,
          JSON.stringify(e.response?.data, null, 2),
        );
      }
    }

    // Fallback: keep using the stored summary if it at least has searchQueries
    if (stored && hasQueries) {
      this.logger.log(`Using fallback summary with existing searchQueries for user ${userId}`);
      return {
        ...stored,
        detectedRole: stored.detectedRole || 'Specialist',
        seniorityLevel: stored.seniorityLevel || 'Mid',
        primarySkills: stored.primarySkills || [],
        secondarySkills: stored.secondarySkills || [],
        domains: stored.domains || [],
        locationPreference: stored.locationPreference || 'Tbilisi',
        careerDirection: stored.careerDirection || stored.detectedRole || 'Specialist',
      };
    }

    return null;
  }

  async jobsearchWithCv(
  userId: number,
): Promise<{ response: any; comment: string }> {
    try {
      // ── 1. Fetch stored CV ────────────────────────────────────────────────────
      const storedCv = await this.cvService.getCvByUser(userId).catch(() => null);

      if (!storedCv) {
        return {
          response: { candidateProfile: null, summary: null, strengths: [], skillGaps: [], topJobs: [] },
          comment: 'CV არ არის ატვირთული',
        };
      }

      // ── 2–3. Load summary, regenerating it if missing, incomplete or outdated ──
      const summary = await this.getUsableCvSummary(userId, storedCv);
      if (!summary) {
        return {
          response: { candidateProfile: null, summary: null, strengths: [], skillGaps: [], topJobs: [] },
          comment: 'გთხოვთ ხელახლა ატვირთოთ თქვენი CV',
        };
      }

      // ── 4. Use searchQueries from summary to find jobs ───────────────────────
      const searchTerms: string[] = summary.searchQueries ?? [];
      let jobs = await this.jobService.findAllByQuery(searchTerms);
      this.logger.log(`Search terms: ${JSON.stringify(searchTerms)}`);
      this.logger.log(`Jobs found initially: ${jobs.length}`);

      // Fetch already matched jobs to exclude them
      const matchedJobs = await this.aiMatchedJobsService.findAllMatched(userId);
      const matchedJobLinks = new Set(matchedJobs.map((mj) => mj.link));
      const matchedJobIds = new Set(matchedJobs.map((mj) => mj.id));

      // Exclude jobs already in AI matched jobs
      jobs = jobs.filter((job) => !matchedJobLinks.has(job.link) && !matchedJobIds.has(job.id));
      this.logger.log(`Jobs after excluding already matched: ${jobs.length}`);

      if (jobs.length === 0) {
        return {
          response: {
            candidateProfile: {
              detectedRole: summary.detectedRole,
              seniorityLevel: summary.seniorityLevel,
              primarySkills: summary.primarySkills || [],
              secondarySkills: summary.secondarySkills || [],
              domains: summary.domains || [],
              locationPreference: summary.locationPreference,
              careerDirection: summary.careerDirection,
            },
            summary: `${summary.detectedRole} (${summary.seniorityLevel})`,
            strengths: summary.primarySkills || [],
            skillGaps: [],
            searchQueries: summary.searchQueries,
            topJobs: [],
          },
          comment: 'შესაბამისი ახალი ვაკანსიები ვერ მოიძებნა',
        };
      }

      // Limit to at most 20 jobs
      if (jobs.length > 20) {
        jobs = jobs.slice(0, 20);
      }
      this.logger.log(`Jobs to send to AI: ${jobs.length}`);

      // ── 4. Rank & filter jobs via Gemini ─────────────────────────────────────
    const prompt = `
    You are an expert Recruiter and Career Matching AI covering every profession and industry
    (IT, finance, accounting, sales, marketing, healthcare, logistics, hospitality, engineering, law, education, etc.).

    ## YOUR TASK
    Evaluate job vacancies against the candidate profile and return ONLY relevant matches.
    Vacancies may be written in English or Georgian — judge them by meaning, not exact wording.

    ---

    ## CRITICAL RULE — ROLE RELEVANCE FILTER
    The candidate's detected role is "${summary.detectedRole}", heading towards "${summary.careerDirection}",
    working in: ${JSON.stringify(summary.domains ?? [])}.

    **SKIP a vacancy entirely (do not score or output it) only if it belongs to a clearly different profession
    that the candidate's experience does not qualify them for** (e.g. a nurse vacancy for a software developer,
    a cashier vacancy for a financial analyst, a driver vacancy for an accountant).

    Do NOT skip a vacancy just because:
    - its title is worded differently or is in Georgian (e.g. "ფინანსური ანალიტიკოსი" = "Financial Analyst")
    - it is in a different industry while the job function is the same (e.g. a financial analyst at a retail company is still a financial analyst job)
    - it is one seniority level above or below the candidate (e.g. "Finance Team Lead" for a senior financial analyst)

    ---

    ## STEP 1 — SCORE EACH REMAINING VACANCY (0–100)

    ### Role / function match (0–60 points)
    - **+60** same role as detectedRole "${summary.detectedRole}" (including synonyms and Georgian equivalents)
    - **+40–50** same professional field/function as "${summary.careerDirection}" but a different specialization
    - **+20–35** adjacent role that uses a large part of the candidate's skill set
    - **+0–15** different function with only partial skill overlap

    ### Seniority alignment (0–20 points)
    - Candidate seniority: "${summary.seniorityLevel}" (levels: Junior → Mid → Senior → Lead → Principal)
    - Treat "Team Lead", "Head of", "Manager of a team", "უფროსი" titles as Lead level
    - **+20** exact match (Junior→Junior)
    - **+10** one level apart (Senior→Lead)
    - **+0** two+ levels apart (Junior→Senior) — do not exclude, but penalize heavily

    ### Skills overlap (0–15 points)
    - Count how many required skills/tools match primarySkills: ${JSON.stringify(summary.primarySkills)}
    - Count secondary matches from: ${JSON.stringify(summary.secondarySkills)}
    - Award proportionally

    ### Location (0–5 points)
    - **+5** matches "${summary.locationPreference}" or remote
    - **+0** different city

    ---

    ## STEP 2 — FILTER & RANK
    - MINIMUM score to include: **60**
    - **Hard rule: NEVER include a vacancy scoring below 60. Do not pad the results to reach a minimum count — if fewer than 5 (or even zero) vacancies reach 60, return only those that do.**
    - Return up to 10 of the top-ranked vacancies that score 60 or above.
    - Sort descending by score

    ---

    ## SALARY ESTIMATION (if not provided)
    - Estimate a realistic gross monthly range for that specific role, seniority and market
      (salaries differ a lot between professions — do not apply IT salary levels to other fields)
    - Format: "₾2,500 – ₾4,000/mo (est.)"
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
      "searchQueries": ${JSON.stringify(summary.searchQueries ?? [])},
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

      let successData: any = null;
      let attemptError: any = null;

      try {
        successData = await this.callGemini([{ parts: [{ text: prompt }] }], {
          temperature: 0.1,
          responseMimeType: 'application/json',
        });
      } catch (geminiErr: any) {
        attemptError = geminiErr;
        this.logger.warn('jobsearchWithCv: Gemini failed, trying OpenRouter fallback...');
        try {
          const messages = [{ role: 'user', content: prompt }];
          const raw = await this.callOpenRouter(messages, true, 0.1);
          successData = {
            candidates: [
              {
                content: {
                  parts: [{ text: raw }],
                },
              },
            ],
          };
        } catch (orError: any) {
          this.logger.error(
            `jobsearchWithCv: OpenRouter fallback also failed: ${orError.response?.data || orError.message || orError}`,
          );
        }
      }

      if (successData) {
        try {
          const raw = successData?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
          const responseText = typeof raw === 'string' ? raw : JSON.stringify(raw);

          const cleanJson = this.extractJson(responseText);
          const repaired = jsonrepair(cleanJson);
          const parsedResponse = JSON.parse(repaired);

          if (typeof parsedResponse === 'object' && parsedResponse !== null && !Array.isArray(parsedResponse)) {
            parsedResponse.topJobs = (Array.isArray(parsedResponse.topJobs) ? parsedResponse.topJobs : []).filter(
              (job: any) => typeof job?.match === 'number' && job.match >= 60,
            );
            await this.aiMatchedJobsService.createBulk(userId, parsedResponse.topJobs || []);
            return {
              response: parsedResponse,
              comment: `ნაპოვნია ${parsedResponse.topJobs?.length ?? 0} ვაკანსია`,
            };
          }
        } catch (parseErr: any) {
          this.logger.error('Failed to parse Gemini/OpenRouter response or create matched jobs', parseErr);
          attemptError = parseErr;
        }
      }

      this.logger.warn('jobsearchWithCv: falling back to raw unranked jobs due to error:', attemptError?.message || attemptError);
      const rawJobs = jobs.map((job: any) => ({
        ...job,
        salaryRange: null,
        match: 0,
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
    } catch (globalError: any) {
      this.logger.error(`[jobsearchWithCv] Critical unexpected error for user ${userId}:`, globalError);
      return {
        response: { candidateProfile: null, summary: null, strengths: [], skillGaps: [], topJobs: [] },
        comment: `შეცდომა: ${globalError.message || globalError}`,
      };
    }
  }

  /**
   * Dispatches daily AI job search & matching tasks to BullMQ for all eligible users.
   * Non-blocking: enqueues all jobs into Redis in milliseconds.
   */
  async dispatchDailyAiAnalysis(): Promise<{ queuedCount: number }> {
    const allUsers = await this.userService.findAll();
    const eligibleUsers = allUsers.filter(
      (u) =>
        this.entitlementService.canUseAiJobSearch(u) &&
        u.receiveMessages !== false &&
        (u.telegramChatId || (u.email && u.isEmailVerified)),
    );

    this.logger.log(`🤖 Queueing daily AI analysis for ${eligibleUsers.length} eligible users...`);

    let queuedCount = 0;
    for (const user of eligibleUsers) {
      await this.aiQueue.add(
        'analyze-user-cv',
        { userId: user.id },
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: true,
          removeOnFail: { age: 7 * 24 * 3600 },
        },
      );
      queuedCount++;
    }

    this.logger.log(`✅ Successfully queued ${queuedCount} AI analysis jobs into BullMQ.`);
    return { queuedCount };
  }

async chat(
  userId: number,
  prompt: string,
  history: { role: 'user' | 'model'; text: string }[] = [],
): Promise<{ response: string; jobs?: any[]; searchTriggered?: boolean; isError?: boolean }> {
  this.logger.log(`chat called with userId=${userId}`);

  if (!prompt?.trim()) {
    return { response: 'Please provide a message.', jobs: [] };
  }

  const storedCv = await this.cvService.getCvByUser(userId).catch(() => null);

  const existingSummary =
    storedCv?.summary && Object.keys(storedCv.summary).length > 0
      ? (storedCv.summary as CvSummaryDetails)
      : null;

  let cvContext = '';

  if (existingSummary) {
    cvContext = JSON.stringify(existingSummary, null, 2);
  } else if (storedCv) {
    try {
      const { buffer, mimeType, originalName } = await this.cvService.downloadCv(userId);
      const mockFile: Express.Multer.File = {
        buffer,
        mimetype: mimeType,
        originalname: originalName,
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
If the user asks to browse, list, search, or find specific job vacancies or roles (e.g. "find me a React developer job", "show financial analyst vacancies", "show vacancies in Tbilisi", "look up accountant jobs"):
  1. Set the JSON field "searchTriggered" to true.
  2. Extract 1 to 5 relevant query terms. For each query term, ALWAYS include both its English term and its Georgian translation/transliteration as separate elements in the "searchQueries" array (e.g., if the search is for Angular, return ["angular", "ანგულარ"]; if for React, return ["react", "რეაქტ"]; if for financial analyst, return ["financial analyst", "ფინანსური ანალიტიკოსი"]; if for accountant, return ["accountant", "ბუღალტერი"]).
  3. Keep the response text conversational (e.g., "I have searched our database for React Developer vacancies. Here is what I found:") and place it in the "response" field.

For general questions, career advice, CV review, or other messages where job search is NOT required:
  1. Set the JSON field "searchTriggered" to false.
  2. Set "searchQueries" to an empty array [].
  3. Answer the user's question conversationally in the "response" field.

## Response format
Always respond ONLY as valid JSON matching this exact structure:
{
  "response": "your conversational response text here (used when jobs are found, e.g. 'Sure, here are the jobs I found:')",
  "noJobsResponse": "your fallback conversational response text in the EXACT same language (used ONLY if no jobs are found in the database, e.g. 'Sorry, no vacancies were found matching your criteria. Please try again with different keywords.')",
  "searchTriggered": true | false,
  "searchQueries": ["query1", "query2"]
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
    let raw = '';
    try {
      const data = await this.callGemini(
        contents,
        {
          temperature: 0.4,
          responseMimeType: 'application/json',
        },
        systemInstruction,
      );
      raw = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    } catch (geminiErr: any) {
      this.logger.warn(`chat: Gemini failed, trying OpenRouter fallback... Error: ${geminiErr.message}`);
      const messages = [
        { role: 'system', content: JSON.stringify(systemInstruction) },
        ...contents.map((c: any) => ({
          role: c.role === 'model' ? 'assistant' : c.role,
          content: c.parts?.[0]?.text || '',
        })),
      ];
      raw = await this.callOpenRouter(messages, true, 0.4);
    }

    if (!raw) {
      this.logger.warn('Empty AI chat response');
      return { response: 'Sorry, I could not generate a response.', jobs: [] };
    }

    const cleaned = this.extractJson(raw);

    try {
      const parsed = JSON.parse(cleaned);

      if (parsed && typeof parsed === 'object') {
        let jobs: any[] = [];
        if (
          parsed.searchTriggered &&
          Array.isArray(parsed.searchQueries) &&
          parsed.searchQueries.length > 0
        ) {
          try {
            jobs = await this.jobService.findAllByQuery(parsed.searchQueries);
            if (jobs.length > 10) {
              jobs = jobs.slice(0, 10);
            }
          } catch (dbErr) {
            this.logger.warn(
              `Failed to find jobs for query ${parsed.searchQueries}: ${dbErr.message}`,
            );
          }
        }
        let responseText = parsed.response || cleaned;
        if (parsed.searchTriggered && jobs.length === 0) {
          responseText = parsed.noJobsResponse || responseText;
        }

        return {
          response: responseText,
          jobs,
          searchTriggered: !!parsed.searchTriggered,
        };
      }

      return { response: cleaned, jobs: [] };
    } catch {
      this.logger.warn('Invalid JSON response from Gemini');
      return { response: cleaned, jobs: [] };
    }
  } catch (error) {
    this.logger.warn(`chat: Gemini failed, trying OpenRouter fallback. Error: ${error.message}`);
    try {
      const systemInstructionText = systemInstruction.parts[0].text;
      const messages = [
        { role: 'system', content: systemInstructionText },
        ...history.slice(-6).map((msg) => ({
          role: msg.role === 'model' ? 'assistant' : msg.role,
          content: msg.text,
        })),
        { role: 'user', content: prompt }
      ];

      const raw = await this.callOpenRouter(messages, true, 0.4);

      const cleaned = raw
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, '');

      try {
        const parsed = JSON.parse(cleaned);

        if (parsed && typeof parsed === 'object') {
          let jobs: any[] = [];
          if (
            parsed.searchTriggered &&
            Array.isArray(parsed.searchQueries) &&
            parsed.searchQueries.length > 0
          ) {
            try {
              jobs = await this.jobService.findAllByQuery(parsed.searchQueries);
              if (jobs.length > 10) {
                jobs = jobs.slice(0, 10);
              }
            } catch (dbErr) {
              this.logger.warn(
                `Failed to find jobs for query ${parsed.searchQueries}: ${dbErr.message}`,
              );
            }
          }
          let responseText = parsed.response || cleaned;
          if (parsed.searchTriggered && jobs.length === 0) {
            responseText = parsed.noJobsResponse || responseText;
          }

          return {
            response: responseText,
            jobs,
            searchTriggered: !!parsed.searchTriggered,
          };
        }

        return { response: cleaned, jobs: [] };
      } catch {
        this.logger.warn('Invalid JSON response from OpenRouter fallback');
        return { response: cleaned, jobs: [] };
      }
    } catch (orError: any) {
      this.logger.error(`chat: OpenRouter fallback also failed: ${orError.response?.data || orError.message || orError}`);

      console.error('Gemini full error:', error?.response?.data || error);

      const isRateLimit = error?.response?.status === 429 || error?.status === 429;

      this.logger.error(
        `Gemini API error: ${JSON.stringify(
          error?.response?.data || error.message,
          null,
          2,
        )}`,
      );

      const isGeorgian = /[\u10D0-\u10FF]/.test(prompt);
      const responseText = isRateLimit
        ? (isGeorgian
            ? 'მოთხოვნების ლიმიტი ამოიწურა. გთხოვთ, მოიცადოთ რამდენიმე წამი და სცადოთ თავიდან.'
            : 'Rate limit exceeded. Please wait a few seconds and try again.')
        : (isGeorgian
            ? 'სამწუხაროდ, პასუხის გენერირებისას დაფიქსირდა შეცდომა. გთხოვთ სცადოთ მოგვიანებით.'
            : 'Sorry, something went wrong while generating a response. Please try again later.');

      return {
        response: responseText,
        jobs: [],
        isError: true,
      };
    }
  }
}
}
