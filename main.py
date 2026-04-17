from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse, StreamingResponse, RedirectResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
import yt_dlp
import asyncio
import os
import httpx
from urllib.parse import quote
from io import BytesIO

app = FastAPI(title="YouTube Downloader API")

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

def get_video_info(url: str):
    ydl_opts = {
        'quiet': True,
        'no_warnings': True,
        'extract_flat': False,
        'noplaylist': True,
        # Sometimes setting a generic header helps slightly with rate limits
        'http_headers': {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36',
        }
    }
    
    # Enable cookie usage if the user uploaded cookies.txt to bypass YouTube bot protection
    if os.path.exists("cookies.txt"):
        ydl_opts['cookiefile'] = "cookies.txt"

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
            
            # Simple deduplication
            unique_formats = {f['resolution']: f for f in formats}.values()
            
            return {
                "title": info.get('title'),
                "thumbnail": info.get('thumbnail'),
                "duration": info.get('duration'),
                "formats": sorted(unique_formats, key=lambda x: x.get('filesize', 0), reverse=True)
            }
        except Exception as e:
            raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/info")
def fetch_info(req: VideoRequest):
    return get_video_info(req.url)

@app.get("/api/download")
async def download_video(url: str, format_id: str):
    # Streaming the video through the FastAPI server proxy is MANDATORY for mobile.
    # YouTube ties the download URL to the IP address of the machine that requested it.
    # If the Railway server requests the URL, and we send it to the mobile phone,
    # the mobile phone has a different IP and gets a 403 FORBIDDEN error.
    ydl_opts = {
        'quiet': True,
        'no_warnings': True,
        'noplaylist': True,
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

            # We cleanly proxy the stream from YouTube to the client
            # This consumes server bandwidth but bypasses YouTube's IP lock limit entirely!
            async def proxy_stream():
                async with httpx.AsyncClient(timeout=None) as client:
                    async with client.stream("GET", video_url, headers={"User-Agent": "Mozilla/5.0"}) as response:
                        if response.status_code != 200:
                            yield b"Error fetching stream"
                            return
                        async for chunk in response.aiter_bytes(chunk_size=2048 * 2048): # Larger chunk size
                            yield chunk
                            
            headers = {
                'Content-Disposition': f'attachment; filename="{quote(filename)}"',
                'Content-Type': 'application/octet-stream'
            }
            
            return StreamingResponse(proxy_stream(), headers=headers, media_type="application/octet-stream")
            
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
