# Instagram Reel Transcriber

Transcribe Instagram reels with OpenAI Whisper or Google Gemini. FastAPI backend + static HTML/JS frontend.

## Local development

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # then fill in your keys
cd backend
uvicorn main:app --port 8000 --reload
```

Open http://localhost:8000/

## Environment variables

| Variable | Required | Notes |
|---|---|---|
| `OPENAI_API_KEY` | for OpenAI provider | Whisper transcription |
| `GEMINI_API_KEY` | for Gemini provider | Video transcription |
| `COOKIES_FILE` | optional | Path to Netscape cookies.txt for private reels (local only) |
| `COOKIES_FROM_BROWSER` | optional | `chrome` / `firefox` / `safari` (local only — does not work on Vercel) |

## Deploy to Vercel

1. Push this repo to GitHub.
2. Import into Vercel as a new project.
3. In Vercel project settings → Environment Variables, set `OPENAI_API_KEY` and `GEMINI_API_KEY`.
4. Deploy.

Routing is handled by `vercel.json`: every request goes to `api/index.py`, which loads the FastAPI app from `backend/main.py`. Function timeout is 300s (Pro plan; falls back to 60s on Hobby).

### Vercel limitations

- Profile batch (`/transcribe-profile`) is capped by function duration. Use `count<=5` per request on Pro, `count<=2` on Hobby.
- Browser cookie extraction (`COOKIES_FROM_BROWSER`) does not work on Vercel — only public reels can be downloaded.

## Project layout

```
api/index.py          # Vercel function entry — loads FastAPI app
backend/              # FastAPI app, downloader, transcribers
frontend/             # Static HTML/JS/CSS
vercel.json           # Vercel routing + function config
requirements.txt      # Python deps (read by Vercel from repo root)
runtime.txt           # python-3.12
```
