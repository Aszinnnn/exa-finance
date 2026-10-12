import { createHmac, timingSafeEqual } from 'node:crypto';
import { serverDb } from '@/lib/supabase';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  if (token && url.searchParams.get('hub.mode') === 'subscribe' && url.searchParams.get('hub.verify_token') === token) {
    return new Response(url.searchParams.get('hub.challenge') ?? '', { status: 200 });
  }
  return new Response('Forbidden', { status: 403 });
}

export async function POST(request: Request) {
  const secret = process.env.WHATSAPP_APP_SECRET;
  const signature = request.headers.get('x-hub-signature-256');
  if (!secret || !signature?.startsWith('sha256=')) return new Response('Forbidden', { status: 403 });
  if (Number(request.headers.get('content-length') ?? 0) > 65536) return new Response('Payload too large', { status: 413 });
  const reader = request.body?.getReader();
  if (!reader) return new Response('Bad request', { status: 400 });
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 65536) { await reader.cancel(); return new Response('Payload too large', { status: 413 }); }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  const raw = new TextDecoder().decode(body);
  const digest = createHmac('sha256', secret).update(body).digest('hex');
  const supplied = signature.slice(7);
  if (supplied.length !== digest.length || !timingSafeEqual(Buffer.from(supplied), Buffer.from(digest))) return new Response('Forbidden', { status: 403 });
  let payload: { entry?: { changes?: { value?: { statuses?: { id: string; status: string }[] } }[] }[] };
  try { payload = JSON.parse(raw); } catch { return new Response('Bad request', { status: 400 }); }
  const db = serverDb();
  for (const entry of payload.entry ?? []) for (const change of entry.changes ?? []) for (const item of change.value?.statuses ?? []) {
    if (!['sent','delivered','read','failed'].includes(item.status)) continue;
    const status = item.status === 'delivered' || item.status === 'read' ? 'delivered' : item.status === 'failed' ? 'failed' : 'provider_accepted';
    await db.from('report_delivery_jobs').update({ status, ...(status === 'delivered' ? { delivered_at: new Date().toISOString() } : {}) }).eq('provider_message_id', item.id).eq('status', 'provider_accepted');
  }
  return Response.json({ ok: true });
}
