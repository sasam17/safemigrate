# SafeMigrate

**Check a foreign job offer before you pay. Built in Kathmandu for workers across JAPAC.**

Over 6 million people leave JAPAC countries for work every year. Recruitment fraud follows them: Nepal alone logged 5,632 foreign-employment fraud complaints in FY 2024/25, and the UN estimates more than 200,000 people are held in online scam compounds in Myanmar and Cambodia, recruited from 80+ countries with "customer service" and "data entry" job offers.

SafeMigrate lets a worker forward the offer exactly as they received it (a photo of the letter, a WhatsApp screenshot, a voice note or a PDF) and get back, in their language, **every claim in the offer checked against official sources**.

## What it does

1. **Reads the evidence.** Gemini reads photos, screenshots, PDFs and voice notes in Nepali, Urdu, Tagalog, Hindi, English or Arabic.
2. **Investigates with tools.** A Gemini function-calling agent checks:
   - the recruitment agency against the origin country's government register of licensed agencies,
   - every named person against published fraud-accused notices,
   - every recruiter phone, WhatsApp, email or Facebook page against the **cross-border recruiter network**.
3. **Decides with rules, not vibes.** A deterministic rules engine (`src/rules.js`, unit-tested) raises risk signals: visit-visa traps, fees above legal caps, unlicensed agencies, payments to personal accounts, scam-compound job patterns.
4. **Shows each claim** as red (checked, failed), amber (cannot be checked online, here is the exact offline step) or green (checked), with the source and the date checked. It never says an offer is "safe".
5. **Acts.** Reads the verdict aloud, drafts a complaint for the right regulator, and adds anonymised signals to a risk map.

### The cross-border recruiter network

Recruiter contacts are stored only as keyed HMAC fingerprints (`src/fingerprint.js`). A WhatsApp number reported by a worker in Nepal is flagged when a worker in Pakistan or the Philippines checks an offer from the same number, without anyone storing or being able to recover the raw number.

## Country packs

| Pack | Regulator | Registry | Status |
|---|---|---|---|
| Nepal | Department of Foreign Employment | foreignjob.dofe.gov.np | Full rules (fee cap, visit visa, labour permit) |
| Pakistan | Bureau of Emigration & Overseas Employment | beoe.gov.pk/list-of-oeps | Registry snapshot + universal rules |
| Philippines | Department of Migrant Workers | dmw.gov.ph/inquiry | Official links + universal rules |

Adding a country is a JSON entry in `data/packs.json` plus a registry snapshot.

## Google Cloud architecture

- **Gemini** (`gemini-3.6-flash` via the Gen AI SDK): multimodal evidence reading, function calling (3 tools), structured JSON output with a response schema, complaint drafting.
- **Cloud Run**: the Node.js API and web app (`Dockerfile`).
- **Firestore**: agency registries, registry fetch dates, fraud list, anonymised cases, recruiter fingerprints. Security rules deny all browser access; only the server reads and writes.
- **Firebase Hosting**: serves the web app and rewrites `/api/**` to Cloud Run.

```
phone browser ──► Firebase Hosting ──► Cloud Run (Express)
                                         ├─ Gemini: read evidence, call tools, extract facts
                                         ├─ rules.js + claims.js: deterministic verdict
                                         └─ Firestore: registries · fingerprints · cases
```

## Run locally

```bash
npm install
cp .env.example .env   # add GEMINI_API_KEY
npm test
npm run dev            # http://localhost:8080
```

## Deploy

```bash
gcloud run deploy safemigrate --source . --region asia-south1 --allow-unauthenticated \
  --set-env-vars USE_FIRESTORE=1,GEMINI_MODEL=gemini-3.6-flash,GOOGLE_CLOUD_LOCATION=global \
  --set-secrets FINGERPRINT_SECRET=fingerprint-secret:latest
npm run seed           # load registries into Firestore
firebase deploy --only hosting,firestore:rules
```

## Safety principles

- Risk signals, not legal findings. Never "safe", never "verified job".
- Every check shows its source and when it was fetched.
- What cannot be checked online is marked amber with the exact offline step.
- No personal data is stored: cases keep only country, risk and flag IDs; recruiter contacts only as HMAC fingerprints.

## Limitations

- Government registries go offline; snapshots are cached with their fetch date.
- Nepal's job-approval (demand) database is login-only, so job approval is always amber.
- Name matching can produce false positives; fraud-list matches tell the user to confirm.

Built for the Google Cloud AI Builder Cup 2026 by Sambhav Shahi and Kaustuv Shrestha.
