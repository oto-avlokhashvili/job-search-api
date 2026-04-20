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

  SEARCH_TERMS_PROMPT = (prompt: string) => `
Extract search terms to search job vacancies from the following query.

Rules for searchTerms:
- Max 8 lowercase stems
- For EACH detected technology/role, include ALL of these variations:
  - The exact term (e.g. "angular")
  - Its Georgian equivalent (e.g. "ანგულარი")
  - Its implied category in English (e.g. "frontend", "front-end", "developer")
  - Its implied category in Georgian (e.g. "ფრონტენდი", "დეველოპერი")
- Implication map (1 level only, do not chain):
  Angular | React | Vue | Svelte → frontend, front-end, developer
  Python | Node.js | Laravel | Django | Spring → backend, back-end, developer
  Figma | Adobe XD | Sketch → designer, ui/ux
  AWS | Docker | Kubernetes | Terraform → devops, cloud, engineer
  Swift | Kotlin | Flutter | React Native → mobile, developer
- No duplicates
- EXCLUDE generic words: "vacancy", "ვაკანსია", "job", "ვაკანსიებს", "find", "search"

Return ONLY valid raw JSON, no markdown, no backticks:
{ "searchTerms": ["string"] }

Search Query: "${prompt}"
`.trim();

public async analyzeInput(
  prompt: string,
  cvFile?: Express.Multer.File,
  existingSummary?: CvSummaryDetails | null
): Promise<{ summary: CvSummaryDetails | null; searchTerms: string[] }> {

  // ── Branch 1: summary already exists — only extract search terms ──
  if (existingSummary) {
    const { data } = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${this.apiKey}`,
      {
        contents: [{ parts: [{ text: this.SEARCH_TERMS_PROMPT(prompt) }] }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json' },
      },
      { headers: { 'Content-Type': 'application/json' }, timeout: 15000 }
    );

    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}';
    try {
      console.log('call 1');
      const parsed = JSON.parse(raw);
      return { summary: existingSummary, searchTerms: parsed.searchTerms ?? [] };
    } catch {
      this.logger.warn('Failed to parse searchTerms response');
      return { summary: existingSummary, searchTerms: [] };
    }
  }

  // ── Branch 2: full analysis — CV + search terms ──
  const fullPrompt = `
Analyze the input and return two things:

1. "searchTerms" — keywords to search job vacancies
2. "summary" — candidate profile (only if CV is provided, otherwise null)

Rules for searchTerms:
- Max 8 lowercase stems
- For EACH detected technology/role, include ALL of these variations:
  - The exact term (e.g. "angular")
  - Its Georgian equivalent (e.g. "ანგულარი")
  - Its implied category in English (e.g. "frontend", "front-end", "developer")
  - Its implied category in Georgian (e.g. "ფრონტენდი", "დეველოპერი")
- Implication map (1 level only, do not chain):
  Angular | React | Vue | Svelte → frontend, front-end, developer
  Python | Node.js | Laravel | Django | Spring → backend, back-end, developer
  Figma | Adobe XD | Sketch → designer, ui/ux
  AWS | Docker | Kubernetes | Terraform → devops, cloud, engineer
  Swift | Kotlin | Flutter | React Native → mobile, developer
- If both prompt and CV provided → prioritize terms appearing in BOTH
- If only CV → extract from CV only
- No duplicates
- EXCLUDE generic words: "vacancy", "ვაკანსია", "job", "ვაკანსიებს", "find", "search"

Rules for summary (only when CV is present):
- Lowercase stems for skills, English + Georgian versions
- Max 8 primary skills, max 6 secondary skills
- Ignore formatting, fonts, colors (Arial, Calibri, bold, etc.)
- null if no CV provided
- Seniority detection — infer from years of experience and scope:
  - 0–1 years or explicitly "intern/სტაჟიორი" → Junior
  - 1–2 years → Junior
  - 2–4 years → Mid
  - 4–7 years → Senior
  - 7+ years or team lead responsibilities → Lead
  - Principal/Staff/Architect level → Principal
  - If years are unclear, infer from project complexity, responsibilities, and technologies used
  - Never default to Junior without evidence — if unsure between two levels, pick the higher one

Return ONLY valid raw JSON, no markdown, no backticks:
{
  "searchTerms": ["string"],
  "summary": {
    "detectedRole": "string",
    "seniorityLevel": "Junior | Mid | Senior | Lead | Principal",
    "primarySkills": ["string"],
    "secondarySkills": ["string"],
    "domains": ["string"],
    "locationPreference": "string",
    "careerDirection": "string"
  } | null
}

Search Query: "${prompt}"
  `.trim();

  const parts: any[] = [];
  if (cvFile) {
    parts.push({
      inline_data: {
        mime_type: cvFile.mimetype,
        data: cvFile.buffer.toString('base64'),
      },
    });
  }
  parts.push({ text: fullPrompt });

  const { data } = await axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${this.apiKey}`,
    {
      contents: [{ parts }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json' },
    },
    { headers: { 'Content-Type': 'application/json' }, timeout: 15000 }
  );

  const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}';
  try {
    console.log('call 2');
    const parsed = JSON.parse(raw);
    return {
      summary: parsed.summary ?? null,
      searchTerms: parsed.searchTerms ?? [],
    };
  } catch {
    const clean = raw.replace(/```json|```/gi, '').trim();
    try {
      const parsed = JSON.parse(clean);
      return {
        summary: parsed.summary ?? null,
        searchTerms: parsed.searchTerms ?? [],
      };
    } catch {
      this.logger.warn('Failed to parse analyzeInput response');
      return { summary: null, searchTerms: [] };
    }
  }
}

async aiChat(
  userId: number,
  body: AiChatDto,
  files?: Express.Multer.File[]
): Promise<{ response: any; comment: string }> {

  let cvFile = files?.find(f =>
    f.mimetype === 'application/pdf' || f.mimetype.startsWith('text/')
  );

  // Fetch stored CV safely
  const storedCv = await this.cvService.getCvByUser(userId).catch(() => null);
  const existingSummary = storedCv?.summary && Object.keys(storedCv.summary).length > 0
    ? storedCv.summary as CvSummaryDetails
    : null;

  // If the frontend signals to use the stored CV and no file was uploaded,
  // fetch the CV bytes from Supabase storage
  if (!cvFile && body.useStoredCv === 'true' && storedCv) {
    try {
      const buffer = await this.storageService.downloadFile(storedCv.storagePath);
      cvFile = {
        buffer,
        mimetype: storedCv.mimeType,
        originalname: storedCv.originalName,
        size: storedCv.size,
      } as Express.Multer.File;
    } catch (e) {
      this.logger.warn(`Could not load stored CV for user ${userId}: ${e.message}`);
    }
  }

  const hasCV = !!cvFile;

  // Analyze prompt + CV to get search terms and candidate summary
  const { searchTerms, summary } = await this.analyzeInput(body.prompt, cvFile, existingSummary);

  if (summary && !existingSummary) {
    await this.cvService.updateSummary(userId, summary);
  }

  const jobs = await this.jobService.findAllByQuery(searchTerms);
  console.log('Search terms:', searchTerms);
  console.log('Summary:', summary);

  // Call 2 — rank jobs against candidate profile
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
- **Below 50:** Weak on both axes — omit unless fewer than 3 vacancies pass the threshold

---

## STEP 2 — FILTER & RANK
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
  2. If not, estimate based on vacancy title, company, and location using these ranges:
     - Intern/სტაჟიორი → "₾500 – ₾1,000/mo (est.)"
     - Junior → "₾1,000 – ₾2,000/mo (est.)"
     - Mid → "₾2,500 – ₾4,000/mo (est.)"
     - Senior → "₾4,000 – ₾7,000/mo (est.)"
     - Lead/Principal → "₾7,000 – ₾12,000/mo (est.)"
  3. Detect seniority from the vacancy title first (e.g. "სტაჟიორი" = Intern, "უფროსი" = Senior).
     If not in title, check the description. If still unclear, default to Junior range.
  4. Use ₾ for Georgian companies/locations, $ for international/remote roles.
  5. Never return null, "N/A", or empty string.
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

SEARCH QUERY: ${JSON.stringify(searchTerms)}

${hasCV && summary ? `CANDIDATE PROFILE:\n${JSON.stringify(summary)}` : ''}

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
      this.logger.warn('No JSON found in Gemini response');
      return { response: responseText, comment: 'შეცდომა' };
    }

    try {
      const repaired = jsonrepair(jsonMatch[0]);
      const parsedResponse = JSON.parse(repaired);

      await this.userService.update(userId, { searchQuery: searchTerms });

      return {
        response: parsedResponse,
        comment: `ნაპოვნია ${parsedResponse.topJobs?.length ?? 0} ვაკანსია`,
      };
    } catch (parseErr) {
      this.logger.warn('Failed to parse Gemini JSON even after repair', parseErr);
      const errMsg = (parseErr as SyntaxError).message ?? '';
      const posMatch = errMsg.match(/position (\d+)/);
      if (posMatch) {
        const pos = parseInt(posMatch[1], 10);
        this.logger.debug(
          'JSON snippet around error:',
          jsonMatch[0].slice(Math.max(0, pos - 80), pos + 80)
        );
      }
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
