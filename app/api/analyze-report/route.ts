import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

/* =========================================================================
   Gemini — Image Analysis
   ========================================================================= */

const genAi = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

const IMAGE_ANALYSIS_PROMPT = `You are an evidence image analyst for a public complaint reporting system. Your sole job is to produce a structured, factual description of the provided image(s) that will be used by a downstream report classifier.

Analyze the image(s) and describe only what is objectively visible. Your description must be optimized to help classify the incident into one of these report types: Crime, Red Tape, Scam, Child Abuse, Women Abuse, Overpricing, Fire, Accident, or Gas Station Concerns.

Focus on:
- The scene or environment (e.g., street, store interior, government office, gas station, vehicle)
- Any visible people — their apparent condition, posture, or actions (do NOT name or identify individuals)
- Any visible text, signage, price tags, receipts, labels, or documents
- Physical evidence of harm, damage, hazard, or wrongdoing (e.g., injuries, fire, collision damage, suspicious materials)
- Any objects relevant to the incident (e.g., weapons, gas pumps, official seals, receipts)
- Timestamps, watermarks, or metadata visible in the image

Output rules:
1. Write in plain, factual, third-person prose. No bullet points.
2. If multiple images are provided, describe them in sequence: "Image 1 shows... Image 2 shows..."
3. Do NOT speculate beyond what is visible. Do NOT assign blame or draw legal conclusions.
4. Do NOT include conversational filler, greetings, or commentary.
5. Keep the total description under 200 words.
6. If the image is blurry, dark, or unintelligible, state: "Image could not be analyzed due to poor quality."

Produce only the description text — nothing else.`;

const MODEL_FALLBACKS = [
  "gemini-2.5-flash",
  "gemini-3.5-flash",
  "gemini-3.6-flash",
  "gemini-2.5-flash-image",
];

function formatImageForGemini(base64: string) {
  if (base64.startsWith("data:")) {
    const matches = base64.match(/^data:([A-Za-z-+/]+);base64,(.+)$/);
    if (matches && matches.length === 3) {
      return { inlineData: { mimeType: matches[1], data: matches[2] } };
    }
  }
  return { inlineData: { mimeType: "image/jpeg", data: base64 } };
}

async function tryWithModel(modelName: string, imageParts: ReturnType<typeof formatImageForGemini>[]) {
  const model = genAi.getGenerativeModel({ model: modelName });
  const result = await model.generateContent([IMAGE_ANALYSIS_PROMPT, ...imageParts]);
  return result.response.text();
}

async function analyzeImages(base64Images: string[]): Promise<string> {
  const items = Array.isArray(base64Images) ? base64Images : [base64Images];
  const imageParts = items.map(formatImageForGemini);

  for (const modelName of MODEL_FALLBACKS) {
    try {
      console.log(`Trying image reading model: ${modelName}`);
      const text = await tryWithModel(modelName, imageParts);
      console.log(`Success with image reading model: ${modelName}`);
      return text;
    } catch (error: any) {
      console.warn(`Model ${modelName} failed:`, error?.message ?? error);
    }
  }

  console.error("All Gemini models failed. Returning fallback value.");
  return "Not provided";
}

/* =========================================================================
   eGovAI — Token + Report Generation
   ========================================================================= */

async function generateAccessToken(): Promise<string> {
  const baseUrl = process.env.EGOV_AI_URL;
  const endpoint = `${baseUrl}/api/v1/egov/integration/token`;
  const accessCode = process.env.EGOV_AI_ACCESS_CODE;

  const response = await fetch(endpoint!, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ access_code: accessCode }),
  });

  if (!response.ok) {
    throw new Error(`eGovAI token error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return data.access_token;
}

/* =========================================================================
   eReport — Token + Submission
   ========================================================================= */

async function generateEReportToken(): Promise<string> {
  const baseUrl = process.env.EREPORT_URL;
  const endpoint = `${baseUrl}/api/integration/token`;
  const accessCode = process.env.EREPORT_ACCESS_TOKEN;

  const response = await fetch(endpoint!, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ access_code: accessCode }),
  });

  if (!response.ok) {
    throw new Error(`eReport token error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return data.access_token;
}

interface ReportData {
  description: string;
  reportType: string;
  assignedAgency: string;
  title: string;
  summary: string;
}

async function submitReport(reportData: ReportData) {
  const baseUrl = process.env.EREPORT_URL;
  const endpoint = `${baseUrl}/api/integration/submit_complaint`;
  const accessToken = await generateEReportToken();

  const response = await fetch(endpoint!, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      mobile: "639999999999",
      first_name: "Juan",
      last_name: "Dela Cruz",
      gender: "Male",
      complainant_email: "juan.delacruz@email.com",
      report_type: reportData.reportType.toLowerCase(),
      subject: reportData.title,
      message: reportData.summary,
      region_code: "040000000",
      province_code: "042100000",
      municipality_code: "042111000",
      barangay_code: "042111011",
      latitude: "14.60",
      longitude: "120.98",
    }),
  });

  if (!response.ok) {
    throw new Error(`eReport submit error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

/* =========================================================================
   Utilities
   ========================================================================= */

function parseReportString(responseString: string) {
  const regex = /\[([^\]]+)\]\s*\[([^\]]+)\]\s*\[([^\]]+)\]\s*\[([\s\S]*?)\]/;
  console.log("Parsing response string:", responseString);

  const match = responseString.match(regex);
  if (!match) {
    throw new Error("Failed to parse: String does not match the expected format.");
  }

  return {
    reportType:     match[1].trim(),
    assignedAgency: match[2].trim(),
    title:          match[3].trim(),
    summary:        match[4].trim(),
  };
}

/* =========================================================================
   POST /api/analyze-report
   ========================================================================= */

export async function POST(req: NextRequest) {
  try {
    const { description, location, images } = await req.json();

    // 1. Analyze any uploaded images via Gemini
    let imageDescriptions = "Not provided";
    if (Array.isArray(images) && images.length > 0) {
      imageDescriptions = await analyzeImages(images);
    }

    // 2. Build the eGovAI prompt
    const systemPrompt = `You are an expert text analyzer. I will provide you with a string of text, and you must perform the following tasks:

    1. Analyze the content of the provided string.
    2. Determine the report type based on the content. You must choose *only one* from the following exact list: Crime, Red Tape, Scam, Child Abuse, Women Abuse, Overpricing, Fire, Accident, Gas Station Concerns.
    3. Based on the determined report type, assign the appropriate agency or agencies from the list below:
       - Crime: PNP, NBI
       - Red Tape: ARTA
       - Scam: CICC, PNP-ACG, NBI, SEC
       - Child Abuse: DSWD, PNP-WCPC, CWC
       - Women Abuse: PNP-WCPC, PCW, DSWD
       - Overpricing: DTI, DOE
       - Fire: BFP
       - Accident: Emergency 911, MMDA, LGUs
       - Gas Station Concerns: DOE, DTI
    4. Create a title that is short, concise, and highly descriptive of the issue.
    5. Write a concise summary of the main points in the text.

    Output Format Constraint:
    1. You must return your final answer STRICTLY in the exact format shown below. Do not include any conversational filler, labels, line breaks between brackets, or extra spaces.
    2. Refer to the user as the "complainant" in your summary.
    3. For the Assigned Agency field, list the agency abbreviations separated by commas if there are multiple.

    [Report Type][Assigned Agency][Title][Summary]

    Location: ${location || "Not specified"}
    User's Uploaded Image(s) Description: ${imageDescriptions}
    Input Text:
    ${description}`;

    console.log("System Prompt:", systemPrompt);

    // 3. Call eGovAI
    const baseUrl = process.env.EGOV_AI_URL;
    const endpoint = `${baseUrl}/api/v1/egov/integration/ai_assistant/generate`;
    const accessToken = await generateAccessToken();

    const aiResponse = await fetch(endpoint!, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prompt: systemPrompt, category: "GLOBAL" }),
    });

    if (!aiResponse.ok) {
      throw new Error(`eGovAI error: ${aiResponse.status} ${aiResponse.statusText}`);
    }

    const aiData = await aiResponse.json();
    const parsedData = parseReportString(aiData.data);
    console.log("Parsed AI Scan:", parsedData);

    // 4. Submit to eReport
    const eReportSubmission = await submitReport({
      description,
      reportType:     parsedData.reportType,
      assignedAgency: parsedData.assignedAgency,
      title:          parsedData.title,
      summary:        parsedData.summary,
    });

    console.log("eReport Submission Response:", eReportSubmission);

    // 5. Return everything the client needs
    return NextResponse.json({
      caseNumber:     eReportSubmission.case_number,
      reportType:     parsedData.reportType,
      assignedAgency: parsedData.assignedAgency,
      title:          parsedData.title,
      summary:        parsedData.summary,
    });
  } catch (error: any) {
    console.error("analyze-report route error:", error);
    return NextResponse.json(
      { error: error?.message ?? "Internal server error" },
      { status: 500 }
    );
  }
}