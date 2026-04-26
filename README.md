# TwinMind — Live Suggestions Web App

An AI-powered real-time meeting copilot that listens to your conversation and surfaces smart, contextual suggestions as you talk.

## Live Demo
[Add your Vercel URL here]

## GitHub
https://github.com/ShivaniSutrave/twinmind-live-suggestions

---

## Features

### Core Features
- 🎤 **Live Mic + Transcript** — Words appear instantly as you speak using Web Speech API
- 💡 **Live Suggestions** — 3 smart suggestion cards every 30 seconds based on recent speech only
- 💬 **Chat Panel** — Click any suggestion for a detailed answer, or type your own question
- ⚙️ **Settings** — Paste your own Groq API key, edit all prompts and context windows
- 📤 **Export** — Full session JSON with transcript, suggestions, chat, and ratings

### Bonus Features
- 🏷️ **Meeting Type Auto-Detection** — Detects Job Interview, Sales Call, Technical Meeting, etc.
- 📝 **Smart Notes** — Auto-captures key points, concerns, problems, and suggests solutions
- 🗂️ **Meeting History** — Every session saved and viewable inside the app
- 🔄 **New Topic Button** — Resets context so suggestions stay focused
- ⭐ **Suggestion Ratings** — Thumbs up/down on every card
- 📋 **Post-Meeting Summary** — Auto-generates after recording stops
- 🚫 **Content Filter** — Filters inappropriate language from all output

---

## Tech Stack
- **Frontend:** Vanilla HTML, CSS, JavaScript
- **Transcription:** Web Speech API (real-time words)
- **AI Model:** llama-3.3-70b-versatile via Groq API
- **Streaming:** SSE for real-time chat
- **Storage:** localStorage for history
- **Deployment:** Vercel

---

## Setup
1. Clone this repo
2. Open index.html OR deploy to Vercel
3. Click More → Settings → paste your Groq API key (console.groq.com)
4. Click mic and start talking!

No install, no build step, no backend needed.

---

## Prompt Strategy

### Suggestion Prompt
- Uses last 120 words only — keeps suggestions relevant to RIGHT NOW
- Meeting type injected — suggestions adapt to context
- Instructs model to mix types: ANSWER, QUESTION, TALKING_POINT, FACT_CHECK
- Each preview is standalone useful without clicking

### Chat Prompt
- Last 400 words of transcript for context
- Strict 100 word limit — focused answers
- Professional tone enforced

### Notes Prompt
- Runs every 35 seconds independently
- Extracts KEY_POINT, CONCERN, PROBLEM, ACTION_ITEM
- Each note includes a solution suggestion

### Summary Prompt
- Runs after recording stops
- Structured output: key points, action items, decisions, unanswered questions

---

## Improvements Over TwinMind

| Problem noticed | Solution built |
|----------------|---------------|
| Same suggestions for all meeting types | Auto-detects meeting type, adapts suggestions |
| No way to track key points | Smart Notes column with auto-capture |
| No meeting history | Full history saved, viewable in-app |
| Topics mix in long meetings | New Topic button resets context |
| No feedback on suggestions | Thumbs up/down ratings |
| No post-meeting value | Auto summary with action items |

---

## Tradeoffs

| Decision | Why |
|----------|-----|
| Vanilla JS | Zero build step, easy to deploy |
| Web Speech API | Instant words vs Whisper 30s delay |
| 120 word context for suggestions | Focused on current moment |
| 100 word chat limit | Concise useful answers |
| localStorage | No backend needed |
