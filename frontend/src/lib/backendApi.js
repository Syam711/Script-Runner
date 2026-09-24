import { supabase } from './supabaseClient';

const BACKEND_HTTP_URL = import.meta.env.VITE_BACKEND_HTTP_URL;

if (!BACKEND_HTTP_URL) {
  throw new Error('Missing VITE_BACKEND_HTTP_URL. Check your .env file.');
}

async function getAccessToken() {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token;
}

async function request(method, path, body = {}) {
  const accessToken = await getAccessToken();
  const res = await fetch(`${BACKEND_HTTP_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, accessToken }),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }

  return data;
}

export const backendApi = {
  createRegion: (payload) => request('POST', '/regions', payload),
  updateRegion: (regionId, payload) => request('PATCH', `/regions/${regionId}`, payload),
  deleteRegion: (regionId) => request('DELETE', `/regions/${regionId}`, {}),

  createCommand: (payload) => request('POST', '/commands', payload),
  updateCommand: (commandId, payload) => request('PATCH', `/commands/${commandId}`, payload),
  deleteCommand: (commandId) => request('DELETE', `/commands/${commandId}`, {}),

  createBatch: (payload) => request('POST', '/batches', payload),
  updateBatch: (batchId, payload) => request('PATCH', `/batches/${batchId}`, payload),
  deleteBatch: (batchId) => request('DELETE', `/batches/${batchId}`, {}),

  createShare: (payload) => request('POST', '/shares', payload),
  deleteShare: (payload) => request('DELETE', '/shares', payload),
  listShareContext: (payload) => request('POST', '/shares/list', payload),
};
