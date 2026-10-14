// Translates a finished report into the worker's language in one batched
// Gemini call. English and Nepali are built in; other languages are added as
// report.i18n so the original English stays available for auditing.
import { Type } from '@google/genai';
import { generate } from './agent.js';

export const LANGUAGES = {
  en: 'English', ne: 'Nepali', hi: 'Hindi', ur: 'Urdu', bn: 'Bengali', tl: 'Tagalog (Filipino)', id: 'Indonesian',
};
const BUILT_IN = new Set(['en', 'ne']);
const CACHE_LIMIT = 5000;
const cache = new Map(); // `${lang}\u0000${text}` -> translation

export const isSupported = (lang) => Object.hasOwn(LANGUAGES, lang);

/** Strings in a fixed order so translations map back by index. */
export function collectStrings(report) {
  return [
    report.facts?.summary_en ?? '',
    ...(report.flags ?? []).map((f) => f.title_en ?? ''),
    ...(report.claims ?? []).flatMap((c) => [c.detail_en ?? '', c.next_en ?? '']),
  ];
}

export function applyTranslations(report, lang, out) {
  const flagsN = (report.flags ?? []).length;
  return {
    ...report,
    i18n: {
      lang,
      summary: out[0],
      flags: out.slice(1, 1 + flagsN),
      claims: (report.claims ?? []).map((_, i) => ({ detail: out[1 + flagsN + i * 2], next: out[2 + flagsN + i * 2] })),
    },
  };
}

async function translateStrings(strings, lang) {
  const key = (s) => `${lang}\u0000${s}`;
  const todo = [...new Set(strings.filter((s) => s && !cache.has(key(s))))];
  if (todo.length) {
    const { res } = await generate({
      contents: [{
        role: 'user',
        parts: [{ text: `Translate each string into simple, clear ${LANGUAGES[lang]} for a migrant worker with little schooling. Keep numbers, currency, phone hints (like "phone:…123"), agency names and URLs unchanged. Return a JSON array with exactly ${todo.length} strings in the same order.\n\n${JSON.stringify(todo)}` }],
      }],
      config: {
        responseMimeType: 'application/json',
        responseSchema: { type: Type.ARRAY, items: { type: Type.STRING } },
        temperature: 0,
      },
    });
    const out = JSON.parse(res.text);
    if (!Array.isArray(out) || out.length !== todo.length) throw new Error('translation length mismatch');
    todo.forEach((s, i) => {
      if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value);
      cache.set(key(s), out[i]);
    });
  }
  return strings.map((s) => (s ? cache.get(key(s)) ?? s : s));
}

/** Returns the report with report.i18n for non-built-in languages; never throws. */
export async function translateReport(report, lang) {
  if (!isSupported(lang) || BUILT_IN.has(lang)) return report;
  try {
    return applyTranslations(report, lang, await translateStrings(collectStrings(report), lang));
  } catch (err) {
    console.error(`[translate] ${lang} failed, falling back to English:`, err.message);
    return report;
  }
}
