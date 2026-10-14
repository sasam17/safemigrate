# SafeMigrate demo video script (target 2:50, hard limit 3:00)

Record on phones and screen. Kaustuv edits. English voice-over (all submission materials must be in English), Nepali on screen where the app speaks Nepali.

| Time | On screen | Voice-over / sound |
|---|---|---|
| 0:00-0:15 | Sambhav's real WhatsApp chat with the Dubai recruiter ("come on VISIT visa", iGaming, "your religion?"). Date 12 Oct 2026 visible. | Sambhav, to camera or voice: "Two days before this hackathon, a recruiter offered me a job in Dubai. Visit visa. Online casino. They asked my religion. I knew it was a trap. Most workers don't." |
| 0:15-0:30 | Simple stats card: 6M+ workers leave JAPAC each year · 5,632 fraud complaints in Nepal last year · 220,000 held in scam compounds. | "Every year six million people leave JAPAC for work. Fraud and trafficking follow them, through WhatsApp and Facebook." |
| 0:30-1:05 | Phone 1 (Nepal). Telegram: forward the real screenshot to the SafeMigrate bot. "Checking against government records…" then the verdict: 🚨 HIGH RISK, red lines for visa and job, amber for agency. Then the Nepali voice note plays. | "So we built SafeMigrate. A worker forwards the offer, in the app they already use. Gemini reads it, checks it against the government's licence register, and answers in their language, out loud." Let ~5 s of the Nepali voice play. |
| 1:05-1:30 | Web app on a laptop: the claim cards with sources and dates. Open "What the AI checked": the tool calls lookup_agency, check_fraud_list, check_recruiter_contacts. | "Every claim is checked against an official source: 1,758 Nepali and 5,314 Pakistani agencies, and fraud cases Gemini digitised from government PDFs. Rules, not the AI, decide red, amber or green. It never says 'safe'." |
| 1:30-1:50 | Impersonation case: offer naming a real licensed agency but a different WhatsApp number. Amber card: "not one of its registered numbers… call 01-XXXXXXX". | "Scammers use real agency names. SafeMigrate compares the number messaging you with the agency's registered numbers." |
| 1:50-2:25 | THE CLIMAX. Phone 2 (Pakistan, Kaustuv). A different message, in Urdu-English, PKR fee, same scammer's number. Result: 🌏 "This recruiter was already reported by workers from Nepal." Split screen: both phones. | "Now a worker in Pakistan gets a different message, from the same number. Nobody stored that number, only an unreadable fingerprint. But SafeMigrate knows: a worker in Nepal already reported it. One report protects workers across borders." |
| 2:25-2:45 | Architecture card: phone → Firebase Hosting → Cloud Run → Gemini (multimodal, function calling, TTS) → Firestore. Country packs NP/PK/PH. | "Gemini on Cloud Run, Firestore, Firebase. Adding a country is one registry and one rules file. Built in Kathmandu, for JAPAC." |
| 2:45-2:50 | Logo + live URL + "Check before you go." | "SafeMigrate. Check before you go." |

Rules for filming
- Only real data and real app output. No mock screens.
- Blur the scammer's full number and any third-party personal data.
- Record a backup take of every live step.
- Keep under 3:00 (the form says up to 3 minutes; over-length can be penalised).
