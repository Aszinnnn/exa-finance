import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
let browserClient: SupabaseClient | null = null;
let identity: string | null = null;
export function setBrowserIdentity(userId: string | null) { identity = userId; }
export function deviceStorageKey(name: string, userId: string) { return `exa-${name}:${userId}`; }

export function browserDb() {
  if (!url || !anon) throw new Error('Supabase não configurado. Preencha NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.');
  if (browserClient) return browserClient;
  browserClient = createClient(url, anon, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    global: { fetch: (input, init) => {
      const headers = new Headers(input instanceof Request ? input.headers : undefined);
      new Headers(init?.headers).forEach((value, name) => headers.set(name, value));
      const target = new URL(input instanceof Request ? input.url : String(input));
      if (target.origin === new URL(url).origin && target.pathname.startsWith('/rest/v1/')) {
        for (const [name, value] of Object.entries(browserDeviceHeaders())) headers.set(name, value);
      }
      return fetch(input, { ...init, headers });
    } }
  });
  return browserClient;
}

export function browserDeviceHeaders(): Record<string, string> {
  if (typeof window === 'undefined' || !identity) return {};
  const id = localStorage.getItem(deviceStorageKey('device-id', identity));
  const key = localStorage.getItem(deviceStorageKey('device-key', identity));
  return id && key ? { 'x-exa-device-id': id, 'x-exa-device-key': key } : {};
}
