# Deploy SafeMigrate on the Google Cloud free trial ($300 credit, $0 spent)

Golden rule: never click "Activate full account" / "Upgrade". On the free trial Google cannot charge the card; when credit or the 90 days run out, services just stop.

## 1. One-time setup (Sambhav, in the browser)
1. console.cloud.google.com → Start free → accept terms, add card for verification only.
2. Create project: `safemigrate-cup` (note the Project ID).
3. Billing → Budgets & alerts → Create budget: amount $100, alerts at 5%, 25%, 50%, 100% → email to you.

## 2. Install gcloud (Sambhav, once)
Download the Windows installer from cloud.google.com/sdk/docs/install, keep defaults, then in PowerShell:
    gcloud auth login
    gcloud config set project safemigrate-cup
    gcloud auth application-default login

## 3. Turn on the services (Claude runs, Sambhav approves)
    gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com firestore.googleapis.com aiplatform.googleapis.com secretmanager.googleapis.com
    gcloud firestore databases create --location=asia-south1

## 4. Secrets (values never typed in chat)
    node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))" | gcloud secrets create fingerprint-secret --data-file=-
    (Telegram token: Sambhav pastes it into `gcloud secrets create telegram-token --data-file=-` himself.)

## 5. Deploy with spending caps built in
    gcloud run deploy safemigrate --source . --region asia-south1 --allow-unauthenticated ^
      --max-instances 2 --min-instances 0 --concurrency 20 --memory 512Mi --timeout 120 ^
      --set-env-vars USE_FIRESTORE=1,GOOGLE_CLOUD_LOCATION=global,DAILY_AI_LIMIT=1500,NODE_ENV=production ^
      --set-secrets FINGERPRINT_SECRET=fingerprint-secret:latest
   - No GEMINI_API_KEY on Cloud Run: it uses Vertex AI through the service account (paid by credit, no free-tier daily cap).
   - --max-instances 2 and DAILY_AI_LIMIT=1500 mean worst case ~1,500 AI actions/day ≈ $3-15/day, and the $100 budget alert fires long before the $300 is near.

## 6. Data and hosting
    npm run seed
    firebase use --add safemigrate-cup
    firebase deploy --only hosting,firestore:rules
   (Firebase asks for the Blaze plan: on a trial account it uses the same free credit.)

## 7. Re-run the fraud-case import on Vertex (no free-tier limits)
    node scripts/import-fraud-notices.js <pdf> "<notice title>" "<source url>"

## Cost guardrails summary
| Guardrail | Where | Effect |
|---|---|---|
| Free trial, never upgraded | Billing | Card cannot be charged |
| Budget alert $100 | Billing | Email at $5 / $25 / $50 / $100 |
| max-instances 2 | Cloud Run | Traffic spikes can't multiply cost |
| DAILY_AI_LIMIT 1500 | App (src/budget.js) | Hard daily stop on Gemini use |
| Per-IP rate limit 12/min | App | One person can't drain it |
