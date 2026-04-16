# Build Frontend
FROM node:18-alpine AS frontend
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# Build Backend
FROM python:3.10-slim
WORKDIR /app

# Install system dependencies (ffmpeg is needed for yt-dlp to merge formats)
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

# Install python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend files
COPY main.py .

# Copy built frontend
COPY --from=frontend /app/dist /app/static

# Modify FastAPI to serve static files
RUN pip install aiofiles
RUN echo '\nfrom fastapi.staticfiles import StaticFiles\napp.mount("/", StaticFiles(directory="static", html=True), name="static")' >> main.py

EXPOSE $PORT

CMD uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}
