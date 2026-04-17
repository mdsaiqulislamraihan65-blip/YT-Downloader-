import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Youtube, Search, Download, Loader2, Video, Music, CheckCircle2, AlertCircle, X } from 'lucide-react';
import { cn } from './lib/utils';
import axios from 'axios';

interface VideoFormat {
  format_id: string;
  ext: string;
  resolution: string;
  filesize: number;
  type: 'video' | 'audio';
}

interface VideoInfo {
  title: string;
  thumbnail: string;
  duration: number;
  formats: VideoFormat[];
}

function formatBytes(bytes: number, decimals = 2) {
  if (!+bytes) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

function formatDuration(seconds: number) {
  if (!seconds) return '00:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return [h, m > 9 ? m : h ? '0' + m : m || '0', s > 9 ? s : '0' + s]
    .filter(Boolean)
    .join(':');
}

export default function App() {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);
  const [downloadingFormat, setDownloadingFormat] = useState<string | null>(null);
  const [modalUrl, setModalUrl] = useState<string | null>(null);
  const [modalFormat, setModalFormat] = useState<VideoFormat | null>(null);

  const fetchInfo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;

    setLoading(true);
    setError(null);
    setVideoInfo(null);

    try {
      // Trying to hit the FastAPI backend
      const response = await axios.post('/api/info', { url });
      setVideoInfo(response.data);
    } catch (err: any) {
      console.error(err);
      
      // If we received an error response from the Python backend (e.g. yt-dlp error)
      if (err.response?.data?.detail) {
         setError(err.response.data.detail);
         setLoading(false);
         return;
      }
      
      // For ALL other errors (Network Error, 502 Bad Gateway, 500 Internal Server Error)
      // just display the raw error so we know EXACTLY what's wrong on Railway.
      const errorMsg = err.response?.status 
        ? `Server Error ${err.response.status}: Railway backend crashed or is restarting.` 
        : `Network Error: ${err.message}. Backend might be offline.`;
        
      setError(errorMsg);
      setLoading(false);
      return;
    }
    
    setLoading(false);
  };

  const handleDownload = async (format: VideoFormat) => {
    setDownloadingFormat(format.format_id);

    try {
       const response = await axios.get(`/api/download?url=${encodeURIComponent(url)}&format_id=${format.format_id}`);
       if (response.data.download_url) {
           setModalUrl(response.data.download_url);
           setModalFormat(format);
       }
    } catch (err: any) {
       console.error(err);
       setError("Error generating direct link. Railway backend might be offline.");
    } finally {
       setDownloadingFormat(null);
    }
  };

  return (
    <div className="min-h-screen bg-[#050505] text-white flex flex-col items-center py-16 px-4 font-sans selection:bg-[#FF3D00]/30 relative overflow-hidden">
      
      {/* Background gradients */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-[radial-gradient(circle,rgba(255,61,0,0.1)_0%,transparent_70%)] rounded-full" />
      </div>

      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-4xl z-10 space-y-12"
      >
        {/* Header */}
        <div className="text-center space-y-4">
          <motion.div 
            initial={{ scale: 0.9 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", bounce: 0.5 }}
            className="inline-flex items-center justify-center p-3 rounded-2xl bg-[#121212] border border-white/10 mb-4 shadow-[0_0_20px_rgba(255,61,0,0.1)]"
          >
            <Youtube className="w-10 h-10 text-[#FF3D00]" />
          </motion.div>
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight">
            YT Downloader <span className="text-[#FF3D00]">Pro</span>
          </h1>
          <p className="text-white/60 text-lg max-w-xl mx-auto font-medium">
            Download your favorite videos in ultra-high quality. 
            Powered by Python FastAPI.
          </p>
        </div>

        {/* Input form */}
        <form onSubmit={fetchInfo} className="relative w-full max-w-[800px] mx-auto">
          <div className="relative flex items-center bg-[#121212] border border-white/10 rounded-xl overflow-hidden focus-within:border-white/20 transition-colors">
            <div className="pl-6 pr-3 text-white/60">
              <Search className="w-5 h-5" />
            </div>
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Paste YouTube video URL here..."
              className="w-full h-[64px] bg-transparent pb-0 pr-[140px] text-white outline-none placeholder:text-white/60 font-medium disabled:opacity-50 text-[16px]"
              disabled={loading}
              required
            />
            <button
              type="submit"
              disabled={loading}
              className="absolute right-2 top-2 h-[48px] bg-[#FF3D00] hover:bg-[#FF3D00]/90 text-white font-bold rounded-lg px-6 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 uppercase text-[13px] tracking-[0.5px]"
            >
              {loading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>Fetching</span>
                </>
              ) : (
                <span>Analyze Link</span>
              )}
            </button>
          </div>
        </form>

        {error && (
          <motion.div 
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="bg-red-500/10 border border-red-500/20 text-red-200/80 rounded-xl p-4 flex items-start gap-3 backdrop-blur-sm mx-auto w-full max-w-[800px]"
          >
            <AlertCircle className="w-5 h-5 mt-0.5 shrink-0 text-red-500" />
            <div className="text-sm break-words overflow-hidden text-left w-full">
              <strong className="text-red-500 block mb-1">Backend Error:</strong> 
              <span className="opacity-90">{error}</span>
              {(error.includes("Sign in") || error.includes("bot") || error.includes("unavailable")) && (
                <div className="mt-3 p-3 bg-black/40 rounded-lg text-white/80 border border-white/5">
                  <strong className="text-yellow-500">Notice:</strong> YouTube blocks Cloud/VPS IP addresses (like Railway). To fix this on your live server, you need to configure <code className="bg-black/50 px-1 py-0.5 rounded text-yellow-300">yt-dlp</code> with cookies or an IP rotation.
                </div>
              )}
            </div>
          </motion.div>
        )}

        {/* Results */}
        <AnimatePresence mode="wait">
          {videoInfo && (
            <motion.div
              layout
              initial={{ opacity: 0, y: 30, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -20, scale: 0.95 }}
              transition={{ type: "spring", bounce: 0.4 }}
              className="grid md:grid-cols-[1fr_320px] gap-10 items-start w-full"
            >
              
              {/* Thumbnail Side */}
              <div className="bg-[#121212] border border-white/10 rounded-[20px] p-6 flex flex-col gap-5">
                <div className="relative aspect-video rounded-xl overflow-hidden bg-[#1a1a1a] shadow-inner flex items-center justify-center group">
                  <img 
                    src={videoInfo.thumbnail} 
                    alt="Thumbnail" 
                    className="w-full h-full object-cover opacity-80 transition-transform duration-500 group-hover:scale-105 group-hover:opacity-100"
                    referrerPolicy="no-referrer"
                  />
                  <div className="absolute bottom-3 right-3 bg-black/80 px-2 py-1 rounded text-xs font-semibold text-white">
                    {formatDuration(videoInfo.duration)}
                  </div>
                </div>
                <div>
                  <h2 className="text-[20px] font-semibold leading-snug mb-2">
                    {videoInfo.title}
                  </h2>
                  <p className="text-white/60 text-[14px]">
                    {videoInfo.formats.length} processing formats found
                  </p>
                </div>
              </div>

              {/* Formats Side */}
              <div className="flex flex-col gap-4">
                <div className="flex flex-col">
                  <div className="text-[12px] uppercase tracking-[1px] text-white/60 mb-2 font-medium">Select Quality</div>
                  
                  <div className="flex flex-col gap-2 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                    {videoInfo.formats.map((format, idx) => (
                      <motion.div 
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: idx * 0.05 }}
                        key={idx}
                        className={cn(
                          "p-3 px-4 rounded-xl flex justify-between items-center transition-all cursor-pointer",
                          downloadingFormat === format.format_id 
                            ? "bg-[#FF3D00]/5 border border-[#FF3D00]" 
                            : "bg-white/[0.03] border border-white/10 hover:bg-white/[0.06]"
                        )}
                      >
                        <div className="flex items-center gap-3">
                          <div className={cn(
                            "w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border border-white/5",
                            format.type === 'video' ? 'bg-white/5 text-white/80' : 'bg-white/5 text-white/80'
                          )}>
                            {format.type === 'video' ? <Video className="w-4 h-4" /> : <Music className="w-4 h-4" />}
                          </div>
                          <div>
                            <div className="font-semibold text-[14px]">{format.resolution}</div>
                            <div className="text-[12px] text-white/60 mt-0.5">
                              {format.ext.toUpperCase()} • {formatBytes(format.filesize)}
                            </div>
                          </div>
                        </div>
                        
                        <button
                          onClick={() => handleDownload(format)}
                          disabled={downloadingFormat === format.format_id}
                          className={cn(
                            "w-10 h-10 rounded-lg flex items-center justify-center transition-colors disabled:opacity-50",
                            downloadingFormat === format.format_id 
                              ? "text-[#FF3D00]" 
                              : "text-white/60 hover:text-white hover:bg-white/10"
                          )}
                          title="Download"
                        >
                          {downloadingFormat === format.format_id ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Download className="w-4 h-4" />
                          )}
                        </button>
                      </motion.div>
                    ))}
                  </div>
                </div>
              </div>

            </motion.div>
          )}
        </AnimatePresence>

        {/* Video Player Modal */}
        <AnimatePresence>
          {modalUrl && modalFormat && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4 backdrop-blur-sm"
            >
              <motion.div 
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                className="bg-[#121212] border border-white/10 rounded-2xl w-full max-w-3xl overflow-hidden flex flex-col shadow-[0_0_50px_rgba(255,61,0,0.1)]"
              >
                <div className="p-4 border-b border-white/5 flex justify-between items-center bg-black/40">
                  <h3 className="font-semibold text-lg flex items-center gap-2">
                    {modalFormat.type === 'video' ? <Video className="w-5 h-5 text-[#FF3D00]" /> : <Music className="w-5 h-5 text-[#FF3D00]" />}
                    {modalFormat.resolution} Quality
                  </h3>
                  <button 
                    onClick={() => {
                        setModalUrl(null);
                        setModalFormat(null);
                    }} 
                    className="text-white/60 hover:text-white bg-white/5 hover:bg-white/10 rounded-lg w-8 h-8 flex items-center justify-center transition-colors"
                  >
                     <X className="w-5 h-5" />
                  </button>
                </div>
                
                <div className="bg-black/60 aspect-video w-full flex items-center justify-center relative">
                   {modalFormat.type === 'video' ? (
                      <video src={modalUrl} controls autoPlay className="w-full h-full object-contain outline-none" />
                   ) : (
                      <audio src={modalUrl} controls autoPlay className="w-full mx-8" />
                   )}
                </div>

                <div className="p-5 flex flex-col sm:flex-row gap-4 justify-between items-center bg-black/40">
                   <p className="text-white/50 text-sm">
                      Video playing directly from YouTube. If it freezes, click download.
                   </p>
                   <button 
                     onClick={() => {
                        const a = document.createElement('a');
                        a.href = modalUrl;
                        a.target = "_blank";
                        a.download = `video_${modalFormat.resolution}.${modalFormat.ext}`;
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                     }}
                     className="bg-[#FF3D00] hover:bg-[#FF3D00]/90 text-white font-bold py-3 px-6 rounded-xl flex items-center justify-center gap-2 transition-all w-full sm:w-auto"
                   >
                     <Download className="w-5 h-5" />
                     Save to Device
                   </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

      </motion.div>
    </div>
  );
}
