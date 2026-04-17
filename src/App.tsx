import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Youtube, Search, Download, Loader2, Video, Music, CheckCircle2, AlertCircle, LogIn, LogOut, History, User as UserIcon } from 'lucide-react';
import { cn } from './lib/utils';
import axios from 'axios';
import { auth, db, googleProvider, signInWithPopup, signOut, onAuthStateChanged, User, setDoc, doc, collection, addDoc, serverTimestamp } from './firebase';

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

interface SearchResult {
  id: string;
  title: string;
  thumbnail: string;
  url: string;
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
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);
  const [downloadingFormat, setDownloadingFormat] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      setAuthReady(true);
      if (currentUser) {
        // Sync user profile to Firestore
        await setDoc(doc(db, 'users', currentUser.uid), {
          uid: currentUser.uid,
          email: currentUser.email,
          displayName: currentUser.displayName,
          photoURL: currentUser.photoURL,
          createdAt: serverTimestamp(),
        }, { merge: true });
      }
    });
    return () => unsubscribe();
  }, []);

  const login = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err: any) {
      console.error(err);
      setError("Login failed: " + err.message);
    }
  };

  const logout = async () => {
    try {
      await signOut(auth);
      setVideoInfo(null);
      setSearchResults(null);
    } catch (err: any) {
      console.error(err);
    }
  };

  const logSearch = async (query: string, type: 'search' | 'url') => {
    if (user) {
      try {
        await addDoc(collection(db, 'users', user.uid, 'searches'), {
          query,
          type,
          timestamp: serverTimestamp(),
        });
      } catch (err) {
        console.error("Failed to log search:", err);
      }
    }
  };

  const fetchInfo = async (targetUrl: string) => {
    setLoading(true);
    setError(null);
    setVideoInfo(null);
    setSearchResults(null);

    try {
      const response = await axios.post('/api/info', { url: targetUrl });
      setVideoInfo(response.data);
      await logSearch(targetUrl, 'url');
    } catch (err: any) {
      console.error(err);
      if (err.response?.data?.detail) {
         setError(err.response.data.detail);
      } else {
        setError(err.response?.status 
          ? `Server Error ${err.response.status}: YouTube is blocking this lookup.` 
          : `Network Error: ${err.message}`);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;

    if (url.includes('youtube.com/') || url.includes('youtu.be/')) {
        await fetchInfo(url);
        return;
    }

    setLoading(true);
    setError(null);
    setVideoInfo(null);
    setSearchResults(null);

    try {
      const response = await axios.post('/api/search', { query: url });
      setSearchResults(response.data);
      await logSearch(url, 'search');
    } catch (err: any) {
      console.error(err);
      setError(err.response?.data?.detail || "Search failed. Check your API configuration.");
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async (format: VideoFormat, targetUrl: string) => {
    if (!user) {
      setError("Please login to download videos.");
      return;
    }
    setDownloadingFormat(format.format_id);
    const downloadUrl = `/api/download?url=${encodeURIComponent(targetUrl)}&format_id=${format.format_id}`;
    
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = `download_${format.resolution}.${format.ext}`; 
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    setTimeout(() => {
       setDownloadingFormat(null);
    }, 2500);
  };

  if (!authReady) {
    return (
      <div className="min-h-screen bg-[#050505] flex items-center justify-center">
        <Loader2 className="w-12 h-12 text-[#FF3D00] animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#050505] text-white flex flex-col items-center py-12 px-4 font-sans selection:bg-[#FF3D00]/30 relative overflow-hidden">
      
      {/* Auth Bar */}
      <div className="absolute top-6 right-6 z-50">
        {user ? (
          <div className="flex items-center gap-4 bg-[#121212] border border-white/10 p-2 pl-4 rounded-full shadow-lg backdrop-blur-md">
            <span className="text-sm font-medium text-white/80 hidden sm:inline">Hello, {user.displayName?.split(' ')[0]}</span>
            {user.photoURL ? (
              <img src={user.photoURL} alt="User" className="w-8 h-8 rounded-full border border-white/20" />
            ) : (
              <UserIcon className="w-8 h-8 p-1.5 rounded-full bg-white/10 text-white/50" />
            )}
            <button 
              onClick={logout}
              className="p-2 hover:bg-white/10 rounded-full transition-colors text-white/60 hover:text-white"
              title="Logout"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        ) : (
          <button 
            onClick={login}
            className="flex items-center gap-2 bg-[#FF3D00] hover:bg-[#FF3D00]/90 text-white font-bold py-2 px-5 rounded-full shadow-[0_0_20px_rgba(255,61,0,0.3)] transition-all active:scale-95"
          >
            <LogIn className="w-4 h-4" />
            <span>Login with Google</span>
          </button>
        )}
      </div>

      {/* Background gradients */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-[radial-gradient(circle,rgba(255,61,0,0.1)_0%,transparent_70%)] rounded-full" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-[radial-gradient(circle,rgba(255,61,0,0.05)_0%,transparent_70%)] rounded-full" />
      </div>

      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-4xl z-10 space-y-10"
      >
        {/* Header */}
        <div className="text-center space-y-4 pt-12">
          <motion.div 
            initial={{ scale: 0.9 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", bounce: 0.5 }}
            className="inline-flex items-center justify-center p-4 rounded-2xl bg-[#121212] border border-white/10 mb-2 shadow-[0_0_30px_rgba(255,61,0,0.15)] cursor-pointer"
            onClick={() => {
              setVideoInfo(null);
              setSearchResults(null);
              setUrl('');
              setError(null);
            }}
          >
            <Youtube className="w-12 h-12 text-[#FF3D00]" />
          </motion.div>
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight">
            YT Downloader <span className="text-[#FF3D00]">Pro</span>
          </h1>
          <p className="text-white/60 text-lg max-w-xl mx-auto font-medium">
            Personalized high-quality video downloads.
            <br />
            <span className="text-[14px] opacity-70">Powered by Firebase & Google API</span>
          </p>
        </div>

        {/* Search Bar */}
        <div className="space-y-4">
          <form onSubmit={handleSearch} className="relative w-full max-w-[800px] mx-auto group">
            <div className={cn(
               "relative flex items-center bg-[#121212] border rounded-2xl overflow-hidden transition-all duration-300 shadow-xl",
               loading ? "border-[#FF3D00]/50" : "border-white/10 focus-within:border-[#FF3D00]/40 focus-within:ring-1 focus-within:ring-[#FF3D00]/20"
            )}>
              <div className="pl-6 pr-3 text-white/40">
                <Search className="w-5 h-5 group-focus-within:text-[#FF3D00] transition-colors" />
              </div>
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="Search or paste link..."
                className="w-full h-[72px] bg-transparent pb-0 pr-[140px] text-white outline-none placeholder:text-white/40 font-medium disabled:opacity-50 text-[18px]"
                disabled={loading}
                required
              />
              <button
                type="submit"
                disabled={loading}
                className="absolute right-3 top-3 bottom-3 bg-[#FF3D00] hover:bg-[#FF3D00]/90 text-white font-bold rounded-xl px-8 transition-all duration-200 disabled:opacity-50 flex items-center justify-center gap-2 uppercase text-[14px] tracking-[1px]"
              >
                {loading ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <span>Go</span>
                )}
              </button>
            </div>
          </form>
          
          {!user && !loading && (
             <p className="text-center text-[12px] text-white/40 animate-pulse">
                Connect your account to enable history and downloads
             </p>
          )}
        </div>

        {error && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-[#C41E3A]/10 border border-[#C41E3A]/30 text-red-200/90 rounded-xl p-5 flex items-start gap-4 backdrop-blur-md mx-auto w-full max-w-[800px]"
          >
            <AlertCircle className="w-6 h-6 shrink-0 text-[#C41E3A]" />
            <div className="text-[14px] leading-relaxed">
              <strong className="text-[#C41E3A] block mb-1">Attention:</strong> 
              {error}
            </div>
          </motion.div>
        )}

        {/* Results Container */}
        <AnimatePresence mode="wait">
          {searchResults && (
            <motion.div
              layout
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="grid gap-4 w-full max-w-[800px] mx-auto"
            >
              <h3 className="text-white/60 text-sm font-semibold uppercase tracking-wider pl-1 underline decoration-[#FF3D00] underline-offset-8 decoration-2">Search Results</h3>
              <div className="grid sm:grid-cols-2 gap-4">
                {searchResults.map((result) => (
                  <motion.div
                    key={result.id}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => {
                        setUrl(result.url);
                        fetchInfo(result.url);
                    }}
                    className="bg-[#121212] border border-white/10 rounded-xl overflow-hidden cursor-pointer hover:border-white/20 transition-all flex flex-col group"
                  >
                    <div className="aspect-video relative overflow-hidden bg-black/20">
                      <img src={result.thumbnail} alt={result.title} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" referrerPolicy="no-referrer" />
                      <div className="absolute inset-0 bg-black/40 group-hover:bg-black/20 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                         <Download className="w-8 h-8 text-white" />
                      </div>
                    </div>
                    <div className="p-4">
                      <h4 className="font-semibold text-[14px] line-clamp-2 leading-tight h-[2.5rem] group-hover:text-[#FF3D00] transition-colors">
                        {result.title}
                      </h4>
                    </div>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          )}

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
                  {videoInfo.duration > 0 && (
                    <div className="absolute bottom-3 right-3 bg-black/80 px-2 py-1 rounded text-xs font-semibold text-white">
                      {formatDuration(videoInfo.duration)}
                    </div>
                  )}
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
                        onClick={() => handleDownload(format, url)}
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
                        
                        <div
                          className={cn(
                            "w-10 h-10 rounded-lg flex items-center justify-center transition-colors disabled:opacity-50",
                            downloadingFormat === format.format_id 
                              ? "text-[#FF3D00]" 
                              : "text-white/60 hover:text-white"
                          )}
                        >
                          {downloadingFormat === format.format_id ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Download className="w-4 h-4" />
                          )}
                        </div>
                      </motion.div>
                    ))}
                  </div>
                </div>
              </div>

            </motion.div>
          )}
        </AnimatePresence>

      </motion.div>
    </div>
  );
}
