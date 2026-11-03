import { useLocation, Navigate } from 'react-router-dom';
import type { UploadResponse } from '../api';

// Placeholder: the real page (copy button + QR) comes next
export default function SharePage() {
  const state = useLocation().state as UploadResponse | null;
  if (!state) return <Navigate to="/" />;
  const link = `${window.location.origin}/vault/${state.shareToken}`;
  return (
    <div className="bg-slate-900 rounded-2xl p-6 space-y-2">
      <h2 className="text-xl font-semibold">Uploaded!</h2>
      <p className="text-sm break-all">{link}</p>
    </div>
  );
}