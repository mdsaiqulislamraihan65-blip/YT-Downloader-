from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
import yt_dlp
import asyncio
import os
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
    }
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
def download_video(url: str, format_id: str):
    # This is a basic implementation for downloading.
    # In a production environment on Railway, you'd stream directly or save to a temp folder.
    ydl_opts = {
        'format': format_id,
        'quiet': True,
        'outtmpl': '-',
        'logtostderr': True
    }
    
    # We would use a subprocess or streaming response here to pipe to the user
    # Returning redirect to the actual URL works best for some formats without consuming server bandwidth
    
    with yt_dlp.YoutubeDL({'quiet': True}) as ydl:
        info = ydl.extract_info(url, download=False)
        for f in info['formats']:
            if f['format_id'] == format_id:
                return {"download_url": f['url']}
                
    raise HTTPException(status_code=400, detail="Format not found")

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
