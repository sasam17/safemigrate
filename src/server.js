// HTTP entry point for Cloud Run: serves the web app and the JSON API.
import express from 'express';
import multer from 'multer';
import { fileURLToPath } from 'node:url';
import { analyzeOffer, draftComplaint } from './agent.js';
import { loadReferenceData, referenceStats, saveCase, recentCases } from './store.js';
import { speak, verdictScript } from './voice.js';
import { translateReport, isSupported } from './translate.js';
import { consume, LIMIT_MESSAGE } from './budget.js';

/** Stops Gemini-powered routes once today's spending lock is reached. */
const budget = (kind) => async (req, res, next) => {
  if (await consume(kind)) return next();
  const lang = req.body?.lang === 'ne' ? 'ne' : 'en';
  res.status(429).json({ success: false, error: LIMIT_MESSAGE[lang] });
};
import { handleUpdate, startPolling, telegramEnabled } from './telegram.js';

const PORT = Number(process.env.PORT) || 8080;
const MAX_FILES = 4;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_TEXT_CHARS = 8000;
const ALLOWED_MIME = /^(image\/(jpeg|png|webp|heic|heif)|audio\/(webm|ogg|mpeg|mp4|wav|x-m4a|aac)|application\/pdf)$/;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: MAX_FILES, fileSize: MAX_FILE_BYTES },
  fileFilter: (_req, file, cb) => cb(null, ALLOWED_MIME.test(file.mimetype)),
});

// Small in-memory rate limit per IP: protects the Gemini quota during judging.
const hits = new Map();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 12;
function rateLimit(req, res, next) {
  const now = Date.now();
  const key = req.ip ?? 'unknown';
  const recent = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_PER_WINDOW) {
    res.status(429).json({ success: false, error: 'Too many checks. Please wait a minute.' });
    return;
  }
  hits.set(key, [...recent, now]);
  next();
}

const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '1mb' }));
app.use(express.static(fileURLToPath(new URL('../public', import.meta.url))));

app.get('/api/health', (_req, res) => {
  res.json({ success: true, data: { ok: true, ...referenceStats() } });
});

app.post('/api/check', rateLimit, upload.array('files', MAX_FILES), budget('check'), async (req, res) => {
  const text = String(req.body?.text ?? '').slice(0, MAX_TEXT_CHARS);
  const files = (req.files ?? []).map((f) => ({ mimeType: f.mimetype, data: f.buffer.toString('base64') }));
  if (!text.trim() && files.length === 0) {
    res.status(400).json({ success: false, error: 'Add a photo, voice note or text of the offer.' });
    return;
  }
  const origin = ['NP', 'PK', 'PH'].includes(String(req.body?.origin)) ? req.body.origin : 'NP';
  const lang = isSupported(String(req.body?.lang)) ? req.body.lang : 'en';
  try {
    const report = await translateReport(await analyzeOffer({ text, files, origin }), lang);
    await saveCase({
      origin,
      country: report.country,
      risk: report.risk,
      flagIds: report.flags.map((f) => f.id),
      agencyStatus: report.agency?.status,
    });
    res.json({ success: true, data: report });
  } catch (err) {
    console.error('[check] failed:', err);
    res.status(502).json({ success: false, error: 'The check could not finish. Please try again.' });
  }
});

app.post('/api/complaint', rateLimit, budget('complaint'), async (req, res) => {
  const report = req.body?.report;
  if (!report?.facts) {
    res.status(400).json({ success: false, error: 'Run a check first.' });
    return;
  }
  try {
    res.json({ success: true, data: { text: await draftComplaint(report) } });
  } catch (err) {
    console.error('[complaint] failed:', err);
    res.status(502).json({ success: false, error: 'Could not draft the complaint.' });
  }
});

app.post('/api/translate', rateLimit, budget('translate'), async (req, res) => {
  const lang = String(req.body?.lang);
  const report = req.body?.report;
  if (!report?.claims || !isSupported(lang)) {
    res.status(400).json({ success: false, error: 'Unsupported language or missing report.' });
    return;
  }
  res.json({ success: true, data: await translateReport(report, lang) });
});

app.post('/api/speak', rateLimit, budget('speak'), async (req, res) => {
  const lang = isSupported(String(req.body?.lang)) ? req.body.lang : 'en';
  const report = req.body?.report;
  if (!report?.risk) {
    res.status(400).json({ success: false, error: 'Run a check first.' });
    return;
  }
  try {
    const wav = await speak(verdictScript(report, lang), lang);
    res.set({ 'Content-Type': 'audio/wav', 'Cache-Control': 'no-store' }).send(wav);
  } catch (err) {
    console.error('[speak] failed:', err.message);
    res.status(502).json({ success: false, error: 'Voice is not available right now.' });
  }
});

// Telegram webhook (Cloud Run). The secret is checked twice: in the path and
// in the header Telegram sends, so nobody else can post fake updates.
app.post('/telegram/:secret', async (req, res) => {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const ok = telegramEnabled() && secret
    && req.params.secret === secret
    && req.get('X-Telegram-Bot-Api-Secret-Token') === secret;
  if (!ok) {
    res.sendStatus(404);
    return;
  }
  try {
    await handleUpdate(req.body);
  } catch (err) {
    console.error('[telegram] update failed:', err.message);
  }
  res.sendStatus(200);
});

app.get('/api/stats', async (_req, res) => {
  const cases = await recentCases();
  const byCountry = {};
  const byFlag = {};
  for (const c of cases) {
    const row = (byCountry[c.country] ??= { country: c.country, total: 0, high: 0 });
    row.total += 1;
    if (c.risk === 'high') row.high += 1;
    for (const f of c.flags ?? []) byFlag[f] = (byFlag[f] ?? 0) + 1;
  }
  res.json({
    success: true,
    data: {
      total: cases.length,
      high: cases.filter((c) => c.risk === 'high').length,
      countries: Object.values(byCountry).sort((a, b) => b.total - a.total),
      flags: byFlag,
      recent: cases.slice(0, 20),
    },
  });
});

app.use((err, _req, res, _next) => {
  const tooBig = err?.code === 'LIMIT_FILE_SIZE' || err?.code === 'LIMIT_FILE_COUNT';
  res.status(tooBig ? 413 : 500).json({ success: false, error: tooBig ? 'Up to 4 files, 8 MB each.' : 'Server error.' });
});

const ref = await loadReferenceData();
app.listen(PORT, () => {
  console.log(`[safemigrate] listening on ${PORT} | agencies=${JSON.stringify(ref.agencies)} fraudList=${ref.fraudList} firestore=${ref.firestore}`);
  if (telegramEnabled() && process.env.TELEGRAM_MODE === 'polling') {
    startPolling().catch((err) => console.error('[telegram] polling stopped:', err.message));
  }
});
