// Digitises DoFE's published foreign-employment fraud case notices (scanned
// PDFs) with Gemini into data/fraud-list.json: one row per accused person.
// Usage: node --env-file=.env scripts/import-fraud-notices.js <pdf> "<notice title>" "<source url>"
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { GoogleGenAI, Type } from '@google/genai';

const [pdfPath, noticeRef, sourceUrl] = process.argv.slice(2);
if (!pdfPath || !noticeRef) {
  console.error('usage: import-fraud-notices.js <pdf> "<notice title>" "<source url>"');
  process.exit(1);
}

const MODELS = ['gemini-3.7-flash', 'gemini-3-flash-preview', 'gemini-3.6-flash'];
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const OUT = new URL('../data/fraud-list.json', import.meta.url);

const SCHEMA = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      name: { type: Type.STRING, description: 'Accused person or company name, romanised to English letters' },
      name_np: { type: Type.STRING, description: 'Name exactly as written in Nepali' },
      address: { type: Type.STRING, description: 'District / municipality of the accused if shown' },
      case_no: { type: Type.STRING },
      filed_date_bs: { type: Type.STRING, description: 'Case registration date (Bikram Sambat) as written' },
      amount_npr: { type: Type.NUMBER, description: 'Claimed amount in rupees if shown, else 0' },
    },
    required: ['name', 'name_np'],
  },
};

const PROMPT = `This is an official notice from Nepal's Department of Foreign Employment listing foreign-employment offence (fraud) cases filed in court.
Extract EVERY accused person or company (प्रतिवादी) from every page. Do not include complainants (वादी/पीडित) or officials.
Romanise each name into English letters the way Nepalis usually write it (e.g. राम बहादुर थापा -> Ram Bahadur Thapa).
Return one row per accused. If a case lists several accused, return several rows with the same case number.`;

const ROUNDS = 6;
const WAIT_MS = 60_000;

async function extract(fileUri, mimeType) {
  let lastErr;
  for (let round = 0; round < ROUNDS; round += 1) {
    try {
      return await extractOnce(fileUri, mimeType);
    } catch (err) {
      lastErr = err;
      if (![429, 500, 503].includes(err.status)) throw err;
      console.error(`[fraud] all models busy, waiting ${WAIT_MS / 1000}s (round ${round + 1}/${ROUNDS})`);
      await new Promise((r) => setTimeout(r, WAIT_MS));
    }
  }
  throw lastErr;
}

async function extractOnce(fileUri, mimeType) {
  let lastErr;
  for (const model of MODELS) {
    try {
      const res = await ai.models.generateContent({
        model,
        contents: [{ role: 'user', parts: [{ fileData: { fileUri, mimeType } }, { text: PROMPT }] }],
        config: { responseMimeType: 'application/json', responseSchema: SCHEMA, temperature: 0, maxOutputTokens: 65000 },
      });
      return { rows: JSON.parse(res.text), model };
    } catch (err) {
      lastErr = err;
      console.error(`[fraud] ${model} failed: ${err.status ?? ''} ${String(err.message).slice(0, 120)}`);
    }
  }
  throw lastErr;
}

const uploaded = await ai.files.upload({ file: pdfPath, config: { mimeType: 'application/pdf' } });
let file = uploaded;
while (file.state === 'PROCESSING') {
  await new Promise((r) => setTimeout(r, 3000));
  file = await ai.files.get({ name: uploaded.name });
}

const { rows, model } = await extract(file.uri, 'application/pdf');
const clean = rows
  .filter((r) => r.name && r.name.trim().split(/\s+/).length >= 2)
  .map((r) => ({ ...r, name: r.name.trim(), notice_ref: noticeRef, source: sourceUrl || null }));

const existing = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : [];
const seen = new Set(existing.map((r) => `${r.name}|${r.case_no}`));
const merged = [...existing, ...clean.filter((r) => !seen.has(`${r.name}|${r.case_no}`))];
writeFileSync(OUT, JSON.stringify(merged, null, 1));

await ai.files.delete({ name: uploaded.name }).catch(() => {});
console.log(JSON.stringify({ model, extracted: rows.length, kept: clean.length, total: merged.length, sample: clean.slice(0, 3) }, null, 2));
