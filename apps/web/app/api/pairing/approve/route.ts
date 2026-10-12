import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { authorizedUser } from '@/lib/authorized';
import { apiLimit, limitedJson } from '@/lib/security';

export async function POST(request: Request) {
  const user = await authorizedUser(request);
  if (!user) return Response.json({ error: 'Sessão inválida.' }, { status: 401 });
  const limited = await apiLimit(user.id, 'pairing_approve');
  if (limited) return limited;
  const parsed = z.object({ session_id: z.uuid(), source_device_id: z.uuid() }).safeParse(await limitedJson(request));
  if (!parsed.success) return Response.json({ error: 'Pedido inválido.' }, { status: 400 });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const token = request.headers.get('authorization')?.slice(7);
  if (!url || !anon || !token) return Response.json({ error: 'Configuração incompleta.' }, { status: 500 });
  const db = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${token}`, 'x-exa-device-id': request.headers.get('x-exa-device-id')!, 'x-exa-device-key': request.headers.get('x-exa-device-key')! } }, auth: { persistSession: false } });
  const { data, error } = await db.rpc('approve_pairing', { p_session_id: parsed.data.session_id, p_source_device_id: parsed.data.source_device_id });
  if (error) return Response.json({ error: error.message }, { status: 409 });
  return Response.json({ status: 'approved', device_id: data.id });
}
