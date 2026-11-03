import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Download, Lock, ShieldX, Clock, FileText } from 'lucide-react';
import {
  api, API_BASE, errorMessage, formatBytes,
  type UnlockResponse, type TicketResponse,
} from '../api';

// Live countdown to the expiry time, updated every second
function useCountdown(target?: string) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  if (!target) return { ms: 0, label: '' };
  const ms = Math.max(0, new Date(target).getTime() - now);
  const pad = (n: number) => String(n).padStart(2, '0');
  const h = Math.floor(ms / 3600000);
  const m = Math.floor(ms / 60000) % 60;
  const s = Math.floor(ms / 1000) % 60;
  return { ms, label: `${h}:${pad(m)}:${pad(s)}` };
}

export default function VaultPage() {
  const { token } = useParams();
  const [passkey, setPasskey] = useState('');
  const [info, setInfo] = useState<UnlockResponse | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const autoUnlocked = useRef(false); // makes sure we unlock only once per visit
  const countdown = useCountdown(info?.expiresAt);

  // Step 1: does this link exist, and does it need a passkey?
  const status = useQuery({
    queryKey: ['status', token],
    queryFn: async () =>
      (await api.get(`/vault/${token}/status`)).data as { requiresPassword: boolean },
    retry: false,
  });

  // Step 2: unlock (with or without passkey)
  const unlock = useMutation({
    mutationFn: async (pk?: string) =>
      (await api.post<UnlockResponse>(`/vault/${token}/unlock`, pk ? { passkey: pk } : {})).data,
    onSuccess: (data) => {
      setInfo(data);
      setPasskey('');   // don't keep the passkey in memory
      setError('');
    },
    onError: (e: any) => {
      const code = e?.response?.status;
      if (code === 429) setError('Too many attempts. Try again in 15 minutes.');
      else if (code === 404) setError('This link has expired or been destroyed.');
      else setError(errorMessage(e));
    },
  });

  // No passkey needed → unlock automatically, once
  useEffect(() => {
    if (status.data && !status.data.requiresPassword && !autoUnlocked.current) {
      autoUnlocked.current = true;
      unlock.mutate(undefined);
    }
  }, [status.data]);

  // Step 3: get a fresh ticket via the unlock session, then download
  const download = useMutation({
    mutationFn: async () =>
      (await api.post<TicketResponse>(`/vault/${token}/ticket`, {
        unlockSession: info!.unlockSession,
      })).data,
    onSuccess: (t) => {
      window.location.href = `${API_BASE}/vault/${token}/download?ticket=${t.downloadTicket}`;
      const left = t.downloadsRemaining - 1;
      setInfo((prev) => prev && { ...prev, downloadsRemaining: left });
      setNotice(
        left > 0
          ? 'Download started.'
          : 'Download started. That was the last one, so the file will now self-destruct.'
      );
    },
    onError: (e: any) => {
      if (e?.response?.status === 403) {
        // Session expired (or file used up): go back to unlocking
        setInfo(null);
        if (status.data?.requiresPassword) setError('Session expired. Please enter the passkey again.');
        else unlock.mutate(undefined);
      } else {
        setError(errorMessage(e));
      }
    },
  });

  // ---------- Screens ----------

  if (status.isLoading) return <p className="text-center text-slate-400">Checking link…</p>;

  if (status.isError) {
    return (
      <div className="bg-slate-900 rounded-2xl p-6 text-center space-y-2 shadow-xl">
        <ShieldX className="mx-auto text-red-400" size={40} />
        <h2 className="text-xl font-semibold">This link has expired or been destroyed</h2>
        <p className="text-sm text-slate-400">Ask the sender for a new link.</p>
      </div>
    );
  }

  // Locked: passkey form (or "opening…" for links without a passkey)
  if (!info) {
    if (!status.data?.requiresPassword) {
      return (
        <p className="text-center text-slate-400">
          {error || 'Opening file…'}
        </p>
      );
    }
    return (
      <form
        onSubmit={(e) => { e.preventDefault(); unlock.mutate(passkey); }}
        className="bg-slate-900 rounded-2xl p-6 space-y-4 shadow-xl"
      >
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <Lock size={20} /> This file is protected
        </h2>
        <input
          type="password"
          autoFocus
          placeholder="Enter passkey"
          value={passkey}
          onChange={(e) => setPasskey(e.target.value)}
          className="w-full bg-slate-800 rounded-lg p-2"
        />
        {error && <p className="text-red-400 text-sm">{error}</p>}
        <button
          disabled={!passkey || unlock.isPending}
          className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 rounded-lg p-3 font-medium"
        >
          {unlock.isPending ? 'Checking…' : 'Unlock'}
        </button>
      </form>
    );
  }

  // Countdown reached zero while the page was open
  if (countdown.ms === 0) {
    return (
      <div className="bg-slate-900 rounded-2xl p-6 text-center space-y-2 shadow-xl">
        <Clock className="mx-auto text-red-400" size={40} />
        <h2 className="text-xl font-semibold">Time's up, this file has self-destructed</h2>
      </div>
    );
  }

  // Unlocked: file details + download
  const usedUp = info.downloadsRemaining <= 0;

  return (
    <div className="bg-slate-900 rounded-2xl p-6 space-y-4 shadow-xl">
      <h2 className="text-xl font-semibold flex items-center gap-2 break-all">
        <FileText size={20} className="shrink-0" /> {info.fileName}
      </h2>

      <div className="grid grid-cols-3 gap-2 text-sm text-center">
        <div className="bg-slate-800 rounded-lg p-2">
          {formatBytes(info.sizeBytes)}
          <div className="text-slate-400 text-xs">size</div>
        </div>
        <div className="bg-slate-800 rounded-lg p-2 font-mono">
          {countdown.label}
          <div className="text-slate-400 text-xs font-sans">until purge</div>
        </div>
        <div className="bg-slate-800 rounded-lg p-2">
          {Math.max(0, info.downloadsRemaining)}
          <div className="text-slate-400 text-xs">downloads left</div>
        </div>
      </div>

      {notice && <p className="text-emerald-400 text-sm text-center">{notice}</p>}
      {error && <p className="text-red-400 text-sm text-center">{error}</p>}

      {!usedUp && (
        <button
          onClick={() => { setError(''); download.mutate(); }}
          disabled={download.isPending}
          className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 rounded-lg p-3 font-medium flex items-center justify-center gap-2"
        >
          <Download size={18} /> {download.isPending ? 'Preparing…' : 'Download'}
        </button>
      )}
    </div>
  );
}