import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
let browserClient: SupabaseClient | null = null;

export function browserDb() {
  if (!url || !anon) throw new Error('Supabase não configurado. Preencha NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.');
  if (browserClient) return browserClient;
  browserClient = createClient(url, anon, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    global: { fetch: (input, init) => {
      const headers = new Headers(init?.headers);
      for (const [name, value] of Object.entries(browserDeviceHeaders())) headers.set(name, value);
      return fetch(input, { ...init, headers });
    } }
  });
  return browserClient;
}

export function browserDeviceHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const id = localStorage.getItem('exa-device-id');
  const key = localStorage.getItem('exa-device-key');
  return id && key ? { 'x-exa-device-id': id, 'x-exa-device-key': key } : {};
}

export function serverDb() {
  const service = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) throw new Error('Supabase servidor não configurado.');
  return createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function authenticatedUser(request: Request) {
  if (!url || !anon) return null;
  const token = request.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];
  if (!token) return null;
  const client = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.getUser(token);
  return error ? null : data.user;
}
