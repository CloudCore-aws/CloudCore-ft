import { useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { UploadCloud, Lock, X } from 'lucide-react';
import { zipSync } from 'fflate';
import { api, errorMessage, formatBytes, type UploadResponse } from '../api';

const MAX_BYTES = 100 * 1024 * 1024;
const BLOCKED = ['.exe', '.bat', '.cmd', '.msi', '.scr', '.ps1']; // UX check only

// One file → upload as-is. Several files → zip them into one.
async function bundle(files: File[]): Promise<File> {
  if (files.length === 1) return files[0];
  const entries: Record<string, Uint8Array> = {};
  for (const f of files) entries[f.name] = new Uint8Array(await f.arrayBuffer());
  const zipped = zipSync(entries, { level: 0 }); // level 0 = store only, fast
  return new File([zipped as BlobPart], 'vaultdrop-files.zip', { type: 'application/zip' });
}

export default function UploadPage() {
  const [files, setFiles] = useState<File[]>([]);
  const [expiry, setExpiry] = useState('1h');
  const [cap, setCap] = useState(1);
  const [passkey, setPasskey] = useState('');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const totalSize = files.reduce((sum, f) => sum + f.size, 0);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: (accepted) => {
      const blocked = accepted.find((f) =>
        BLOCKED.some((ext) => f.name.toLowerCase().endsWith(ext))
      );
      if (blocked) return setError(`${blocked.name}: executable files are not allowed`);

      const next = [...files, ...accepted];
      const size = next.reduce((sum, f) => sum + f.size, 0);
      if (size > MAX_BYTES) return setError('Total size must be 100MB or less');

      setError('');
      setFiles(next);
    },
  });

  const removeFile = (index: number) => setFiles(files.filter((_, i) => i !== index));

  const upload = useMutation({
    mutationFn: async () => {
      const file = await bundle(files);
      if (file.size > MAX_BYTES) throw new Error('Total size must be 100MB or less');

      const form = new FormData();
      form.append('expiry', expiry);            // fields FIRST (backend requirement)
      form.append('maxDownloads', String(cap));
      if (passkey) form.append('passkey', passkey);
      form.append('file', file);                // file LAST

      const { data } = await api.post<UploadResponse>('/files', form, {
        onUploadProgress: (e) => setProgress(Math.round((e.loaded * 100) / (e.total ?? 1))),
      });
      return data;
    },
    onSuccess: (data) => navigate('/share', { state: { ...data, hasPasskey: !!passkey } }),
    onError: (e) => setError(errorMessage(e)),
  });

  return (
    <div className="bg-slate-900 rounded-2xl p-6 space-y-5 shadow-xl">
      <h1 className="text-2xl font-semibold flex items-center gap-2">
        <Lock size={22} /> VaultDrop
      </h1>

      {/* Drop zone */}
      <div
        {...getRootProps()}
        className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition ${
          isDragActive ? 'border-emerald-400 bg-slate-800' : 'border-slate-700 hover:border-slate-500'
        }`}
      >
        <input {...getInputProps()} />
        <UploadCloud className="mx-auto mb-2" />
        <p className="text-slate-400">
          Drag files here, or click to choose (max 100MB total)
        </p>
      </div>

      {/* Selected files */}
      {files.length > 0 && (
        <ul className="space-y-1 text-sm">
          {files.map((f, i) => (
            <li key={i} className="flex justify-between items-center bg-slate-800 rounded-lg px-3 py-2">
              <span className="truncate">{f.name}</span>
              <span className="flex items-center gap-2 text-slate-400">
                {formatBytes(f.size)}
                <button onClick={() => removeFile(i)} disabled={upload.isPending}>
                  <X size={14} />
                </button>
              </span>
            </li>
          ))}
          <li className="text-right text-slate-400">
            Total: {formatBytes(totalSize)}
            {files.length > 1 && ' · will be sent as one .zip'}
          </li>
        </ul>
      )}

      {/* Rules */}
      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm">
          Expires after
          <select value={expiry} onChange={(e) => setExpiry(e.target.value)}
            className="mt-1 w-full bg-slate-800 rounded-lg p-2">
            <option value="10m">10 minutes</option>
            <option value="1h">1 hour</option>
            <option value="24h">24 hours</option>
          </select>
        </label>
        <label className="text-sm">
          Download limit
          <select value={cap} onChange={(e) => setCap(Number(e.target.value))}
            className="mt-1 w-full bg-slate-800 rounded-lg p-2">
            <option value={1}>1 (one-time)</option>
            <option value={3}>3 downloads</option>
            <option value={10}>10 downloads</option>
          </select>
        </label>
      </div>

      <input type="password" placeholder="Optional passkey" value={passkey}
        onChange={(e) => setPasskey(e.target.value)}
        className="w-full bg-slate-800 rounded-lg p-2" />

      {/* Progress */}
      {upload.isPending && (
        <div className="w-full bg-slate-800 rounded-full h-2">
          <div className="bg-emerald-500 h-2 rounded-full transition-all" style={{ width: `${progress}%` }} />
        </div>
      )}

      {error && <p className="text-red-400 text-sm">{error}</p>}

      <button
        disabled={files.length === 0 || upload.isPending}
        onClick={() => upload.mutate()}
        className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 rounded-lg p-3 font-medium"
      >
        {upload.isPending ? `Uploading… ${progress}%` : 'Create secure link'}
      </button>
    </div>
  );
}