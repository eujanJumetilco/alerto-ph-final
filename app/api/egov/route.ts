import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { connectToDatabase } from "@/lib/mongodb";
import UserModel from "@/models/User";
import ReportModel from "@/models/Report";
import { access } from "fs";

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

async function tryWithModel(
  modelName: string,
  imageParts: ReturnType<typeof formatImageForGemini>[]
) {
  const model = genAi.getGenerativeModel({ model: modelName });
  const result = await model.generateContent([IMAGE_ANALYSIS_PROMPT, ...imageParts]);
  return result.response.text();
}

async function analyzeImages(base64Images: string[]): Promise<string> {
  const items = Array.isArray(base64Images) ? base64Images : [base64Images];
  const imageParts = items.map(formatImageForGemini);

  for (const modelName of MODEL_FALLBACKS) {
    try {
      if(process.env.NODE_ENV === "development") console.log(`Trying image reading model: ${modelName}`);
      const text = await tryWithModel(modelName, imageParts);
      if(process.env.NODE_ENV === "development") console.log(`Success with image reading model: ${modelName}`);
      return text;
    } catch (error: any) {
      console.warn(`Model ${modelName} failed:`, error?.message ?? error);
    }
  }

  console.error("All Gemini models failed. Returning fallback value.");
  return "Not provided";
}

/* =========================================================================
   eGovAI — Token + Report Classification
   ========================================================================= */

async function generateEGovAIToken(): Promise<string> {
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

async function classifyReport(systemPrompt: string): Promise<string> {
  const baseUrl = process.env.EGOV_AI_URL;
  const endpoint = `${baseUrl}/api/v1/egov/integration/ai_assistant/generate`;
  const accessToken = await generateEGovAIToken();

  const response = await fetch(endpoint!, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ prompt: systemPrompt, category: "GLOBAL" }),
  });

  if (!response.ok) {
    throw new Error(`eGovAI error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return data.data;
}

/* =========================================================================
   eGov SSO — Token + Authentication + DB Upsert
   ========================================================================= */

async function generateSSOToken(){
  const baseUrl: string | undefined = process.env.EGOV_SSO_URL;
  const endpoint: string = `${baseUrl}/api/token`;

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        exchange_code: process.env.EGOV_SSO_EXCHANGE_CODE,
        scope: "SSO_AUTHENTICATION",
        partner_code: process.env.EGOV_SSO_PARTNER_CODE,
        partner_secret: process.env.EGOV_SSO_PARTNER_SECRET,
      }),
    });

    const data = await response.json();
    return data.access_token;
  } catch {
    console.error("Failed to generate SSO access token, proceeding to use mock user data.");
  }

  return null;
}

async function processSSOAuthentication() {
  const baseUrl: string | undefined = process.env.EGOV_SSO_URL;
  const endpoint: string = `${baseUrl}/api/partner/sso_authentication`;
  let accessToken;

  try{
    accessToken = await generateSSOToken();
  }
  catch{
    throw new Error("Failed to generate SSO access token, proceeding to use mock user data.");
  }
  
  try {
    let data, u;

    if (accessToken){
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      data = await response.json();
      u = data.data;
    } else {
        u = { // mock user data
            email: 'josie02@yopmail.com',
            first_name: 'PEDRO',
            middle_name: null,
            last_name: 'DELA CRUZ',
            suffix: 'II',
            photo: 'https://staging-files.oueg.info/staging/9e2be7e4-eafa-4f13-8cbd-a979d98c5b4a.jpg',
            mobile: '+639090000002',
            address: '#100 UGO, DOÑA IMELDA, QUEZON CITY, METRO MANILA, PHILIPPINES',
        }
    }

    return {
      name: `${u.first_name} ${u.middle_name || ""} ${u.last_name} ${u.suffix || ""}`.trim(),
      mobile: u.mobile,
      email: u.email,
      address: u.address,
      firstName: u.first_name,
      lastName: u.last_name,
      photo: u.photo,
    };
  } catch {
    throw new Error("Failed to process SSO Authentication.");
  }

}

async function upsertUser(dto: Awaited<ReturnType<typeof processSSOAuthentication>>) {
  await connectToDatabase();

  const firstName = dto.firstName;
  const lastName = dto.lastName;

  const user = await UserModel.findOneAndUpdate(
    { mobileNumber: dto.mobile },
    {
      $setOnInsert: {
        mobileNumber: dto.mobile,
        firstName,
        lastName,
        email: dto.email,
        address: dto.address,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  return user;
}

/* =========================================================================
   eReport — Token + Submission
   ========================================================================= */

async function generateEReportToken(): Promise<string> {
  const baseUrl = process.env.EREPORT_URL;
  const endpoint = `${baseUrl}/api/integration/token`;

  const response = await fetch(endpoint!, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ access_code: process.env.EREPORT_ACCESS_TOKEN }),
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

async function submitToEReport(reportData: ReportData) {
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
      mobile: "639090000002",
      first_name: "Pedro",
      last_name: "Dela Cruz II",
      gender: "Male",
      complainant_email: "josie02@yopmail.com",
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

  const match = responseString.match(regex);
  if (!match) {
    throw new Error("Failed to parse AI response: unexpected format.");
  }

  return {
    reportType:     match[1].trim(),
    assignedAgency: match[2].trim(),
    title:          match[3].trim(),
    summary:        match[4].trim(),
  };
}

/* =========================================================================
   GET /api/egov?reporterId=<id>
   Returns all reports belonging to a user, newest first.
   ========================================================================= */

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const reporterId = searchParams.get("reporterId");

    if (!reporterId) {
      return NextResponse.json({ error: "reporterId is required" }, { status: 400 });
    }

    await connectToDatabase();

    const reports = await ReportModel.find({ reporterId })
      .sort({ createdAt: -1 })
      .lean();

    return NextResponse.json({ reports });
  } catch (error: any) {
    console.error("[GET /api/egov] error:", error);
    return NextResponse.json(
      { error: error?.message ?? "Internal server error" },
      { status: 500 }
    );
  }
}

/* =========================================================================
   POST /api/egov

   Dispatches on the `action` field in the request body:

     action: "sso"
       → SSO auth + DB user upsert. Called by SignInScreen on mount.
       → Returns: { _id, name, mobile, email, address }

     action: "analyze"
       → Image analysis (Gemini) + AI classification (eGovAI)
         + complaint submission (eReport) + DB save.
       → Body: { description, location, images[], reporterId }
       → Returns: { caseNumber, reportType, assignedAgency, title, summary }
   ========================================================================= */

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action } = body;

    /* ------------------------------------------------------------------
       action: "sso" — authenticate + upsert user
    ------------------------------------------------------------------ */
    if (action === "sso") {
      const dto = await processSSOAuthentication();
      const user = await upsertUser(dto);

      return NextResponse.json({
        _id:     user._id.toString(),
        name:    dto.name,
        mobile:  dto.mobile,
        email:   dto.email,
        address: dto.address,
      });
    }

    /* ------------------------------------------------------------------
       action: "analyze" — full report pipeline
    ------------------------------------------------------------------ */
    if (action === "analyze") {
      const { description, location, images, reporterId } = body;

      if (!reporterId) {
        return NextResponse.json({ error: "reporterId is required" }, { status: 400 });
      }

      // 1. Gemini image analysis
      let imageDescriptions = "Not provided";
      if (Array.isArray(images) && images.length > 0) {
        imageDescriptions = await analyzeImages(images);
      }

      // 2. Build eGovAI classification prompt
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

      // 3. eGovAI classification
      const aiRaw = await classifyReport(systemPrompt);
      const parsedData = parseReportString(aiRaw);

      // 4. eReport submission
      const eReportSubmission = await submitToEReport({
        description,
        reportType:     parsedData.reportType,
        assignedAgency: parsedData.assignedAgency,
        title:          parsedData.title,
        summary:        parsedData.summary,
      });

      // 5. Save to MongoDB
      await connectToDatabase();
      const savedReport = await ReportModel.create({
        reporterId,
        caseNumber:  eReportSubmission.case_number,
        title:       parsedData.title,
        category:    parsedData.reportType,
        handler:     parsedData.assignedAgency,
        summary:     parsedData.summary,
        description,
        location:    location || "Not specified",
        status:      "Pending",
        images:      images ?? [],
      });

      // 6. Return to client
      return NextResponse.json({
        caseNumber:     eReportSubmission.case_number,
        reportType:     parsedData.reportType,
        assignedAgency: parsedData.assignedAgency,
        title:          parsedData.title,
        summary:        parsedData.summary,
      });
    }

    /* ------------------------------------------------------------------
       Unknown action
    ------------------------------------------------------------------ */
    return NextResponse.json({ error: `Unknown action: "${action}"` }, { status: 400 });

  } catch (error: any) {
    console.error("[POST /api/egov] error:", error);
    return NextResponse.json(
      { error: error?.message ?? "Internal server error" },
      { status: 500 }
    );
  }
}