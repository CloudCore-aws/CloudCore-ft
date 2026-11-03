import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './index.css';
import UploadPage from './pages/UploadPage';
import SharePage from './pages/SharePage';
import VaultPage from './pages/VaultPage';

const queryClient = new QueryClient();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4">
          <div className="w-full max-w-lg">
            <Routes>
              <Route path="/" element={<UploadPage />} />
              <Route path="/share" element={<SharePage />} />
              <Route path="/vault/:token" element={<VaultPage />} />
            </Routes>
          </div>
        </div>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);