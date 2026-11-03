import axios from 'axios';

export const API_BASE = import.meta.env.VITE_API_URL ?? '/api';
export const api = axios.create({ baseURL: API_BASE });

export type UploadResponse = { shareToken: string; expiresAt: string };

export type UnlockResponse = {
  fileName: string;
  sizeBytes: number;
  expiresAt: string;
  downloadsRemaining: number;
  downloadTicket: string;
  unlockSession: string;
};

export type TicketResponse = { downloadTicket: string; downloadsRemaining: number };

export const formatBytes = (n: number) =>
  n < 1024 ? `${n} B`
  : n < 1048576 ? `${(n / 1024).toFixed(1)} KB`
  : `${(n / 1048576).toFixed(1)} MB`;

// Turns any error into a readable message
export const errorMessage = (e: unknown): string => {
  if (axios.isAxiosError<{ error?: string }>(e)) {
    return e.response?.data?.error ?? 'Something went wrong';
  }
  return e instanceof Error ? e.message : 'Something went wrong';
};

// HTTP status code of a failed request (or undefined)
export const errorStatus = (e: unknown): number | undefined =>
  axios.isAxiosError(e) ? e.response?.status : undefined;