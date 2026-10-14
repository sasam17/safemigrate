// Spoken verdicts with Gemini text-to-speech, so workers who struggle to read
// can listen in Nepali. Returns WAV audio; results are cached by text.
import { createHash } from 'node:crypto';
import { gemini } from './agent.js';
import { LANGUAGES } from './translate.js';

const TTS_MODELS = (process.env.GEMINI_TTS_MODELS || 'gemini-3.8-flash-tts,gemini-3.8-flash-lite-tts,gemini-3.1-flash-tts-preview')
  .split(',').map((m) => m.trim()).filter(Boolean);
const VOICE = process.env.GEMINI_TTS_VOICE || 'Kore';
const MAX_CHARS = 700;
const CACHE_LIMIT = 200;
const cache = new Map();

const instruction = (lang) =>
  `Read this aloud in clear, calm, slow ${LANGUAGES[lang] ?? 'English'}, like a trusted helper explaining to a worker: `;

export const RISK_LABEL = {
  en: { high: 'High risk', medium: 'Be careful', low: 'No major red flags' },
  ne: { high: 'उच्च जोखिम', medium: 'सावधान', low: 'ठूलो खतरा देखिएन' },
  hi: { high: 'उच्च जोखिम', medium: 'सावधान रहें', low: 'कोई बड़ा खतरा नहीं मिला' },
  ur: { high: 'زیادہ خطرہ', medium: 'محتاط رہیں', low: 'کوئی بڑا خطرہ نہیں ملا' },
  bn: { high: 'উচ্চ ঝুঁকি', medium: 'সাবধান', low: 'বড় কোনো ঝুঁকি পাওয়া যায়নি' },
  tl: { high: 'Mataas na panganib', medium: 'Mag-ingat', low: 'Walang malaking panganib na nakita' },
  id: { high: 'Risiko tinggi', medium: 'Hati-hati', low: 'Tidak ada tanda bahaya besar' },
};
const CLOSING = {
  en: 'Check with the government office before you pay.',
  ne: 'पैसा तिर्नु अघि सरकारी कार्यालयमा पक्का गर्नुहोस्।',
  hi: 'पैसे देने से पहले सरकारी दफ़्तर से पक्का करें।',
  ur: 'پیسے دینے سے پہلے سرکاری دفتر سے تصدیق کریں۔',
  bn: 'টাকা দেওয়ার আগে সরকারি অফিসে নিশ্চিত হন।',
  tl: 'Kumpirmahin sa opisina ng gobyerno bago magbayad.',
  id: 'Pastikan ke kantor pemerintah sebelum membayar.',
};

/** Wraps raw 16-bit mono PCM in a WAV header (some models return bare PCM). */
export function pcmToWav(pcm, sampleRate = 24000) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(sampleRate, 24); h.writeUInt32LE(sampleRate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

function toWav(inline) {
  const bytes = Buffer.from(inline.data, 'base64');
  if (bytes.subarray(0, 4).toString() === 'RIFF') return bytes;
  const rate = Number(/rate=(\d+)/.exec(inline.mimeType ?? '')?.[1]) || 24000;
  return pcmToWav(bytes, rate);
}

/**
 * @param {string} text
 * @param {'ne'|'en'} lang
 * @returns {Promise<Buffer>} WAV audio
 */
export async function speak(text, lang = 'ne') {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_CHARS);
  if (!clean) throw new Error('empty text');
  const key = createHash('sha256').update(`${lang}:${clean}`).digest('hex');
  if (cache.has(key)) return cache.get(key);

  let lastErr;
  for (const model of TTS_MODELS) {
    try {
      const res = await gemini().models.generateContent({
        model,
        contents: [{ role: 'user', parts: [{ text: instruction(lang) + clean }] }],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } } },
        },
      });
      const inline = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData;
      if (!inline) throw new Error(`no audio from ${model}`);
      const wav = toWav(inline);
      if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value);
      cache.set(key, wav);
      return wav;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

/** Picks the text for one claim/summary in the report's language. */
export function localText(report, lang) {
  const np = lang === 'ne';
  const t = report.i18n?.lang === lang ? report.i18n : null;
  return {
    summary: t?.summary ?? (np ? report.facts?.summary_np : report.facts?.summary_en),
    claim: (c, i) => t?.claims?.[i]?.detail ?? (np ? c.detail_np : c.detail_en),
  };
}

/** The short script read aloud for a report: verdict, summary, then red claims. */
export function verdictScript(report, lang = 'ne') {
  const text = localText(report, lang);
  const label = (RISK_LABEL[lang] ?? RISK_LABEL.en)[report.risk] ?? '';
  const reds = (report.claims ?? [])
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => c.status === 'red')
    .slice(0, 3)
    .map(({ c, i }) => text.claim(c, i));
  const sep = ['ne', 'hi', 'bn'].includes(lang) ? '। ' : lang === 'ur' ? '۔ ' : '. ';
  return [label, text.summary, ...reds, CLOSING[lang] ?? CLOSING.en].filter(Boolean).join(sep);
}
