import asyncio
import json
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, StreamingResponse

from config import settings
from models import TranscribeRequest, TranscribeResponse, ProfileTranscribeRequest
from downloader import download_video
from audio import extract_audio
from transcribe_openai import transcribe_with_openai
from transcribe_gemini import transcribe_with_gemini
from profile_scraper import get_profile_reels
from utils import is_valid_instagram_url, cleanup_files

import yt_dlp.utils as yt_utils

FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend")


@asynccontextmanager
async def lifespan(app: FastAPI):
    os.makedirs(settings.tmp_dir, exist_ok=True)
    yield


app = FastAPI(title="Instagram Reel Transcriber", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")


@app.get("/")
async def serve_index():
    return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/transcribe", response_model=TranscribeResponse)
async def transcribe(req: TranscribeRequest):

    if not is_valid_instagram_url(req.url):
        raise HTTPException(
            status_code=422,
            detail="Invalid Instagram URL. Must be a public reel, post, or IGTV link.",
        )

    if req.provider == "openai" and not settings.openai_api_key:
        raise HTTPException(status_code=400, detail="OPENAI_API_KEY is not configured.")
    if req.provider == "gemini" and not settings.gemini_api_key:
        raise HTTPException(status_code=400, detail="GEMINI_API_KEY is not configured.")

    video_path = None
    audio_path = None
    was_trimmed = False

    try:
        loop = asyncio.get_running_loop()

        video_path = await loop.run_in_executor(
            None, download_video, req.url, settings.tmp_dir
        )

        if req.provider == "openai":
            audio_path, was_trimmed = await loop.run_in_executor(
                None, extract_audio, video_path, settings.max_file_size_mb
            )
            result = await transcribe_with_openai(audio_path, req.language, req.prompt)

        else:
            result = await loop.run_in_executor(
                None, transcribe_with_gemini, video_path, req.language
            )

        return TranscribeResponse(
            transcript=result["transcript"],
            provider=req.provider,
            duration_seconds=result.get("duration_seconds"),
            language_detected=result.get("language_detected"),
            warning="Audio was re-encoded at lower bitrate to fit 25MB limit." if was_trimmed else None,
        )

    except yt_utils.DownloadError as e:
        msg = str(e)
        hint = ""
        if "login" in msg.lower() or "private" in msg.lower() or "404" in msg:
            hint = " This may be a private reel. Try setting COOKIES_FROM_BROWSER=chrome in your .env file."
        raise HTTPException(status_code=422, detail=f"Could not download reel: {msg}{hint}")

    except FileNotFoundError as e:
        raise HTTPException(status_code=500, detail=str(e))

    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    finally:
        cleanup_files(video_path, audio_path)


@app.post("/transcribe-profile")
async def transcribe_profile(req: ProfileTranscribeRequest):
    if req.provider == "openai" and not settings.openai_api_key:
        raise HTTPException(status_code=400, detail="OPENAI_API_KEY is not configured.")
    if req.provider == "gemini" and not settings.gemini_api_key:
        raise HTTPException(status_code=400, detail="GEMINI_API_KEY is not configured.")

    loop = asyncio.get_running_loop()

    try:
        reels = await loop.run_in_executor(None, get_profile_reels, req.profile_url, req.count)
    except Exception as e:
        raise HTTPException(status_code=422, detail=str(e))

    async def event_stream():
        # Send the list of reels found
        yield f"data: {json.dumps({'type': 'reels_found', 'total': len(reels), 'reels': [{'title': r['title'], 'url': r['url']} for r in reels]})}\n\n"

        for i, reel in enumerate(reels):
            yield f"data: {json.dumps({'type': 'progress', 'index': i, 'title': reel['title'], 'status': 'downloading'})}\n\n"

            video_path = None
            audio_path = None
            try:
                video_path = await loop.run_in_executor(
                    None, download_video, reel["url"], settings.tmp_dir
                )

                yield f"data: {json.dumps({'type': 'progress', 'index': i, 'title': reel['title'], 'status': 'transcribing'})}\n\n"

                if req.provider == "openai":
                    audio_path, _ = await loop.run_in_executor(
                        None, extract_audio, video_path, settings.max_file_size_mb
                    )
                    result = await transcribe_with_openai(audio_path, req.language, "")
                else:
                    result = await loop.run_in_executor(
                        None, transcribe_with_gemini, video_path, req.language
                    )

                yield f"data: {json.dumps({'type': 'result', 'index': i, 'title': reel['title'], 'url': reel['url'], 'transcript': result['transcript'], 'duration_seconds': result.get('duration_seconds'), 'language_detected': result.get('language_detected')})}\n\n"

            except Exception as e:
                yield f"data: {json.dumps({'type': 'error', 'index': i, 'title': reel['title'], 'url': reel['url'], 'error': str(e)})}\n\n"

            finally:
                cleanup_files(video_path, audio_path)

        yield f"data: {json.dumps({'type': 'done'})}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")
