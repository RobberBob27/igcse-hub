"""
Vercel Serverless Function (Python) — POST /api/quiz

Generates a multiple-choice quiz with Google Gemini using structured JSON output,
then validates and shuffles the questions before returning them.

Request JSON:
    {"subject": "Chemistry", "topic": "Electrolysis", "difficulty": "Mixed", "count": 10}

Response JSON:
    {"title": "...", "questions": [
        {"question": "...", "options": ["...", "...", "...", "..."], "answer": 2,
         "explanation": "...", "hint": "...", "topic": "..."}
    ]}

Environment variables:
    GEMINI_API_KEY   required
    GEMINI_MODEL     optional, defaults to gemini-3.8-flash
    ACCESS_CODES     optional, comma-separated codes; if set, only these codes can use AI quizzes

Uses only the Python standard library, so no requirements.txt is needed.
"""

from http.server import BaseHTTPRequestHandler
import json
import os
import random
import re
import urllib.error
import urllib.request

MODEL = os.environ.get("GEMINI_MODEL", "gemini-3.8-flash")
API_BASE = os.environ.get("GEMINI_API_BASE", "https://generativelanguage.googleapis.com").rstrip("/")
TIMEOUT_SECONDS = 55

SUBJECT_CODES = {
    "Mathematics": "4MA1", "Physics": "4PH1", "Chemistry": "4CH1", "Biology": "4BI1",
    "English Language": "4EA1", "English Literature": "4ET1", "Computer Science": "4CP0",
    "Economics": "4EC1", "Business": "4BS1", "Geography": "4GE1", "History": "4HI1",
}

DIFFICULTY_GUIDE = {
    "Foundation": "Foundation tier (around grades 3-5): recall and straightforward one-step application.",
    "Higher": "Higher tier (around grades 7-9): multi-step problems, application to unfamiliar contexts and analysis.",
    "Mixed": "a mix of difficulties, ordered from easier to harder.",
}

ALLOWED_COUNTS = (5, 10, 15)

QUIZ_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "title": {"type": "STRING"},
        "questions": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "question": {"type": "STRING"},
                    "options": {"type": "ARRAY", "items": {"type": "STRING"}},
                    "answerIndex": {"type": "INTEGER"},
                    "explanation": {"type": "STRING"},
                    "hint": {"type": "STRING"},
                    "topic": {"type": "STRING"},
                },
                "required": ["question", "options", "answerIndex", "explanation", "hint", "topic"],
                "propertyOrdering": ["topic", "question", "options", "answerIndex", "explanation", "hint"],
            },
        },
    },
    "required": ["title", "questions"],
    "propertyOrdering": ["title", "questions"],
}


class QuizError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def clean_text(value, limit):
    """Strip control characters and trim to a maximum length."""
    text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", str(value or ""))
    return text.strip()[:limit]


def build_prompt(subject, topic, difficulty, count):
    code = SUBJECT_CODES[subject]
    focus = f'the topic "{topic}"' if topic else "a balanced spread of topics from across the specification"
    return f"""Write a {count}-question multiple-choice quiz for Pearson Edexcel International GCSE {subject} ({code}) on {focus}.
Difficulty: {DIFFICULTY_GUIDE[difficulty]}

Rules:
- Exactly 4 options per question, with exactly one unambiguously correct answer. answerIndex is the 0-based index of the correct option.
- Distractors must be plausible and based on common student misconceptions.
- Never use "all of the above" or "none of the above". Do not put letters like "A)" in the options.
- Keep options short. Questions must be answerable without a diagram.
- Stay within the Edexcel International GCSE specification. Use British English and SI units.
- explanation: 1-3 sentences on why the answer is right and why the most tempting wrong option is wrong.
- hint: one sentence that nudges the student without giving the answer away.
- topic: the specific sub-topic in 2-5 words.
- Write any maths, formulas or chemical equations in LaTeX inside \\( ... \\). Never use $ for maths.
- No two questions may test the same fact.
- title: a short quiz title (max 6 words).
If the requested topic is not part of this subject, write the quiz on the closest relevant topic from the specification instead."""


def call_gemini(api_key, payload):
    url = f"{API_BASE}/v1beta/models/{MODEL}:generateContent"
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "x-goog-api-key": api_key},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as resp:
        return json.loads(resp.read().decode("utf-8"))


def generate(api_key, subject, topic, difficulty, count):
    payload = {
        "contents": [{"role": "user", "parts": [{"text": build_prompt(subject, topic, difficulty, count)}]}],
        "generationConfig": {
            "responseMimeType": "application/json",
            "responseSchema": QUIZ_SCHEMA,
            "maxOutputTokens": 8192,
            "thinkingConfig": {"thinkingLevel": "low"},
        },
    }
    try:
        data = call_gemini(api_key, payload)
    except urllib.error.HTTPError as err:
        if err.code != 400:
            raise
        # Some models reject thinkingConfig - retry once without it.
        payload["generationConfig"].pop("thinkingConfig", None)
        data = call_gemini(api_key, payload)

    candidates = data.get("candidates") or []
    if not candidates:
        raise QuizError("The AI declined to write that quiz. Try a different topic.", 422)
    parts = (candidates[0].get("content") or {}).get("parts") or []
    raw = "".join(p.get("text", "") for p in parts if not p.get("thought"))
    raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw.strip())
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        raise QuizError("The AI returned a quiz in the wrong format. Please try again.", 502)


def validate_quiz(data, count):
    """Keep only well-formed questions, then shuffle each question's options."""
    questions = []
    seen = set()
    for q in (data or {}).get("questions") or []:
        if not isinstance(q, dict):
            continue
        question = clean_text(q.get("question"), 800)
        options = []
        for opt in q.get("options") or []:
            opt = re.sub(r"^\s*(?:[A-Da-d][).:]|\([A-Da-d]\))\s+", "", clean_text(opt, 300))
            if opt and opt not in options:
                options.append(opt)
        try:
            answer = int(q.get("answerIndex"))
        except (TypeError, ValueError):
            continue
        if not question or len(options) < 2 or not 0 <= answer < len(options) or question in seen:
            continue
        correct = options[answer]
        options = options[:4]
        if correct not in options:
            options[-1] = correct
        order = list(range(len(options)))
        random.shuffle(order)
        shuffled = [options[i] for i in order]
        seen.add(question)
        questions.append({
            "question": question,
            "options": shuffled,
            "answer": shuffled.index(correct),
            "explanation": clean_text(q.get("explanation"), 1200),
            "hint": clean_text(q.get("hint"), 400),
            "topic": clean_text(q.get("topic"), 60),
        })
        if len(questions) >= count:
            break
    if not questions:
        raise QuizError("The AI couldn't write valid questions for that. Try another topic.", 502)
    return {"title": clean_text((data or {}).get("title"), 80), "questions": questions}


def handle_request(body, api_key):
    """Pure function used by the HTTP handler (and by tests). Returns (status, dict)."""
    if not api_key:
        return 500, {"error": "The quiz generator isn't set up yet: add a GEMINI_API_KEY environment variable in Vercel and redeploy."}
    if not isinstance(body, dict):
        return 400, {"error": "Invalid JSON body."}

    subject = body.get("subject")
    if subject not in SUBJECT_CODES:
        return 400, {"error": "Please choose a subject."}
    topic = clean_text(body.get("topic"), 120)
    difficulty = body.get("difficulty") if body.get("difficulty") in DIFFICULTY_GUIDE else "Mixed"
    try:
        count = int(body.get("count", 5))
    except (TypeError, ValueError):
        count = 5
    count = min(ALLOWED_COUNTS, key=lambda n: abs(n - count))

    try:
        data = generate(api_key, subject, topic, difficulty, count)
        return 200, validate_quiz(data, count)
    except QuizError as err:
        return err.status, {"error": str(err)}
    except urllib.error.HTTPError as err:
        detail = err.read().decode("utf-8", "replace")[:500] if hasattr(err, "read") else ""
        print(f"Gemini error {err.code}: {detail}")
        if err.code == 429:
            return 429, {"error": "The quiz generator is busy. Please wait a few seconds and try again."}
        if err.code in (401, 403):
            return 502, {"error": "The AI service rejected the API key. Check GEMINI_API_KEY in Vercel."}
        if err.code == 404:
            return 502, {"error": "The configured AI model wasn't found. Check GEMINI_MODEL in Vercel."}
        return 502, {"error": f"The AI service had a problem ({err.code}). Please try again."}
    except (urllib.error.URLError, TimeoutError) as err:
        print(f"Network error: {err}")
        return 504, {"error": "The AI took too long to respond. Try fewer questions."}


def has_access(given):
    """ACCESS_CODES is a comma-separated list set in Vercel. Empty or missing means open to everyone."""
    codes = [c.strip() for c in os.environ.get("ACCESS_CODES", "").split(",") if c.strip()]
    if not codes:
        return True
    return bool(given) and given.strip() in codes


class handler(BaseHTTPRequestHandler):
    def _send(self, status, obj):
        payload = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length > 20_000:
            return self._send(413, {"error": "Request too large."})
        try:
            body = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
        except (ValueError, UnicodeDecodeError):
            return self._send(400, {"error": "Invalid JSON body."})
        if not has_access(self.headers.get("X-Access-Code")):
            return self._send(401, {"error": "AI quizzes are for approved users. Click Log in and enter your access code, or use the question bank."})
        status, result = handle_request(body, os.environ.get("GEMINI_API_KEY"))
        self._send(status, result)

    def do_GET(self):
        self._send(405, {"error": "Use POST."})

    def log_message(self, fmt, *args):  # keep Vercel logs tidy
        return
