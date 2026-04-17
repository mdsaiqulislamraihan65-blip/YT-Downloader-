from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse, StreamingResponse, RedirectResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
import yt_dlp
import asyncio
import os
import re
import httpx
from urllib.parse import quote
from io import BytesIO
from googleapiclient.discovery import build
from dotenv import load_dotenv
import firebase_admin
from firebase_admin import credentials, firestore

load_dotenv()

# Initialize Firebase Admin
try:
    firebase_admin.initialize_app()
    db = firestore.client()
except Exception as e:
    print(f"Firebase Admin Init Error: {e}")
    db = None

app = FastAPI(title="YouTube Downloader API")

# Initialize YouTube API client
DEFAULT_KEY = "AIzaSyCaMalgnfJQT6ByPWRBRLmbJaW2TFdMwQo"
YOUTUBE_API_KEY = DEFAULT_KEY

def get_youtube_client():
    global YOUTUBE_API_KEY
    current_key = YOUTUBE_API_KEY
    
    # Try to get updated key from Firestore
    if db:
        try:
            doc = db.collection("config").document("youtube").get()
            if doc.exists:
                data = doc.to_dict()
                if data.get("apiKey"):
                    current_key = data["apiKey"]
        except Exception as e:
            print(f"Error fetching key from Firestore: {e}")
            
    try:
        return build("youtube", "v3", developerKey=current_key)
    except Exception as e:
        print(f"Error initializing YouTube client: {e}")
        # Fallback to default if current fails
        return build("youtube", "v3", developerKey=DEFAULT_KEY)

youtube_client = get_youtube_client()

# Setup CORS for frontend to communicate
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class VideoRequest(BaseModel):
    url: str

class SearchRequest(BaseModel):
    query: str

def get_video_id_from_url(url: str):
    import re
    # Simple regex to get video id
    regex = r"(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^\"&?\/\s]{11})"
    match = re.search(regex, url)
    return match.group(1) if match else None

def get_video_info_api(url: str):
    video_id = get_video_id_from_url(url)
    client = get_youtube_client()
    if not client or not video_id:
        return None
    
    try:
        request = client.videos().list(
            part="snippet,contentDetails",
            id=video_id
        )
        response = request.execute()
        
        if not response['items']:
            return None
            
        item = response['items'][0]
        snippet = item['snippet']
        
        # We still need yt-dlp to get the formats/stream URLs
        # But we can get general info from API if yt-dlp metadata extraction fails
        return {
            "title": snippet['title'],
            "thumbnail": snippet['thumbnails']['high']['url'],
            "id": video_id
        }
    except Exception as e:
        print(f"API Error: {e}")
        return None

def get_video_info(url: str):
    ydl_opts = {
        'quiet': True,
        'no_warnings': True,
        'extract_flat': False,
        'noplaylist': True,
        'youtube_include_dash_manifest': False,
        'source_address': '0.0.0.0',
        'nocheckcertificate': True,
        'geo_bypass': True,
        'http_headers': {
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-us,en;q=0.5',
            'Sec-Fetch-Mode': 'navigate',
        },
        'extractor_args': {
            'youtube': ['client=ios', 'player_client=ios']
        }
    }
    
    if os.path.exists("cookies.txt"):
        ydl_opts['cookiefile'] = "cookies.txt"

    # Try API first for title/thumbnail to bypass basic blocks
    api_info = get_video_info_api(url)

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        try:
            info = ydl.extract_info(url, download=False)
            formats = []
            
            for f in info.get('formats', []):
                if f.get('vcodec') != 'none' and f.get('acodec') != 'none':
                    formats.append({
                        'format_id': f['format_id'],
                        'ext': f['ext'],
                        'resolution': f.get('resolution', 'N/A'),
                        'filesize': f.get('filesize', 0) or f.get('filesize_approx', 0),
                        'type': 'video'
                    })
                elif f.get('vcodec') == 'none' and f.get('acodec') != 'none':
                    formats.append({
                        'format_id': f['format_id'],
                        'ext': f['ext'],
                        'resolution': 'Audio Only',
                        'filesize': f.get('filesize', 0) or f.get('filesize_approx', 0),
                        'type': 'audio'
                    })
            
            unique_formats = {f['resolution']: f for f in formats}.values()
            
            return {
                "title": info.get('title') or (api_info['title'] if api_info else "Video"),
                "thumbnail": info.get('thumbnail') or (api_info['thumbnail'] if api_info else ""),
                "duration": info.get('duration'),
                "formats": sorted(unique_formats, key=lambda x: x.get('filesize', 0), reverse=True)
            }
        except Exception as e:
            # If yt-dlp fails but we have API info, we can at least show the video exists
            # but we can't download without yt-dlp working.
            if api_info:
                 raise HTTPException(status_code=400, detail=f"Metadata fetched via API, but streaming links are blocked: {str(e)}")
            raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/info")
def fetch_info(req: VideoRequest):
    return get_video_info(req.url)

@app.post("/api/search")
def search_videos(req: SearchRequest):
    client = get_youtube_client()
    if not client:
        raise HTTPException(status_code=400, detail="YouTube API Key not configured.")
    
    try:
        request = client.search().list(
            part="snippet",
            maxResults=10,
            q=req.query,
            type="video"
        )
        response = request.execute()
        
        results = []
        for item in response.get('items', []):
            results.append({
                "id": item['id']['videoId'],
                "title": item['snippet']['title'],
                "thumbnail": item['snippet']['thumbnails']['high']['url'],
                "url": f"https://www.youtube.com/watch?v={item['id']['videoId']}"
            })
        return results
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/download")
async def download_video(url: str, format_id: str):
    ydl_opts = {
        'quiet': True,
        'no_warnings': True,
        'noplaylist': True,
        'youtube_include_dash_manifest': False, # Prefer direct progressive links
        'source_address': '0.0.0.0', # Force IPv4 which sometimes helps with YouTube IP blocklists
        'nocheckcertificate': True,
        'geo_bypass': True,
        'http_headers': {
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1',
        },
        'extractor_args': {
            'youtube': ['client=ios', 'player_client=ios'] # Mask server as iOS mobile
        }
    }
    
    if os.path.exists("cookies.txt"):
        ydl_opts['cookiefile'] = "cookies.txt"
    
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            
            target_format = next((f for f in info.get('formats', []) if f.get('format_id') == format_id), None)
            
            if not target_format:
                raise HTTPException(status_code=400, detail="Format not found")
                
            video_url = target_format['url']
            ext = target_format.get('ext', 'mp4')
            title = info.get('title', 'Video')
            
            # Clean title for filename to avoid issues
            safe_title = "".join([c for c in title if c.isalpha() or c.isdigit() or c in (' ', '-', '_')]).strip()
            if not safe_title:
                safe_title = "Downloaded_Video"
            filename = f"{safe_title}.{ext}"
            
            # Stream directly using proxy to bypass IP blocks (403 Forbidden). 
            # We use a small 64KB chunk size to prevent memory overload on Railway.
            async def proxy_stream():
                async with httpx.AsyncClient(timeout=None) as client:
                    async with client.stream("GET", video_url, headers={"User-Agent": "Mozilla/5.0"}) as response:
                        if response.status_code != 200:
                            yield b"Error fetching stream. YouTube might be blocking the server."
                            return
                        async for chunk in response.aiter_bytes(chunk_size=65536):
                            yield chunk
                            
            headers = {
                'Content-Disposition': f'attachment; filename="{quote(filename)}"',
                'Content-Type': 'application/octet-stream',
            }
            
            # Pass content length so the browser shows an active progress bar like Snaptube!
            filesize = target_format.get('filesize') or target_format.get('filesize_approx')
            if filesize:
                headers['Content-Length'] = str(filesize)
                
            return StreamingResponse(proxy_stream(), headers=headers)
            
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

# Serve React static files if they exist
if os.path.isdir("static"):
    app.mount("/assets", StaticFiles(directory="static/assets"), name="assets")
    
    @app.get("/{full_path:path}")
    async def serve_frontend(full_path: str):
        filepath = os.path.join("static", full_path)
        if os.path.exists(filepath) and os.path.isfile(filepath):
            return FileResponse(filepath)
        return FileResponse("static/index.html")

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
