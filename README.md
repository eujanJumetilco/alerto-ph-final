# AlertoPH

A mobile-first civic reporting app that lets citizens submit complaints and incident reports directly to the appropriate Philippine government agencies. Built as a prototype integrated with the eGovPH ecosystem.

---

## Overview

AlertoPH accepts a free-text description of an incident, an optional location, and up to three photos. It then uses AI to classify the report, route it to the correct agency, and submit it to the eReport complaint system — returning a reference number the user can track.

The app is designed to run as a single Next.js application: a React frontend rendered inside a phone-sized shell, backed by a server-side API route that handles all external service calls.

---

## Features

- **AI-powered classification** — eGovAI reads the report and determines the incident type (Crime, Scam, Fire, Accident, Red Tape, and more) and the agencies responsible
- **Image analysis** — attached photos are described by Google Gemini before being passed to the classifier, giving the AI visual context
- **Automatic routing** — the right agencies (PNP, NBI, DSWD, BFP, DTI, etc.) are assigned based on incident type
- **eReport integration** — complaints are submitted directly to the eReport system and a case number is returned
- **eGovPH SSO** — authentication is handled via the eGovPH single sign-on service in production
- **Report dashboard** — users can view all submitted reports and their current status in one place

---

## Tech stack

| Layer | Technology |
|---|---|
| Framework | Next.js 14 (App Router) |
| Frontend | React + Tailwind CSS |
| Icons | Lucide React |
| Image analysis | Google Gemini (`gemini-2.5-flash` with model fallbacks) |
| AI classification | eGovAI (`/api/v1/egov/integration/ai_assistant/generate`) |
| Authentication | eGovPH SSO (`/api/partner/sso_authentication`) |
| Complaint submission | eReport (`/api/integration/submit_complaint`) |

---

## Project structure

```
alerto-ph/
├── app/
│   ├── api/
│   │   └── analyze-report/
│   │       └── route.ts          # Server-side API gateway
│   ├── components/
│   │   └── AlertoPH.tsx          # Entire frontend (screens, context, UI)
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx
└── public/
    └── icon.png
```

The frontend lives entirely in `AlertoPH.tsx` and is organised into sections:

- **Types** — `Report`, `ReportDraft`, `Stats` interfaces
- **ReportsContext** — React context providing `addReport()`, `getReportById()`, and derived stats; all reports are held in memory
- **UI components** — `StatCard`, `ReportCard`, `StatusBadge`, `BottomNav`, `TopBar`, `ScreenHeader`, `InfoRow`
- **Screens** — `SignInScreen`, `DashboardScreen`, `CreateReportScreen`, `AnalyzingScreen`, `SuccessScreen`, `ReportDetailScreen`, `UpdatesScreen`, `ProfileScreen`
- **AppShell** — top-level screen router driven by a `screen` string in state

---

## Architecture

```
Browser (AlertoPH.tsx)
        │
        │  POST /api/analyze-report
        ▼
Next.js API route (route.ts)
        │
        ├──▶ Google Gemini         image analysis (if photos attached)
        ├──▶ eGovAI                incident classification + agency routing
        └──▶ eReport               complaint submission → case number
```

The client never calls any external API directly. All credentials are kept server-side in environment variables and never exposed to the browser. Each external service issues its own short-lived bearer token, fetched fresh per request.

### Report submission sequence

1. User submits description, location, and optional images from `CreateReportScreen`
2. `addReport()` in `ReportsContext` sends a `POST` to `/api/analyze-report`
3. If images are present, `analyzeImages()` calls Gemini with a structured evidence-analysis prompt; a model fallback chain (`gemini-2.5-flash` → `gemini-3.5-flash` → `gemini-3.6-flash` → `gemini-2.5-flash-image`) ensures resilience
4. The image description is injected into the eGovAI prompt alongside the text and location
5. eGovAI returns a tightly formatted string — `[ReportType][Agency][Title][Summary]` — parsed by `parseReportString()`
6. The parsed fields are forwarded to eReport's complaint endpoint, which returns a `case_number`
7. The route responds with `{ caseNumber, reportType, assignedAgency, title, summary }`
8. The client creates a local `Report` object and navigates to `SuccessScreen`

### Supported incident types

| Type | Assigned agencies |
|---|---|
| Crime | PNP, NBI |
| Red Tape | ARTA |
| Scam | CICC, PNP-ACG, NBI, SEC |
| Child Abuse | DSWD, PNP-WCPC, CWC |
| Women Abuse | PNP-WCPC, PCW, DSWD |
| Overpricing | DTI, DOE |
| Fire | BFP |
| Accident | Emergency 911, MMDA, LGUs |
| Gas Station Concerns | DOE, DTI |

---

## Environment variables

Create a `.env.local` file at the project root with the following keys:

```env
# Google Gemini
GEMINI_API_KEY=

# eGovAI
EGOV_AI_URL=
EGOV_AI_ACCESS_CODE=

# eGovPH SSO
EGOV_SSO_URL=
EGOV_SSO_EXCHANGE_CODE=
EGOV_SSO_PARTNER_CODE=
EGOV_SSO_PARTNER_SECRET=

# eReport
EREPORT_URL=
EREPORT_ACCESS_TOKEN=
```

None of these values should ever be committed to version control. The `.env.local` file is already excluded by Next.js's default `.gitignore`.

---

## Getting started

```bash
# Install dependencies
npm install

# Run in development mode (SSO is bypassed; app auto-signs in after 1 second)
npm run dev

# Build for production
npm run build
npm start
```

Open [http://localhost:3000](http://localhost:3000) in a browser. The app renders inside a phone-shaped shell for desktop preview.

### Development vs production

In development (`NODE_ENV=development`), the sign-in screen resolves after a 1-second timeout so you can work without consuming SSO API credits. In production, `SignInScreen` calls the SSO endpoint and proceeds only after authentication succeeds.

---

## Prototype notes

**No database.** The prototype is scoped to a small set of eGov-issued test accounts, so a database would add infrastructure overhead without meaningfully demonstrating the app's capabilities. Since only one test user's data is exercised during the demo, that data is hardcoded — eliminating network round-trips to a data layer and keeping the demo fast and reliable. In a production deployment, replacing the hardcoded values with a real database and proper state management is straightforward; the app's architecture already accommodates it.

**In-memory report store.** Reports added during a session are held in React state and are lost on page refresh. This is intentional for the prototype. A production version would persist reports to a database and load them on mount.

**Hardcoded user profile.** The profile screen displays a fixed test user (name, mobile, email, address, photo). In production this data would be populated from the SSO response.

---

## License

This project was built as a prototype for demonstration purposes in partnership with eGovPH.