// Gemini agent: reads the evidence (photos, screenshots, voice notes, PDFs,
// pasted text), investigates with function calls against official registries
// and the cross-border recruiter network, then returns structured facts.
// The verdict itself comes from rules.js and claims.js.
import { GoogleGenAI, Type } from '@google/genai';
import { lookupAgency, checkFraudList, registryMeta } from './store.js';
import { evaluate, getPack } from './rules.js';
import { buildClaims } from './claims.js';
import { fingerprintsFrom, lookupFingerprints, recordFingerprints } from './fingerprint.js';

// Ordered fallback chain: if a model is overloaded (429/5xx) we retry briefly,
// then move to the next, so a demand spike never takes the app down.
const DEFAULT_CHAIN = 'gemini-3-flash-preview,gemini-3.7-flash,gemini-3.6-flash,gemini-3.5-flash';
// GEMINI_MODELS replaces the chain; GEMINI_MODEL only moves one model to the front.
const MODELS = [...new Set([process.env.GEMINI_MODEL, ...(process.env.GEMINI_MODELS || DEFAULT_CHAIN).split(',')]
  .map((m) => m?.trim()).filter(Boolean))];
const RETRIES_PER_MODEL = 2;
const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const MAX_TOOL_ROUNDS = 4;
const COOL_DOWN_MS = 60_000;
const coolingUntil = new Map();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * generateContent with retry + model fallback. Returns {res, model}.
 * Pass `pinned` to keep one check on the model that already answered
 * (Gemini 3 tool calls carry thought signatures tied to that model).
 */
export async function generate(params, pinned = null) {
  let lastErr;
  const ordered = pinned ? [pinned, ...MODELS.filter((m) => m !== pinned)] : MODELS;
  // Skip models that were overloaded in the last minute, unless nothing else is left.
  const healthy = ordered.filter((m) => (coolingUntil.get(m) ?? 0) < Date.now());
  const chain = healthy.length ? healthy : ordered;
  for (const model of chain) {
    for (let attempt = 0; attempt < RETRIES_PER_MODEL; attempt += 1) {
      try {
        const config = { ...params.config, thinkingConfig: { thinkingLevel: 'LOW' } };
        const res = await gemini().models.generateContent({ ...params, config, model });
        return { res, model };
      } catch (err) {
        lastErr = err;
        if (!RETRYABLE.has(err?.status)) throw err;
        if (attempt === RETRIES_PER_MODEL - 1) coolingUntil.set(model, Date.now() + COOL_DOWN_MS);
        else await sleep(600);
      }
    }
  }
  throw lastErr;
}

let client = null;
export function gemini() {
  if (client) return client;
  client = process.env.GEMINI_API_KEY
    ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
    : new GoogleGenAI({
      vertexai: true,
      project: process.env.GOOGLE_CLOUD_PROJECT,
      location: process.env.GOOGLE_CLOUD_LOCATION || 'global',
    });
  return client;
}

const TOOLS = [{
  functionDeclarations: [
    {
      name: 'lookup_agency',
      description: "Search the origin country's government register of licensed recruitment (manpower) agencies by name and/or licence number.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING, description: 'Agency name exactly as written in the evidence' },
          license_no: { type: Type.STRING, description: 'Licence / permission number if shown' },
        },
      },
    },
    {
      name: 'check_fraud_list',
      description: 'Check people or company names against published government notices of people accused of foreign-employment fraud.',
      parameters: {
        type: Type.OBJECT,
        properties: { names: { type: Type.ARRAY, items: { type: Type.STRING } } },
        required: ['names'],
      },
    },
    {
      name: 'check_recruiter_contacts',
      description: 'Check recruiter phone/WhatsApp numbers, emails or Facebook pages against the cross-border network of earlier high-risk reports from workers in any country.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          phones: { type: Type.ARRAY, items: { type: Type.STRING } },
          emails: { type: Type.ARRAY, items: { type: Type.STRING } },
          facebook: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
      },
    },
  ],
}];

function toolImpl(origin) {
  return {
    lookup_agency: async (args) => lookupAgency({ ...(args ?? {}), origin }),
    check_fraud_list: async (args) => ({ matches: checkFraudList(args ?? { names: [] }) }),
    check_recruiter_contacts: async (args) => {
      const prints = fingerprintsFrom({
        recruiter_phones: args?.phones, recruiter_emails: args?.emails, recruiter_facebook: args?.facebook,
      });
      const priors = await lookupFingerprints(prints);
      return { checked: prints.length, previously_reported: priors.map((p) => ({ contact: p.hint, high_risk_reports: p.highRisk, origins: p.origins })) };
    },
  };
}

const systemPrompt = (pack) => `You are SafeMigrate, an investigator protecting migrant workers from recruitment fraud and trafficking.
The worker is from ${pack.name}; the regulator is the ${pack.regulator}.
They share a foreign job offer: photos of letters, WhatsApp/Messenger screenshots, voice notes, or pasted text, in any language (Nepali, Urdu, Tagalog, Hindi, English, Arabic).
1. Read every piece of evidence carefully, including small print, phone numbers and chat details.
2. Call the tools: check every named agency or licence number, every person's full name, and every recruiter phone/WhatsApp number, email or Facebook page.
3. Never invent facts. If something is not in the evidence, leave it empty or "unknown".
4. Be calm and practical; the reader may be anxious and have little schooling.`;

const FACTS_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    destination_country: { type: Type.STRING, description: 'Country or city of the job, or empty' },
    job_title: { type: Type.STRING },
    employer_name: { type: Type.STRING },
    salary_text: { type: Type.STRING, description: 'Salary as stated, with currency' },
    agency_name: { type: Type.STRING, description: 'Recruitment agency named, or empty' },
    agency_license_no: { type: Type.STRING },
    recruiter_names: { type: Type.ARRAY, items: { type: Type.STRING } },
    recruiter_phones: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'Phone/WhatsApp numbers exactly as shown' },
    recruiter_emails: { type: Type.ARRAY, items: { type: Type.STRING } },
    recruiter_facebook: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'Facebook page names or URLs' },
    visa_type: { type: Type.STRING, enum: ['work', 'visit', 'tourist', 'student', 'unknown'] },
    no_labour_permit: { type: Type.BOOLEAN, description: 'True only if the evidence says to travel/work without the government labour/exit permit' },
    fee_amount: { type: Type.NUMBER, description: 'Total money asked from the worker; 0 if none' },
    fee_currency: { type: Type.STRING, description: 'ISO currency of fee_amount, e.g. NPR, PKR, PHP, AED, USD' },
    payment_to_personal_account: { type: Type.BOOLEAN },
    asks_passport_early: { type: Type.BOOLEAN },
    pressure_tactics: { type: Type.BOOLEAN },
    asks_irrelevant_personal_info: { type: Type.BOOLEAN, description: 'Asks religion, caste, habits, family details' },
    sector_keywords: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'Industry words e.g. casino, iGaming, data entry, construction' },
    evidence_quotes: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'Up to 4 short exact quotes that matter most' },
    summary_en: { type: Type.STRING, description: 'Two plain sentences: what this offer is' },
    summary_np: { type: Type.STRING, description: 'The same two sentences in simple Nepali (Devanagari)' },
  },
  required: ['visa_type', 'summary_en', 'summary_np'],
};

// Models sometimes write "unknown" instead of leaving a field empty; an agency
// literally named "unknown" would then be reported as unlicensed.
const PLACEHOLDER = /^(unknown|n\/?a|none|null|not (stated|mentioned|specified|provided|given)|-+|—)$/i;

export function sanitizeFacts(raw) {
  const clean = {};
  for (const [key, value] of Object.entries(raw ?? {})) {
    if (key === 'visa_type') {
      clean[key] = value;
    } else if (typeof value === 'string') {
      const v = value.trim();
      clean[key] = PLACEHOLDER.test(v) ? '' : v;
    } else if (Array.isArray(value)) {
      clean[key] = value.map((v) => (typeof v === 'string' ? v.trim() : v)).filter((v) => v !== '' && !(typeof v === 'string' && PLACEHOLDER.test(v)));
    } else {
      clean[key] = value;
    }
  }
  return clean;
}

function evidenceParts({ text, files }) {
  const parts = (files ?? []).map((f) => ({ inlineData: { mimeType: f.mimeType, data: f.data } }));
  parts.push({ text: text?.trim() ? `Worker's message / pasted text:\n${text.trim()}` : 'Analyse the attached evidence.' });
  return parts;
}

async function investigate(contents, trace, pack) {
  const impl = toolImpl(pack.code);
  let pinned = null;
  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const { res, model } = await generate({
      contents,
      config: { systemInstruction: systemPrompt(pack), tools: TOOLS, temperature: 0.1 },
    }, pinned);
    pinned = model;
    const calls = res.functionCalls ?? [];
    const modelContent = res.candidates?.[0]?.content;
    if (modelContent) contents.push(modelContent);
    if (calls.length === 0) return pinned;
    const responses = await Promise.all(calls.map(async (call) => {
      const result = impl[call.name] ? await impl[call.name](call.args) : { error: `unknown tool ${call.name}` };
      trace.push({ tool: call.name, args: call.args, result });
      return { functionResponse: { id: call.id, name: call.name, response: { result } } };
    }));
    contents.push({ role: 'user', parts: responses });
  }
  return pinned;
}

async function extractFacts(contents, pack, pinned) {
  const { res, model } = await generate({
    contents: [...contents, { role: 'user', parts: [{ text: 'Now give the structured facts as JSON.' }] }],
    config: {
      systemInstruction: systemPrompt(pack),
      responseMimeType: 'application/json',
      responseSchema: FACTS_SCHEMA,
      temperature: 0,
    },
  }, pinned);
  const facts = { ...sanitizeFacts(JSON.parse(res.text)), _model: model };
  // Nepal's fee cap is expressed in NPR.
  if (facts.fee_currency === 'NPR' && facts.fee_amount) facts.fee_demanded_npr = facts.fee_amount;
  return facts;
}

/**
 * @param {{text?: string, files?: Array<{mimeType: string, data: string}>, origin?: string}} input
 */
export async function analyzeOffer(input) {
  const pack = getPack(input.origin);
  const trace = [];
  const contents = [{ role: 'user', parts: evidenceParts(input) }];
  const pinned = await investigate(contents, trace, pack);
  const { _model: model, ...facts } = await extractFacts(contents, pack, pinned);

  // Always run every check ourselves too, so a skipped tool call can't hide a flag.
  const agency = lookupAgency({ name: facts.agency_name, license_no: facts.agency_license_no, origin: pack.code });
  const people = [...(facts.recruiter_names ?? []), facts.employer_name, facts.agency_name].filter(Boolean);
  const fraudMatches = checkFraudList({ names: people });
  const prints = fingerprintsFrom(facts);
  const priors = await lookupFingerprints(prints);

  const verdict = evaluate(facts, { agency, fraudMatches, fingerprints: priors }, pack);
  const claims = buildClaims(facts, {
    agency, flags: verdict.flags, prints, priors, registryMeta: registryMeta(pack.code),
  }, pack);

  await recordFingerprints(prints, { risk: verdict.risk, origin: pack.code, destination: verdict.country });

  return {
    facts, agency, ...verdict, claims, trace, model,
    origin: { code: pack.code, name: pack.name, regulator: pack.regulator, complaint_url: pack.complaint_url },
  };
}

/** Writes a complaint the worker can submit to their regulator. */
export async function draftComplaint(report) {
  const pack = getPack(report.origin?.code);
  const lang = pack.code === 'NP' ? 'Nepali' : 'English';
  const facts = { facts: report.facts, flags: report.flags?.map((f) => f.title_en) };
  const { res } = await generate({
    contents: [{
      role: 'user',
      parts: [{ text: `Write a short, formal complaint in ${lang} to the ${pack.regulator} about this suspicious foreign job offer. Use only these facts; leave [ ] blanks for the complainant's name, address and phone. Facts: ${JSON.stringify(facts)}` }],
    }],
    config: { temperature: 0.2 },
  });
  return res.text;
}
