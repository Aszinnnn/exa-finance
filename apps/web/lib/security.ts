import { serverDb } from './server-supabase';

type Action = 'report_generate' | 'report_share' | 'pairing_create' | 'pairing_request' | 'pairing_approve';

const policy: Record<Action, { max: number; seconds: number }> = {
  report_generate: { max: 12, seconds: 3600 },
  report_share: { max: 3, seconds: 3600 },
  pairing_create: { max: 10, seconds: 3600 },
  pairing_request: { max: 10, seconds: 3600 },
  pairing_approve: { max: 10, seconds: 3600 }
};

export async function apiLimit(userId: string, action: Action): Promise<Response | null> {
  const { max, seconds } = policy[action];
  const { data, error } = await serverDb().rpc('consume_api_limit', {
    p_user_id: userId, p_action: action, p_max: max, p_window_seconds: seconds
  });
  if (error) return Response.json({ error: 'Controle de acesso temporariamente indisponível.' }, { status: 503 });
  if (!data) return Response.json({ error: 'Muitas solicitações. Aguarde e tente novamente.' }, {
    status: 429, headers: { 'Retry-After': String(seconds) }
  });
  return null;
}

export async function limitedJson(request: Request): Promise<unknown> {
  if (request.headers.get('content-type')?.split(';')[0]?.trim() !== 'application/json') return null;
  if (Number(request.headers.get('content-length') ?? 0) > 8192) return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 8192) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const text = new TextDecoder().decode(bytes);
  try { return JSON.parse(text); } catch { return null; }
}
