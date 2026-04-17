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
import random
import socket
import struct

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

def get_random_headers():
    # Randomize User Agents so YouTube doesn't flag a single signature
    agents = [
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0",
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1"
    ]
    
    # Generate a random public IPv4 to inject as X-Forwarded-For
    random_ip = socket.inet_ntoa(struct.pack('>I', random.randint(1, 0xffffffff)))
    
    return {
        'User-Agent': random.choice(agents),
        'X-Forwarded-For': random_ip,
        'Client-IP': random_ip,
        'Via': f'1.1 {random_ip}',
    }

def get_base_ydl_opts():
    headers = get_random_headers()
    return {
        'quiet': True,
        'no_warnings': True,
        'noplaylist': True,
        'source_address': '0.0.0.0', # Force IPv4 which is better for bypassing blocks
        'http_headers': headers,
        'nocheckcertificate': True,
        'geo_bypass': True,
        'extractor_args': {
            'youtube': {
                'player_client': ['ios', 'web', 'mweb'], # Specific order
                'player_skip': ['configs', 'webpage']
            }
        }
    }

def get_video_info(url: str):
    ydl_opts = get_base_ydl_opts()
    ydl_opts['extract_flat'] = False
    
    # Enable cookie usage if the user uploaded cookies.txt
    if os.path.exists("cookies.txt"):
        ydl_opts['cookiefile'] = "cookies.txt"

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        try:
            info = ydl.extract_info(url, download=False)
            if not info:
                raise HTTPException(status_code=400, detail="YouTube returned no data. Bot detection active.")
                
            formats = []
            info_formats = info.get('formats', [])
            if not info_formats:
                 # Fallback if formats list is empty
                 raise HTTPException(status_code=400, detail="No downloadable formats found for this video. YouTube may be blocking this server's IP.")

            for f in info_formats:
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
            error_str = str(e)
            if "confirm you're not a bot" in error_str:
                raise HTTPException(status_code=400, detail="YouTube Bot Block: Cookies might be expired or the server IP is blacklisted. Try refreshing cookies.")
            raise HTTPException(status_code=400, detail=error_str)

@app.post("/api/info")
def fetch_info(req: VideoRequest):
    return get_video_info(req.url)

@app.get("/api/download")
async def download_video(url: str, format_id: str):
    ydl_opts = get_base_ydl_opts()
    
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
            
            # Use random headers for proxying stream
            stream_headers = get_random_headers()
            
            # Stream directly using proxy to bypass IP blocks (403 Forbidden). 
            # We use a small 64KB chunk size to prevent memory overload on Railway.
            async def proxy_stream():
                async with httpx.AsyncClient(timeout=None) as client:
                    async with client.stream("GET", video_url, headers=stream_headers) as response:
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
