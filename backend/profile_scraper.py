import http.cookiejar
import re

import requests
from yt_dlp.cookies import extract_cookies_from_browser

from config import settings

IG_USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)


def _load_instagram_cookies() -> dict | None:
    """Load Instagram cookies from browser or cookie file, matching the app's config."""
    cookies = {}

    if settings.cookies_from_browser:
        jar = extract_cookies_from_browser(settings.cookies_from_browser)
        for cookie in jar:
            if "instagram" in cookie.domain:
                cookies[cookie.name] = cookie.value

    elif settings.cookies_file:
        jar = http.cookiejar.MozillaCookieJar(settings.cookies_file)
        jar.load(ignore_discard=True, ignore_expires=True)
        for cookie in jar:
            if "instagram" in cookie.domain:
                cookies[cookie.name] = cookie.value

    return cookies if cookies else None


def _extract_username(profile_url: str) -> str:
    """Extract username from an Instagram profile URL or plain username."""
    profile_url = profile_url.strip().rstrip("/")
    match = re.match(r"^https?://(www\.)?instagram\.com/([A-Za-z0-9_.]+)/?", profile_url)
    if match:
        return match.group(2)
    if "/" not in profile_url and " " not in profile_url:
        return profile_url
    raise ValueError(f"Could not extract username from: {profile_url}")


def _get_user_id(session: requests.Session, username: str) -> str:
    """Get the Instagram user ID from a username using the web profile API."""
    url = f"https://www.instagram.com/api/v1/users/web_profile_info/?username={username}"
    resp = session.get(url)

    if resp.status_code == 404:
        raise RuntimeError(f"Profile '{username}' does not exist.")
    if resp.status_code != 200:
        raise RuntimeError(
            f"Failed to fetch profile info (HTTP {resp.status_code}). "
            "Your cookies may be stale — log into Instagram in Chrome and restart the server."
        )

    data = resp.json()
    user = data.get("data", {}).get("user")
    if not user:
        raise RuntimeError(f"Profile '{username}' not found.")
    return user["id"]


def _fetch_posts(session: requests.Session, user_id: str, count: int) -> list[dict]:
    """Fetch posts from a user's feed, returning video posts with shortcodes and captions."""
    reels = []
    max_id = None

    while len(reels) < count:
        url = f"https://www.instagram.com/api/v1/feed/user/{user_id}/"
        params = {"count": 33}
        if max_id:
            params["max_id"] = max_id

        resp = session.get(url, params=params)
        if resp.status_code != 200:
            break

        data = resp.json()
        items = data.get("items", [])
        if not items:
            break

        for item in items:
            if len(reels) >= count:
                break

            # Check if it's a video (reel, video post, IGTV)
            media_type = item.get("media_type")
            # media_type: 1 = photo, 2 = video, 8 = carousel
            if media_type != 2:
                continue

            code = item.get("code", "")
            caption_obj = item.get("caption")
            caption = caption_obj.get("text", "") if caption_obj else ""

            title = caption.split("\n")[0].strip() if caption else "Untitled"
            if len(title) > 100:
                title = title[:97] + "..."

            reels.append({
                "url": f"https://www.instagram.com/reel/{code}/",
                "title": title if title else "Untitled",
            })

        if not data.get("more_available", False):
            break
        max_id = data.get("next_max_id")
        if not max_id:
            break

    return reels


def get_profile_reels(profile_url: str, count: int) -> list[dict]:
    """
    Extract reel/video post URLs from an Instagram profile.
    Returns a list of dicts with 'url' and 'title' keys,
    ordered newest-first, limited to `count`.
    """
    username = _extract_username(profile_url)

    cookies = _load_instagram_cookies()
    if not cookies:
        raise RuntimeError(
            "Instagram requires authentication to browse profiles. "
            "Set COOKIES_FROM_BROWSER=chrome in your .env file and make sure "
            "you are logged into Instagram in Chrome."
        )

    session = requests.Session()
    session.cookies.update(cookies)
    session.headers.update({
        "User-Agent": IG_USER_AGENT,
        "X-IG-App-ID": "936619743392459",
        "X-Requested-With": "XMLHttpRequest",
        "Referer": f"https://www.instagram.com/{username}/",
    })
    if "csrftoken" in cookies:
        session.headers["X-CSRFToken"] = cookies["csrftoken"]

    user_id = _get_user_id(session, username)
    reels = _fetch_posts(session, user_id, count)

    if not reels:
        raise RuntimeError(
            f"No video posts found on @{username}. "
            "Make sure the profile has video content."
        )

    return reels
