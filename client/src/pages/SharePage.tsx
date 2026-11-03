import { useState } from 'react';
import { useLocation, Link, Navigate } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { Copy, Check, ShieldCheck, KeyRound } from 'lucide-react';
import type { UploadResponse } from '../api';

type ShareState = UploadResponse & { hasPasskey?: boolean };

export default function SharePage() {
  const state = useLocation().state as ShareState | null;
  const [copied, setCopied] = useState(false);

  // Opened /share directly without uploading → go back to the upload page
  if (!state) return <Navigate to="/" />;

  const link = `${window.location.origin}/vault/${state.shareToken}`;

  const copy = async () => {
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="bg-slate-900 rounded-2xl p-6 space-y-5 text-center shadow-xl">
      <ShieldCheck className="mx-auto text-emerald-400" size={40} />
      <h2 className="text-xl font-semibold">Your secure link is ready</h2>

      <div className="flex gap-2">
        <input
          readOnly
          value={link}
          onFocus={(e) => e.target.select()}
          className="flex-1 bg-slate-800 rounded-lg p-2 text-sm"
        />
        <button
          onClick={copy}
          className="bg-emerald-600 hover:bg-emerald-500 rounded-lg px-3 flex items-center gap-1 text-sm"
        >
          {copied ? <><Check size={16} /> Copied</> : <><Copy size={16} /> Copy</>}
        </button>
      </div>

      <div className="bg-white p-3 rounded-xl inline-block">
        <QRCodeSVG value={link} size={180} />
      </div>

      <p className="text-sm text-slate-400">
        Self-destructs at {new Date(state.expiresAt).toLocaleString()}
      </p>

      {state.hasPasskey && (
        <p className="text-sm text-amber-300 flex items-center justify-center gap-2">
          <KeyRound size={16} /> Send the passkey separately, not in the same message as the link.
        </p>
      )}

      <Link to="/" className="text-emerald-400 text-sm hover:underline block">
        Send another file
      </Link>
    </div>
  );
}