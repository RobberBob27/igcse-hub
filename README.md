# IGCSE Papers (v2)

Edexcel IGCSE past-paper browser with an **AI tutor** and **AI-generated quizzes**, built to deploy on Vercel.
No build step and no npm dependencies.

## Project layout

```
index.html          Page shell (home, papers, AI tutor, AI quiz views)
css/styles.css      Original theme and the new AI sections
js/
  main.js           Hash router (#ask-ai, #quiz, #browse) and app start-up
  data.js           Subjects, PDF links, specification tracks, topic suggestions
  papers.js         Subject grid, past-paper tables, filters, search (the original site logic)
  tutor.js          AI tutor chat: streaming, modes, photo questions, voice input, saved history
  quiz.js           Quiz: question bank or AI, play, score, review, history and weak topics
  quizbank.js       Built-in question bank (100+ questions, works with no API key)
  qotd.js           Home page "Question of the day"
  markdown.js       Safe Markdown renderer + KaTeX maths rendering
  core.js           Shared state, theming, storage helpers
api/
  chat.js           Node.js function → POST /api/chat  (streams Gemini replies)
  quiz.py           Python function  → POST /api/quiz  (Gemini structured JSON quiz)
vercel.json         Function timeouts and security headers
```

## Deploy to Vercel

1. Get a Gemini API key from https://aistudio.google.com/apikey
2. Push this folder to a GitHub repo and import it at https://vercel.com/new
   (Framework preset: **Other**. Leave build and output settings empty.)
3. In **Project → Settings → Environment Variables** add:
   - `GEMINI_API_KEY`: your key (required)
   - `GEMINI_MODEL`: optional, defaults to `gemini-3.8-flash`
4. Deploy. Vercel picks up `api/chat.js` as a Node function and `api/quiz.py` as a Python function automatically.

Or from the command line: `npm i -g vercel`, then `vercel`, then `vercel env add GEMINI_API_KEY`, then `vercel --prod`.

## Question bank

The quiz works out of the box using `js/quizbank.js`, even before you add an API key.
Add questions as `[topic, question, [correct, wrong, wrong, wrong], explanation, hint]` (the correct option first; options are shuffled when shown).

## Your PDF files

Put your PDFs in the project root, next to `index.html`, exactly as before
(e.g. `chemistry-modular-u1-2025-qp.pdf`). Add new ones to the `pdfs` map in `js/data.js`.

## Local development

```
cp .env.example .env.local   # add your key
vercel dev                   # serves the site and both API functions on http://localhost:3000
```

## API

`POST /api/chat`
```json
{ "subject": "Physics", "tier": "Higher", "mode": "explain",
  "messages": [{ "role": "user", "text": "Explain terminal velocity" }] }
```
Modes: `explain`, `notes`, `practice`, `mark`, `simple`. A user message may include
`"image": { "mimeType": "image/jpeg", "data": "<base64>" }`. The response is a plain-text stream.
The old `{ "prompt": "...", "subject": "..." }` format still works.

`POST /api/quiz`
```json
{ "subject": "Chemistry", "topic": "Electrolysis", "difficulty": "Mixed", "count": 10 }
```
Returns `{ "title", "questions": [{ "question", "options", "answer", "explanation", "hint", "topic" }] }`.
`count` is 5, 10 or 15; `difficulty` is `Foundation`, `Higher` or `Mixed`.

## Notes

- AI output is HTML-escaped before rendering, so model replies can't inject scripts.
- Chat history and quiz scores are saved in each visitor's browser (localStorage), not on a server.
- There is no per-user rate limiting. If the site gets popular, set a spending cap on your Gemini key,
  or add Vercel Firewall rate-limit rules for `/api/*`.
