// End-to-end check against the real Gemini API: runs one offer through the
// full agent and prints the verdict. Usage: node --env-file=.env scripts/smoke-test.js [NP|PK|PH] "offer text"
import { loadReferenceData } from '../src/store.js';
import { analyzeOffer } from '../src/agent.js';

const origin = process.argv[2] || 'NP';
const text = process.argv[3] || `Recruiter (WhatsApp +971 52 555 0199): Hello dear, we are hiring Customer Service staff for an iGaming company in Dubai. Salary AED 1,800 + accommodation. You will come on VISIT visa, company will change to work visa later. Air ticket you pay yourself. Joining in 10-12 days. Please tell me your religion and do you drink or smoke? Send passport copy today, seats are filling fast.`;

await loadReferenceData();
const started = Date.now();
const r = await analyzeOffer({ text, files: [], origin });
console.log(JSON.stringify({
  ms: Date.now() - started,
  model: r.model,
  risk: r.risk,
  country: r.country,
  tools: r.trace.map((s) => s.tool),
  claims: r.claims.map((c) => `${c.id}:${c.status}`),
  flags: r.flags.map((f) => f.id),
  summary_np: r.facts.summary_np,
}, null, 2));
