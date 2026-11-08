# Prompt: training data for COSMOS-Embed

How to use it
1. Open a new conversation with Claude and paste the whole **PROMPT** block below (everything between the two lines `=====`).
2. Claude answers with batch 1. Then just send `next` (or `continue`): Claude takes the next line of the batch plan.
   Instead of `next`, you can send a precise batch line from `claude_batches.csv`, e.g. `batch 0137 | es | a SaaS billing migration | team project notes`.
3. Save each answer (the whole message is fine) as a text file in `training/data/claude_inbox/`, e.g. `0001.txt`, `0002.txt`.
4. Run `python training/cosmos_embed.py ingest` (from `COSMOS/`): it extracts and checks every item and writes `training/data/raw_claude.jsonl`.
5. When a conversation gets long, start a new one with the prompt again and say `start at batch 0042`.

Target: 380 batches × 80 memories ≈ 30,000 memories, in 12 languages.

=====
PROMPT
=====

You are generating training data for **COSMOS-Embed**, a small multilingual embedding model used as the search engine of COSMOS, an external memory for AI assistants. An assistant stores short "memories" (facts the user told it, project notes, decisions, preferences). Later, a question comes in and COSMOS must rank the right memory first among thousands of others. Your data teaches the model exactly that: match a later question to the right memory, prefer the newest version of a fact, and not be fooled by near-miss memories.

## What you produce

For each batch, output **exactly 80 items**, one JSON object per line (JSONL), inside a single ```jsonl code block, and nothing else except one header line before the block:

`BATCH <id> | <language> | <theme> | <style> | 80 items`

Each item has these fields:

```
{
  "id": "<batch>-<nn>",                       // e.g. "0007-23"
  "lang": "<ISO code>",                       // language of ALL text fields of this item
  "theme": "<theme of the batch>",
  "kind": "fact" | "decision" | "task" | "preference" | "project_context" | "event" | "person" | "open_question",
  "memory": "<the memory, 1-2 sentences, 8-45 words>",
  "questions": ["<q1>", "<q2>", "<q3>"],       // 3 DIFFERENT ways to ask for this memory later
  "update": "<a newer version of the same fact>" | null,
  "update_questions": ["<q1>", "<q2>"] | null, // questions whose right answer is the NEW version
  "distractor": "<a near-miss memory>",
  "absent_question": "<a question on the same subject that this memory does NOT answer>"
}
```

## Rules for every field

**memory**
- Self-contained: it must make sense alone, years later, among thousands of other memories. Always name the person, project, tool, place or thing. Never "it", "this service", "the project", "he" without a name.
- Concrete and specific: names, numbers, tools, dates, places, reasons. Avoid vague statements ("we had a good meeting").
- Vary the voice: first person ("I…", "My…"), project notes ("Decided: …", "TODO: …"), third person about a teammate, a rule for the assistant ("Always answer me in…").
- Vary the length (short fact vs. two-sentence note with a reason).
- Invent everything: people, companies, products, pets, streets, numbers. Mix very common and unusual names from the culture of the batch language. No real private person, no real phone numbers, emails, addresses or ID numbers.

**questions** (3 per item, all in the item's language)
- How a person would really ask later, days or months after. Natural, sometimes short and lazy ("vet appointment for the cat?"), sometimes full sentences.
- **Rephrase**: avoid reusing the memory's distinctive words. Use synonyms, the role instead of the name ("the backend lead"), the purpose instead of the tool ("where do we host the API?"), a consequence or a related situation.
- The 3 questions must differ from each other: one direct, one rephrased with different words, one indirect / situational ("I'm booking the flights for the team offsite, which airport did we pick?").
- Each question must have exactly ONE right answer among the batch: this memory (or its update, see below).

**update** (about 45% of items; null for the others)
- A newer memory that changes the same fact: a move, a new decision, a changed preference, a new deadline, a replaced tool, a new price.
- Self-contained and **reuses the same names** as the memory (so both look alike), and makes clear what changed ("Kestrel moved off Heroku: the carpooling app's backend now runs on Fly.io.").
- `update_questions`: 2 questions whose right answer is the **new** version (asking for the current value: "these days", "now", "currently", or with no time word at all, since the newest fact should win by default).

**distractor** (every item)
- A different, plausible memory that is very close in words or subject but does **not** answer the questions: same person but another fact, same tool but another project, same date but another event, a similar name.
- It must NOT be an update of the memory, and must NOT answer any of the 3 questions.

**absent_question** (every item)
- Same subject as the memory, but asks something this memory (and its update) does not contain. Used to teach "no answer here".

**kind**: the best label for the memory, chosen from the list above.

## Diversity across a batch
- 80 items about the batch theme, but spread over at least 8 different people/projects/situations inside that theme.
- Mix kinds: roughly 30% fact, 15% decision, 12% task, 12% preference, 10% project_context, 8% event, 8% person, 5% open_question.
- Mix registers: casual and professional; typos are allowed in a few questions (people type fast), never in memories.
- Numbers and dates in the local format of the language (1 234,50 € in French, $1,234.50 in English, 22/10, Oct 22…).
- Never copy the example below; never reuse the same invented name more than 3 times in a batch.

## Forbidden content
- Do NOT use any of these names or values anywhere (they belong to the test set):
  Lola, Marc, Sofia, Karim, Aurèle, Nina, Paul, Yasmine, Hector, Elsa, Bruno, Clara, Félix, Amélie, Omar, Pauline, Louis, Salomé, Ivan, Mélanie, Gaspard, Leïla, Romain, Anaïs, Victor, Margaux, Samir, Océane, Axel, Chloé, Camille, Hugo, Inès, Dupont, Moutarde, Atlas, Peugeot, Scaleway, Azerty, and the cities Lyon, Nantes, Lille, Gand, Namur, Rennes, Tours, Anvers, Nice, Dijon, Brest, Metz, Mons, Liège, Toulouse, Bordeaux, Grenoble, Reims, Nancy, Caen, Bruxelles.
- No sensitive personal data (health diagnoses, sexuality, religion, political views, real addresses), no harmful content.

## Example item (English, do not copy)

```jsonl
{"id": "0000-01", "lang": "en", "theme": "a carpooling app startup", "kind": "decision", "memory": "Kestrel (our carpooling app): we host the backend on Heroku because Dimitri already knows it.", "questions": ["Where is Kestrel's backend hosted?", "which cloud runs the carpool app server?", "I need to restart the API of the ride-sharing app, where do I log in?"], "update": "Kestrel moved off Heroku in March: the carpooling app's backend now runs on Fly.io, cheaper for our traffic.", "update_questions": ["Which host runs Kestrel's backend now?", "what's the current hosting provider for the carpool API?"], "distractor": "Kestrel's marketing site is a static page hosted on Netlify, managed by Aoife.", "absent_question": "How many daily active users does Kestrel have?"}
```

## Batch plan

Work through these batches in order. When I say `next`, do the next one. When I give a line like `batch 0137 | es | … | …`, do that one. Theme and style come from the plan; the language is the ISO code (en English, fr French, es Spanish, de German, it Italian, pt Portuguese, nl Dutch, pl Polish, tr Turkish, ja Japanese, zh Simplified Chinese, ar Arabic).

Full plan (batch | language | theme | style):

```
0001 | en | software project (stack, deploys, incidents) | personal notes
0002 | es | agency client accounts | chat-like messages
0003 | it | moving house | assistant preferences
0004 | nl | personal finances and subscriptions | team project notes
0005 | ar | team rituals and tools | personal notes
0006 | fr | investing education (no advice) | chat-like messages
0007 | de | e-commerce shop | assistant preferences
0008 | pt | video game development | team project notes
0009 | zh | pets | personal notes
0010 | en | garden and plants | chat-like messages
0011 | es | legal and admin paperwork (invented) | assistant preferences
0012 | it | hardware and electronics projects | team project notes
0013 | ja | research thesis | personal notes
0014 | es | restaurant or café | chat-like messages
0015 | fr | cooking and diet | assistant preferences
0016 | de | hobbies and crafts | team project notes
0017 | tr | writing a book | personal notes
0018 | fr | coding style and tooling preferences | chat-like messages
0019 | en | freelance client work | assistant preferences
0020 | pt | house renovation | team project notes
0021 | pl | car, bike and transport | personal notes
0022 | en | job search and interviews | chat-like messages
0023 | es | volunteering and associations | assistant preferences
0024 | it | mobile app startup | team project notes
0025 | nl | open-source library | personal notes
0026 | ar | family life and birthdays | chat-like messages
0027 | fr | health appointments (non-sensitive, logistics only) | assistant preferences
0028 | de | company policies and HR logistics | team project notes
0029 | pt | science and lab notes | personal notes
0030 | zh | data / ML experiment | chat-like messages
0031 | en | podcast or YouTube channel | assistant preferences
0032 | es | sport and training plan | team project notes
0033 | it | books, films and music | personal notes
0034 | ja | home server and smart home | chat-like messages
0035 | es | assistant rules and answer style | assistant preferences
0036 | fr | school or university course | team project notes
0037 | de | wedding or big event | personal notes
0038 | tr | travel planning | chat-like messages
0039 | fr | friends and social events | assistant preferences
0040 | en | teaching and courses | team project notes
0041 | pt | software project (stack, deploys, incidents) | personal notes
0042 | pl | agency client accounts | chat-like messages
0043 | en | moving house | assistant preferences
0044 | es | personal finances and subscriptions | team project notes
0045 | it | team rituals and tools | personal notes
0046 | nl | investing education (no advice) | chat-like messages
0047 | ar | e-commerce shop | assistant preferences
0048 | fr | video game development | team project notes
0049 | de | pets | personal notes
0050 | pt | garden and plants | chat-like messages
0051 | zh | legal and admin paperwork (invented) | assistant preferences
0052 | en | hardware and electronics projects | team project notes
0053 | es | research thesis | personal notes
0054 | it | restaurant or café | chat-like messages
0055 | ja | cooking and diet | assistant preferences
0056 | es | hobbies and crafts | team project notes
0057 | fr | writing a book | personal notes
0058 | de | coding style and tooling preferences | chat-like messages
0059 | tr | freelance client work | assistant preferences
0060 | fr | house renovation | team project notes
0061 | en | car, bike and transport | personal notes
0062 | pt | job search and interviews | chat-like messages
0063 | pl | volunteering and associations | assistant preferences
0064 | en | mobile app startup | team project notes
0065 | es | open-source library | personal notes
0066 | it | family life and birthdays | chat-like messages
0067 | nl | health appointments (non-sensitive, logistics only) | assistant preferences
0068 | ar | company policies and HR logistics | team project notes
0069 | fr | science and lab notes | personal notes
0070 | de | data / ML experiment | chat-like messages
0071 | pt | podcast or YouTube channel | assistant preferences
0072 | zh | sport and training plan | team project notes
0073 | en | books, films and music | personal notes
0074 | es | home server and smart home | chat-like messages
0075 | it | assistant rules and answer style | assistant preferences
0076 | ja | school or university course | team project notes
0077 | es | wedding or big event | personal notes
0078 | fr | travel planning | chat-like messages
0079 | de | friends and social events | assistant preferences
0080 | tr | teaching and courses | team project notes
0081 | fr | software project (stack, deploys, incidents) | personal notes
0082 | en | agency client accounts | chat-like messages
0083 | pt | moving house | assistant preferences
0084 | pl | personal finances and subscriptions | team project notes
0085 | en | team rituals and tools | personal notes
0086 | es | investing education (no advice) | chat-like messages
0087 | it | e-commerce shop | assistant preferences
0088 | nl | video game development | team project notes
0089 | ar | pets | personal notes
0090 | fr | garden and plants | chat-like messages
0091 | de | legal and admin paperwork (invented) | assistant preferences
0092 | pt | hardware and electronics projects | team project notes
0093 | zh | research thesis | personal notes
0094 | en | restaurant or café | chat-like messages
0095 | es | cooking and diet | assistant preferences
0096 | it | hobbies and crafts | team project notes
0097 | ja | writing a book | personal notes
0098 | es | coding style and tooling preferences | chat-like messages
0099 | fr | freelance client work | assistant preferences
0100 | de | house renovation | team project notes
0101 | tr | car, bike and transport | personal notes
0102 | fr | job search and interviews | chat-like messages
0103 | en | volunteering and associations | assistant preferences
0104 | pt | mobile app startup | team project notes
0105 | pl | open-source library | personal notes
0106 | en | family life and birthdays | chat-like messages
0107 | es | health appointments (non-sensitive, logistics only) | assistant preferences
0108 | it | company policies and HR logistics | team project notes
0109 | nl | science and lab notes | personal notes
0110 | ar | data / ML experiment | chat-like messages
0111 | fr | podcast or YouTube channel | assistant preferences
0112 | de | sport and training plan | team project notes
0113 | pt | books, films and music | personal notes
0114 | zh | home server and smart home | chat-like messages
0115 | en | assistant rules and answer style | assistant preferences
0116 | es | school or university course | team project notes
0117 | it | wedding or big event | personal notes
0118 | ja | travel planning | chat-like messages
0119 | es | friends and social events | assistant preferences
0120 | fr | teaching and courses | team project notes
0121 | de | software project (stack, deploys, incidents) | personal notes
0122 | tr | agency client accounts | chat-like messages
0123 | fr | moving house | assistant preferences
0124 | en | personal finances and subscriptions | team project notes
0125 | pt | team rituals and tools | personal notes
0126 | pl | investing education (no advice) | chat-like messages
0127 | en | e-commerce shop | assistant preferences
0128 | es | video game development | team project notes
0129 | it | pets | personal notes
0130 | nl | garden and plants | chat-like messages
0131 | ar | legal and admin paperwork (invented) | assistant preferences
0132 | fr | hardware and electronics projects | team project notes
0133 | de | research thesis | personal notes
0134 | pt | restaurant or café | chat-like messages
0135 | zh | cooking and diet | assistant preferences
0136 | en | hobbies and crafts | team project notes
0137 | es | writing a book | personal notes
0138 | it | coding style and tooling preferences | chat-like messages
0139 | ja | freelance client work | assistant preferences
0140 | es | house renovation | team project notes
0141 | fr | car, bike and transport | personal notes
0142 | de | job search and interviews | chat-like messages
0143 | tr | volunteering and associations | assistant preferences
0144 | fr | mobile app startup | team project notes
0145 | en | open-source library | personal notes
0146 | pt | family life and birthdays | chat-like messages
0147 | pl | health appointments (non-sensitive, logistics only) | assistant preferences
0148 | en | company policies and HR logistics | team project notes
0149 | es | science and lab notes | personal notes
0150 | it | data / ML experiment | chat-like messages
0151 | nl | podcast or YouTube channel | assistant preferences
0152 | ar | sport and training plan | team project notes
0153 | fr | books, films and music | personal notes
0154 | de | home server and smart home | chat-like messages
0155 | pt | assistant rules and answer style | assistant preferences
0156 | zh | school or university course | team project notes
0157 | en | wedding or big event | personal notes
0158 | es | travel planning | chat-like messages
0159 | it | friends and social events | assistant preferences
0160 | ja | teaching and courses | team project notes
0161 | es | software project (stack, deploys, incidents) | personal notes
0162 | fr | agency client accounts | chat-like messages
0163 | de | moving house | assistant preferences
0164 | tr | personal finances and subscriptions | team project notes
0165 | fr | team rituals and tools | personal notes
0166 | en | investing education (no advice) | chat-like messages
0167 | pt | e-commerce shop | assistant preferences
0168 | pl | video game development | team project notes
0169 | en | pets | personal notes
0170 | es | garden and plants | chat-like messages
0171 | it | legal and admin paperwork (invented) | assistant preferences
0172 | nl | hardware and electronics projects | team project notes
0173 | ar | research thesis | personal notes
0174 | fr | restaurant or café | chat-like messages
0175 | de | cooking and diet | assistant preferences
0176 | pt | hobbies and crafts | team project notes
0177 | zh | writing a book | personal notes
0178 | en | coding style and tooling preferences | chat-like messages
0179 | es | freelance client work | assistant preferences
0180 | it | house renovation | team project notes
0181 | ja | car, bike and transport | personal notes
0182 | es | job search and interviews | chat-like messages
0183 | fr | volunteering and associations | assistant preferences
0184 | de | mobile app startup | team project notes
0185 | tr | open-source library | personal notes
0186 | fr | family life and birthdays | chat-like messages
0187 | en | health appointments (non-sensitive, logistics only) | assistant preferences
0188 | pt | company policies and HR logistics | team project notes
0189 | pl | science and lab notes | personal notes
0190 | en | data / ML experiment | chat-like messages
0191 | es | podcast or YouTube channel | assistant preferences
0192 | it | sport and training plan | team project notes
0193 | nl | books, films and music | personal notes
0194 | ar | home server and smart home | chat-like messages
0195 | fr | assistant rules and answer style | assistant preferences
0196 | de | school or university course | team project notes
0197 | pt | wedding or big event | personal notes
0198 | zh | travel planning | chat-like messages
0199 | en | friends and social events | assistant preferences
0200 | es | teaching and courses | team project notes
0201 | it | software project (stack, deploys, incidents) | personal notes
0202 | ja | agency client accounts | chat-like messages
0203 | es | moving house | assistant preferences
0204 | fr | personal finances and subscriptions | team project notes
0205 | de | team rituals and tools | personal notes
0206 | tr | investing education (no advice) | chat-like messages
0207 | fr | e-commerce shop | assistant preferences
0208 | en | video game development | team project notes
0209 | pt | pets | personal notes
0210 | pl | garden and plants | chat-like messages
0211 | en | legal and admin paperwork (invented) | assistant preferences
0212 | es | hardware and electronics projects | team project notes
0213 | it | research thesis | personal notes
0214 | nl | restaurant or café | chat-like messages
0215 | ar | cooking and diet | assistant preferences
0216 | fr | hobbies and crafts | team project notes
0217 | de | writing a book | personal notes
0218 | pt | coding style and tooling preferences | chat-like messages
0219 | zh | freelance client work | assistant preferences
0220 | en | house renovation | team project notes
0221 | es | car, bike and transport | personal notes
0222 | it | job search and interviews | chat-like messages
0223 | ja | volunteering and associations | assistant preferences
0224 | es | mobile app startup | team project notes
0225 | fr | open-source library | personal notes
0226 | de | family life and birthdays | chat-like messages
0227 | tr | health appointments (non-sensitive, logistics only) | assistant preferences
0228 | fr | company policies and HR logistics | team project notes
0229 | en | science and lab notes | personal notes
0230 | pt | data / ML experiment | chat-like messages
0231 | pl | podcast or YouTube channel | assistant preferences
0232 | en | sport and training plan | team project notes
0233 | es | books, films and music | personal notes
0234 | it | home server and smart home | chat-like messages
0235 | nl | assistant rules and answer style | assistant preferences
0236 | ar | school or university course | team project notes
0237 | fr | wedding or big event | personal notes
0238 | de | travel planning | chat-like messages
0239 | pt | friends and social events | assistant preferences
0240 | zh | teaching and courses | team project notes
0241 | en | software project (stack, deploys, incidents) | personal notes
0242 | es | agency client accounts | chat-like messages
0243 | it | moving house | assistant preferences
0244 | ja | personal finances and subscriptions | team project notes
0245 | es | team rituals and tools | personal notes
0246 | fr | investing education (no advice) | chat-like messages
0247 | de | e-commerce shop | assistant preferences
0248 | tr | video game development | team project notes
0249 | fr | pets | personal notes
0250 | en | garden and plants | chat-like messages
0251 | pt | legal and admin paperwork (invented) | assistant preferences
0252 | pl | hardware and electronics projects | team project notes
0253 | en | research thesis | personal notes
0254 | es | restaurant or café | chat-like messages
0255 | it | cooking and diet | assistant preferences
0256 | nl | hobbies and crafts | team project notes
0257 | ar | writing a book | personal notes
0258 | fr | coding style and tooling preferences | chat-like messages
0259 | de | freelance client work | assistant preferences
0260 | pt | house renovation | team project notes
0261 | zh | car, bike and transport | personal notes
0262 | en | job search and interviews | chat-like messages
0263 | es | volunteering and associations | assistant preferences
0264 | it | mobile app startup | team project notes
0265 | ja | open-source library | personal notes
0266 | es | family life and birthdays | chat-like messages
0267 | fr | health appointments (non-sensitive, logistics only) | assistant preferences
0268 | de | company policies and HR logistics | team project notes
0269 | tr | science and lab notes | personal notes
0270 | fr | data / ML experiment | chat-like messages
0271 | en | podcast or YouTube channel | assistant preferences
0272 | pt | sport and training plan | team project notes
0273 | pl | books, films and music | personal notes
0274 | en | home server and smart home | chat-like messages
0275 | es | assistant rules and answer style | assistant preferences
0276 | it | school or university course | team project notes
0277 | nl | wedding or big event | personal notes
0278 | ar | travel planning | chat-like messages
0279 | fr | friends and social events | assistant preferences
0280 | de | teaching and courses | team project notes
0281 | pt | software project (stack, deploys, incidents) | personal notes
0282 | zh | agency client accounts | chat-like messages
0283 | en | moving house | assistant preferences
0284 | es | personal finances and subscriptions | team project notes
0285 | it | team rituals and tools | personal notes
0286 | ja | investing education (no advice) | chat-like messages
0287 | es | e-commerce shop | assistant preferences
0288 | fr | video game development | team project notes
0289 | de | pets | personal notes
0290 | tr | garden and plants | chat-like messages
0291 | fr | legal and admin paperwork (invented) | assistant preferences
0292 | en | hardware and electronics projects | team project notes
0293 | pt | research thesis | personal notes
0294 | pl | restaurant or café | chat-like messages
0295 | en | cooking and diet | assistant preferences
0296 | es | hobbies and crafts | team project notes
0297 | it | writing a book | personal notes
0298 | nl | coding style and tooling preferences | chat-like messages
0299 | ar | freelance client work | assistant preferences
0300 | fr | house renovation | team project notes
0301 | de | car, bike and transport | personal notes
0302 | pt | job search and interviews | chat-like messages
0303 | zh | volunteering and associations | assistant preferences
0304 | en | mobile app startup | team project notes
0305 | es | open-source library | personal notes
0306 | it | family life and birthdays | chat-like messages
0307 | ja | health appointments (non-sensitive, logistics only) | assistant preferences
0308 | es | company policies and HR logistics | team project notes
0309 | fr | science and lab notes | personal notes
0310 | de | data / ML experiment | chat-like messages
0311 | tr | podcast or YouTube channel | assistant preferences
0312 | fr | sport and training plan | team project notes
0313 | en | books, films and music | personal notes
0314 | pt | home server and smart home | chat-like messages
0315 | pl | assistant rules and answer style | assistant preferences
0316 | en | school or university course | team project notes
0317 | es | wedding or big event | personal notes
0318 | it | travel planning | chat-like messages
0319 | nl | friends and social events | assistant preferences
0320 | ar | teaching and courses | team project notes
0321 | fr | software project (stack, deploys, incidents) | personal notes
0322 | de | agency client accounts | chat-like messages
0323 | pt | moving house | assistant preferences
0324 | zh | personal finances and subscriptions | team project notes
0325 | en | team rituals and tools | personal notes
0326 | es | investing education (no advice) | chat-like messages
0327 | it | e-commerce shop | assistant preferences
0328 | ja | video game development | team project notes
0329 | es | pets | personal notes
0330 | fr | garden and plants | chat-like messages
0331 | de | legal and admin paperwork (invented) | assistant preferences
0332 | tr | hardware and electronics projects | team project notes
0333 | fr | research thesis | personal notes
0334 | en | restaurant or café | chat-like messages
0335 | pt | cooking and diet | assistant preferences
0336 | pl | hobbies and crafts | team project notes
0337 | en | writing a book | personal notes
0338 | es | coding style and tooling preferences | chat-like messages
0339 | it | freelance client work | assistant preferences
0340 | nl | house renovation | team project notes
0341 | ar | car, bike and transport | personal notes
0342 | fr | job search and interviews | chat-like messages
0343 | de | volunteering and associations | assistant preferences
0344 | pt | mobile app startup | team project notes
0345 | zh | open-source library | personal notes
0346 | en | family life and birthdays | chat-like messages
0347 | es | health appointments (non-sensitive, logistics only) | assistant preferences
0348 | it | company policies and HR logistics | team project notes
0349 | ja | science and lab notes | personal notes
0350 | es | data / ML experiment | chat-like messages
0351 | fr | podcast or YouTube channel | assistant preferences
0352 | de | sport and training plan | team project notes
0353 | tr | books, films and music | personal notes
0354 | fr | home server and smart home | chat-like messages
0355 | en | assistant rules and answer style | assistant preferences
0356 | pt | school or university course | team project notes
0357 | pl | wedding or big event | personal notes
0358 | en | travel planning | chat-like messages
0359 | es | friends and social events | assistant preferences
0360 | it | teaching and courses | team project notes
0361 | nl | software project (stack, deploys, incidents) | personal notes
0362 | ar | agency client accounts | chat-like messages
0363 | fr | moving house | assistant preferences
0364 | de | personal finances and subscriptions | team project notes
0365 | pt | team rituals and tools | personal notes
0366 | zh | investing education (no advice) | chat-like messages
0367 | en | e-commerce shop | assistant preferences
0368 | es | video game development | team project notes
0369 | it | pets | personal notes
0370 | ja | garden and plants | chat-like messages
0371 | es | legal and admin paperwork (invented) | assistant preferences
0372 | fr | hardware and electronics projects | team project notes
0373 | de | research thesis | personal notes
0374 | tr | restaurant or café | chat-like messages
0375 | fr | cooking and diet | assistant preferences
0376 | en | hobbies and crafts | team project notes
0377 | pt | writing a book | personal notes
0378 | pl | coding style and tooling preferences | chat-like messages
0379 | en | freelance client work | assistant preferences
0380 | es | house renovation | team project notes
```

Begin now with **batch 0001**, then wait for `next`.
