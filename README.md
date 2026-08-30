# AlertoPH

A mobile-first civic reporting app that lets Philippine citizens submit incident complaints directly to the appropriate government agencies. Built as a prototype integrated with the eGovPH ecosystem — eGovPH SSO for authentication, eGovAI for AI-powered incident classification, and eReport for complaint submission.

---

## Overview

A citizen describes an incident in plain text, optionally attaches up to three photos and a location, then submits. AlertoPH's backend analyzes the report using Google Gemini (for image evidence) and eGovAI (for text classification), routes it to the correct government agency, submits it to eReport, and returns a traceable case number — all within a single API call.

The app renders as a phone-shaped shell on desktop and a full-screen experience on mobile.

---

## Features

- **eGovPH SSO** — authentication via the eGovPH single sign-on service; user data is upserted into MongoDB on login
- **AI image analysis** — attached photos are described by Google Gemini before being passed to the text classifier, giving the AI visual context alongside the written report
- **AI classification** — eGovAI determines the incident type and assigns the responsible government agencies
- **eReport integration** — classified complaints are submitted to eReport, which returns a `case_number` for tracking
- **MongoDB persistence** — reports and users are stored in MongoDB Atlas; the dashboard loads live data on mount
- **Zustand state management** — authenticated user data and the last submitted report are persisted in `localStorage` via Zustand's `persist` middleware, surviving page refreshes
- **Synced UI** — new reports appear in the dashboard immediately after submission; a background refresh then syncs real database IDs
- **Report dashboard** — lists all of the user's submitted reports with status badges, sorted newest-first

---

## Tech stack

| Layer                | Technology                              | Version     |
| -------------------- | --------------------------------------- | ----------- |
| Framework            | Next.js                                 | 16.3.2      |
| Frontend             | React + Tailwind CSS v4                 | 19.2.8 / ^4 |
| Icons                | Lucide React                            | ^1.34.0     |
| State Management     | Zustand                                 | ^5.0.15     |
| Database             | MongoDB Atlas + Mongoose                | ^9.9.4      |
| Image Analysis       | Google Gemini (`@google/generative-ai`) | ^0.24.1     |
| AI Classification    | eGovAI                                  | —           |
| Authentication       | eGovPH SSO                              | —           |
| Complaint Submission | eReport                                 | —           |
| Language             | TypeScript                              | ^5          |

---

## Project structure

```
alerto-ph/
├── app/
│   ├── api/
│   │   └── egov/
│   │       └── route.ts          # Single API gateway for all server-side operations
│   ├── components/
│   │   └── AlertoPH.tsx          # Entire frontend: screens, context, UI components
│   ├── globals.css
│   ├── icon.png
│   ├── layout.tsx
│   └── page.tsx                  # Renders <AlertoPH />
├── lib/
│   └── mongodb.ts                # Mongoose connection singleton
├── models/
│   ├── Report.ts                 # Mongoose schema for complaint reports
│   └── User.ts                   # Mongoose schema for authenticated users
├── public/
│   └── icon.png
├── store/
│   ├── useReportStore.ts         # Zustand store — last submitted report (persisted)
│   └── useUserStore.ts           # Zustand store — authenticated user (persisted)
└── .env
```

### `AlertoPH.tsx` internal structure

+-------------------+---------------------------------------------------+-----------------------------------------------------------------------------------------+
| Section / Module  | Elements / Names                                  | Description / Details                                                                   |
+-------------------+---------------------------------------------------+-----------------------------------------------------------------------------------------+
| Constants         | CATEGORY map, STATUS map                          | Defines icons/colors per incident type and badge colors.                                |
| Types             | Report, ReportDraft, Stats, ReportsContextValue   | Core TypeScript interfaces used across the app.                                         |
| State Management  | ReportsContext / ReportsProvider                  | Fetches reports on mount, exposes core actions, and provides derived stats.             |
| UI Components     | StatCard, StatusBadge, ReportCard, BottomNav, etc.| Reusable building blocks for the user interface.                                       |
| Screens           | SignIn, Analyzing, Dashboard, Create, etc.        | Individual views and screens comprising the application user flow.                      |
| AppShell          | Top-level screen router                           | Drives screen switching via state string and passes activeReportId down.                |
+-------------------+---------------------------------------------------+-----------------------------------------------------------------------------------------+

---

## Architecture

```
Browser (AlertoPH.tsx)
        │
        ├── GET  /api/egov?reporterId=<id>   fetch user's reports
        └── POST /api/egov  { action: "sso" | "analyze" }
                │
                ├── action: "sso"
                │     └── eGovPH SSO ──▶ generateSSOToken() ──▶ sso_authentication
                │           └── MongoDB  ──▶ UserModel.findOneAndUpdate() (upsert)
                │
                └── action: "analyze"
                      ├── Google Gemini    image analysis (if photos attached)
                      ├── eGovAI          incident classification + agency routing
                      ├── eReport         complaint submission → case_number
                      └── MongoDB         ReportModel.create()
```

All external API calls happen server-side. The client never receives or uses any API credentials.

### `POST /api/egov` — dispatches on `action`

**`action: "sso"`** — Called by `SignInScreen` on mount (production only).
1. Generates an SSO bearer token via `generateSSOToken()`
2. Calls `sso_authentication` to retrieve the user's personal data from eGovPH
3. Upserts the user in MongoDB (`$setOnInsert` — existing users are never overwritten)
4. Returns `{ _id, name, mobile, email, address }`

**`action: "analyze"`** — Called when a user submits a report. Body: `{ description, location, images[], reporterId }`.
1. If images are present, `analyzeImages()` calls Gemini with a structured evidence prompt; a model fallback chain (`gemini-2.5-flash` → `gemini-3.5-flash` → `gemini-3.6-flash` → `gemini-2.5-flash-image`) ensures resilience if a model is unavailable
2. Builds a classification prompt combining description, location, and image analysis
3. Calls eGovAI's `ai_assistant/generate`; parses the `[ReportType][Agency][Title][Summary]` response via `parseReportString()`
4. Submits the classified complaint to eReport, receiving a `case_number`
5. Saves the report to MongoDB under the user's `reporterId`
6. Returns `{ caseNumber, reportType, assignedAgency, title, summary }`

### `GET /api/egov?reporterId=<id>`

Queries `ReportModel.find({ reporterId })` sorted newest-first. Called by `refreshReports()` in `ReportsProvider` on mount and after each new submission.

---

## Data models

### `User` — `models/User.ts`

| Field                     | Type   | Notes                                                     |
| ------------------------- | ------ | --------------------------------------------------------- |
| `mobileNumber`            | String | Unique; used as the lookup key during SSO upsert          |
| `firstName`               | String | Required                                                  |
| `lastName`                | String | Required                                                  |
| `suffix`                  | String | Optional                                                  |
| `email`                   | String | Unique; validated using `/^\S+@\S+\.\S+$/`                |
| `address`                 | String | Optional                                                  |
| `createdAt` / `updatedAt` | Date   | Automatically managed by Mongoose with `timestamps: true` |

---

### `Report` — `models/Report.ts`

| Field                     | Type     | Notes                                                    |
| ------------------------- | -------- | -------------------------------------------------------- |
| `reporterId`              | ObjectId | Reference to `User`; indexed                             |
| `caseNumber`              | String   | Unique; returned by eReport                              |
| `title`                   | String   | AI-generated; maximum 100 characters                     |
| `category`                | String   | One of the 9 supported incident types                    |
| `handler`                 | String   | Assigned agency abbreviation; defaults to `"Unassigned"` |
| `summary`                 | String   | AI-generated; maximum 200 characters                     |
| `description`             | String   | Original user-submitted text                             |
| `timestamp`               | Number   | Unix timestamp in milliseconds (`Date.now()`)            |
| `location`                | String   | User-entered location                                    |
| `status`                  | String   | Defaults to `"Pending"`                                  |
| `images`                  | String[] | Base64-encoded strings of attached photos                |
| `createdAt` / `updatedAt` | Date     | Automatically managed by Mongoose                        |

---

## Zustand stores

### `useUserStore` — `store/useUserStore.ts`

Persisted to `localStorage` under the key `alerto-user`. Populated by the SSO action on sign-in and read by `DashboardScreen`, `ProfileScreen`, and `ReportsProvider` (to pass `reporterId` in API calls).

```ts
interface AuthUser {
  _id: string;    // MongoDB ObjectId string
  name: string;
  mobile: string;
  email: string;
  address: string;
  photo?: string;
}
```

### `useReportStore` — `store/useReportStore.ts`

Persisted to `localStorage` under the key `alerto-report`. Written immediately inside `addReport()` after the API response resolves — before any React state update commits. `SuccessScreen` reads directly from this store via `useReportStore((state) => state.report)` to display the reference number, bypassing `ReportsContext` entirely and avoiding a timing race where the screen renders before `setReports()` has committed.

```ts
interface Report {
  id: string;
  title: string;
  referenceNumber: string;
}
```

---

## Incident types and agency routing

This incident type and agency routing is based off of what report types 
the current eReport feature of eGov app has

| Incident Type        | Assigned Agencies         |
| -------------------- | ------------------------- |
| Crime                | PNP, NBI                  |
| Red Tape             | ARTA                      |
| Scam                 | CICC, PNP-ACG, NBI, SEC   |
| Child Abuse          | DSWD, PNP-WCPC, CWC       |
| Women Abuse          | PNP-WCPC, PCW, DSWD       |
| Overpricing          | DTI, DOE                  |
| Fire                 | BFP                       |
| Accident             | Emergency 911, MMDA, LGUs |
| Gas Station Concerns | DOE, DTI                  |


---

## Environment variables

Create `.env.local` at the project root. **Never commit this file.**

```env
# MongoDB Atlas
MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>.mongodb.net/?appName=<app>

# Google Gemini
GEMINI_API_KEY=<your-gemini-api-key>

# eGovAI
EGOV_AI_URL=https://platforms-api.e.gov.ph/egov-ai
EGOV_AI_ACCESS_CODE=<your-access-code>

# eReport
EREPORT_URL=https://platforms-api.e.gov.ph/ereport
EREPORT_ACCESS_TOKEN=<your-access-token>

# eGovPH SSO
EGOV_SSO_URL=https://platforms-api.e.gov.ph/egov-sso
EGOV_SSO_PARTNER_CODE=<your-partner-code>
EGOV_SSO_PARTNER_SECRET=<your-partner-secret>
EGOV_SSO_EXCHANGE_CODE=<your-exchange-code>
```

`.env.local` is already excluded by Next.js's default `.gitignore`.

---

## Getting started

```bash
# 1. Install dependencies
npm install

# 2. Populate .env.local with the values above

# 3. Run the development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The app renders inside a phone-shaped shell on desktop.

```bash
# Production build
npm run build
npm start
```

---

## Development vs production

In **production**, `SignInScreen` calls `POST /api/egov` with `{ action: "sso" }` on mount and navigates to the dashboard only after authentication fully resolves and the user is written to both MongoDB and the Zustand store.

**SSO mock fallback (development).** The fallback lives entirely in `route.ts`, not in the frontend. `generateSSOToken()` catches a failed token request and returns `null`. `processSSOAuthentication()` detects the `null` token and substitutes a hardcoded mock user object, so the full sign-in and DB upsert flow runs without consuming SSO API credits:

```ts
// route.ts — processSSOAuthentication()
if (accessToken) {
  // call eGovPH SSO with real token
} else {
  u = { first_name: "PEDRO", last_name: "DELA CRUZ", ... } // mock
}
```
in an environment with real users, this will be handled by actual SSO, but because SSO with test accounts cannot be done programatically,
this is done as a workaround.

---

## Prototype notes

**Base64 image storage.** Attached photos are stored as base64 strings directly inside the `Report` MongoDB document. This is acceptable for a small number of prototype submissions but will hit MongoDB's 16 MB document limit with high-resolution images in production. A real deployment should upload images to object storage (S3, GCS, or similar) and store URLs instead.

**Optimistic report insertion.** After a successful submission, `addReport()` writes a minimal snapshot (`{ id, title, referenceNumber }`) to `useReportStore`, then inserts the full report into local React state with a temporary `optimistic-<timestamp>` id, then calls `refreshReports()` in the background to sync the real MongoDB document. `SuccessScreen` reads its display data from `useReportStore` directly — not from `ReportsContext` — so it always has the reference number available the moment it mounts, regardless of whether the state update has committed.

**Single test user.** The prototype is scoped to a small set of eGov-issued test accounts. User data is pulled from the SSO response in production and falls back to a hardcoded mock object in development. The app's architecture already supports real multi-user operation — no structural changes are needed beyond removing the mock fallback.

---

## License

Built as a prototype for demonstration purposes in partnership with eGovPH.