import React, { useState, useEffect } from 'react';
import { db, collection, getDocs, query, orderBy, limit, doc, getDoc, setDoc, handleFirestoreError, OperationType } from '../firebase';
import { motion } from 'motion/react';
import { Users, History, ArrowLeft, Loader2, Search, ExternalLink, Settings, ShieldCheck, Save, RefreshCw } from 'lucide-react';

interface UserData {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string;
  createdAt: any;
}

interface SearchEntry {
  userId: string;
  userEmail: string;
  query: string;
  timestamp: any;
  type: string;
}

export default function AdminPanel({ onBack }: { onBack: () => void }) {
  const [users, setUsers] = useState<UserData[]>([]);
  const [recentSearches, setRecentSearches] = useState<SearchEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'users' | 'history' | 'settings'>('users');
  const [ytApiKey, setYtApiKey] = useState('');
  const [savingSettings, setSavingSettings] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        // Fetch Users
        let usersSnapshot;
        try {
          usersSnapshot = await getDocs(collection(db, 'users'));
        } catch (e) {
          handleFirestoreError(e, OperationType.LIST, 'users');
          return;
        }
        
        const usersList = usersSnapshot.docs.map(doc => doc.data() as UserData);
        setUsers(usersList);

        // Fetch Global Config
        try {
          const configDoc = await getDoc(doc(db, 'config', 'youtube'));
          if (configDoc.exists()) {
            setYtApiKey(configDoc.data().apiKey || '');
          }
        } catch (e) {
          handleFirestoreError(e, OperationType.GET, 'config/youtube');
        }

        // Fetch Recent Searches
        const allSearches: SearchEntry[] = [];
        for (const userDoc of usersSnapshot.docs) {
          try {
            const searchesSnapshot = await getDocs(
              query(collection(db, 'users', userDoc.id, 'searches'), orderBy('timestamp', 'desc'), limit(5))
            );
            searchesSnapshot.forEach(sDoc => {
              allSearches.push({
                userId: userDoc.id,
                userEmail: userDoc.data().email,
                ...sDoc.data()
              } as SearchEntry);
            });
          } catch (e) {
            // Log sub-collection error but don't break the whole panel
            console.warn(`Could not fetch searches for user ${userDoc.id}:`, e);
          }
        }
        setRecentSearches(allSearches.sort((a, b) => b.timestamp?.seconds - a.timestamp?.seconds).slice(0, 50));
      } catch (err) {
        console.error("Critical Admin Panel Error:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  const handleSaveSettings = async () => {
    setSavingSettings(true);
    setSaveStatus(null);
    try {
      await setDoc(doc(db, 'config', 'youtube'), {
        apiKey: ytApiKey,
        updatedAt: new Date(),
      }, { merge: true });
      setSaveStatus('success');
      setTimeout(() => setSaveStatus(null), 3000);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'config/youtube');
      setSaveStatus('error');
    } finally {
      setSavingSettings(false);
    }
  };

  return (
    <div className="w-full max-w-5xl mx-auto space-y-8 bg-[#0a0a0a] min-h-[70vh] rounded-3xl p-8 border border-white/10 shadow-2xl relative z-10">
      <div className="flex items-center justify-between">
        <button 
          onClick={onBack}
          className="flex items-center gap-2 text-white/60 hover:text-white transition-colors group"
        >
          <ArrowLeft className="w-5 h-5 group-hover:-translate-x-1 transition-transform" />
          <span>Back to App</span>
        </button>
        <div className="flex bg-[#121212] p-1 rounded-xl border border-white/5">
          <button 
            onClick={() => setActiveTab('users')}
            className={`px-6 py-2 rounded-lg transition-all flex items-center gap-2 ${activeTab === 'users' ? 'bg-[#FF3D00] text-white shadow-lg' : 'text-white/40 hover:text-white/60'}`}
          >
            <Users className="w-4 h-4" />
            <span>Users ({users.length})</span>
          </button>
          <button 
            onClick={() => setActiveTab('history')}
            className={`px-6 py-2 rounded-lg transition-all flex items-center gap-2 ${activeTab === 'history' ? 'bg-[#FF3D00] text-white shadow-lg' : 'text-white/40 hover:text-white/60'}`}
          >
            <History className="w-4 h-4" />
            <span>Global History</span>
          </button>
          <button 
            onClick={() => setActiveTab('settings')}
            className={`px-6 py-2 rounded-lg transition-all flex items-center gap-2 ${activeTab === 'settings' ? 'bg-[#FF3D00] text-white shadow-lg' : 'text-white/40 hover:text-white/60'}`}
          >
            <Settings className="w-4 h-4" />
            <span>Settings</span>
          </button>
        </div>
      </div>

      <div className="space-y-6">
        <h2 className="text-3xl font-bold">
          {activeTab === 'users' ? 'User Management' : activeTab === 'history' ? 'Recent Search Activity' : 'System Settings'}
        </h2>

        {loading ? (
          <div className="h-64 flex items-center justify-center">
            <Loader2 className="w-10 h-10 text-[#FF3D00] animate-spin" />
          </div>
        ) : activeTab === 'users' ? (
          <div className="grid gap-4">
            {users.map(u => (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                key={u.uid}
                className="bg-[#121212] border border-white/5 p-4 rounded-2xl flex items-center justify-between hover:border-white/20 transition-all"
              >
                <div className="flex items-center gap-4">
                  <img src={u.photoURL} alt="" className="w-12 h-12 rounded-full border border-white/10" />
                  <div>
                    <div className="font-bold text-lg">{u.displayName}</div>
                    <div className="text-white/40 text-sm">{u.email}</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[12px] text-white/30 uppercase tracking-wider">Joined</div>
                  <div className="text-sm font-mono">{u.createdAt?.toDate ? u.createdAt.toDate().toLocaleDateString() : 'Recent'}</div>
                </div>
              </motion.div>
            ))}
          </div>
        ) : activeTab === 'history' ? (
          <div className="overflow-hidden rounded-2xl border border-white/5">
            <table className="w-full text-left border-collapse">
              <thead className="bg-[#121212] border-b border-white/5">
                <tr>
                  <th className="p-4 text-sm font-semibold text-white/40">User</th>
                  <th className="p-4 text-sm font-semibold text-white/40">Query / URL</th>
                  <th className="p-4 text-sm font-semibold text-white/40">Type</th>
                  <th className="p-4 text-sm font-semibold text-white/40">Time</th>
                </tr>
              </thead>
              <tbody className="bg-[#0k0k0k]">
                {recentSearches.map((s, idx) => (
                  <tr key={idx} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                    <td className="p-4">
                      <div className="text-sm font-medium">{s.userEmail}</div>
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-2 max-w-md">
                        <span className="truncate block font-mono text-[13px]">{s.query}</span>
                        {s.type === 'url' && (
                          <a href={s.query} target="_blank" rel="noreferrer" className="text-[#FF3D00] hover:text-[#FF3D00]/80">
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </div>
                    </td>
                    <td className="p-4">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase ${s.type === 'search' ? 'bg-blue-500/10 text-blue-400' : 'bg-green-500/10 text-green-400'}`}>
                        {s.type}
                      </span>
                    </td>
                    <td className="p-4 text-sm text-white/40">
                      {s.timestamp?.toDate ? s.timestamp.toDate().toLocaleString() : 'Just now'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-[#121212] border border-white/5 rounded-3xl p-8 max-w-2xl mx-auto space-y-8"
          >
            <div className="flex items-center gap-4 mb-2">
              <div className="w-12 h-12 rounded-2xl bg-[#FF3D00]/10 flex items-center justify-center text-[#FF3D00]">
                <ShieldCheck className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-xl font-bold">YouTube API Configuration</h3>
                <p className="text-white/40 text-sm">Control the primary data source for searches</p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-semibold text-white/60 pl-1">Current API Key</label>
                <div className="relative group">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/20 group-focus-within:text-[#FF3D00] transition-colors" />
                  <input 
                    type="password"
                    value={ytApiKey}
                    onChange={(e) => setYtApiKey(e.target.value)}
                    placeholder="Enter your YouTube Data API Key..."
                    className="w-full bg-white/[0.03] border border-white/10 rounded-xl h-14 pl-12 pr-4 text-white outline-none focus:border-[#FF3D00]/50 transition-all font-mono text-[14px]"
                  />
                </div>
                <p className="text-[11px] text-white/30 pl-1">
                  If this key is invalid or reaches quota, the system will fallback to the default internal key.
                </p>
              </div>

              <div className="pt-4 flex items-center gap-4">
                <button 
                  onClick={handleSaveSettings}
                  disabled={savingSettings}
                  className="flex-1 bg-[#FF3D00] hover:bg-[#FF3D00]/90 text-white font-bold h-14 rounded-xl shadow-lg shadow-[#FF3D00]/20 flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-50"
                >
                  {savingSettings ? (
                    <RefreshCw className="w-5 h-5 animate-spin" />
                  ) : (
                    <>
                      <Save className="w-5 h-5" />
                      <span>Save Config</span>
                    </>
                  )}
                </button>
                {saveStatus === 'success' && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-green-500 font-bold text-sm">✓ Saved</motion.div>
                )}
                {saveStatus === 'error' && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-red-500 font-bold text-sm">✗ Error</motion.div>
                )}
              </div>
            </div>

            <div className="bg-white/5 p-5 rounded-2xl space-y-3">
              <h4 className="text-sm font-bold text-white/80">Security Notice</h4>
              <ul className="text-[12px] text-white/40 list-disc pl-4 space-y-1">
                <li>Changes are applied immediately to all user searches.</li>
                <li>The back-end automatically reloads configuration on each request.</li>
                <li>Make sure to restrict your key in the Google Cloud Console to only YouTube Data API v3.</li>
              </ul>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}
