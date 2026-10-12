import { reportPeriod } from '@exa/domain';
import { serverDb } from '@/lib/supabase';
import { authorizedUser } from '@/lib/authorized';
import { processDelivery } from '@/lib/delivery';
import { z } from 'zod';
import { apiLimit, limitedJson } from '@/lib/security';

export const runtime = 'nodejs';
const input = reportPeriod.safeExtend({ idempotency_key: z.uuid() });

export async function POST(request: Request) {
  const user = await authorizedUser(request);
  if (!user) return Response.json({ error: 'Sessão inválida.' }, { status: 401 });
  const limited = await apiLimit(user.id, 'report_share');
  if (limited) return limited;
  const parsed = input.safeParse(await limitedJson(request));
  if (!parsed.success) return Response.json({ error: 'Pedido inválido.' }, { status: 400 });
  const db = serverDb();
  const { data: schedule } = await db.from('report_schedules').select('id').eq('user_id', user.id).maybeSingle();
  if (!schedule) return Response.json({ error: 'Configure o WhatsApp primeiro.' }, { status: 400 });
  const { data: prior } = await db.from('report_delivery_jobs').select('id,user_id,period_from,period_to,status')
    .eq('user_id', user.id).eq('idempotency_key', parsed.data.idempotency_key).maybeSingle();
  if (prior) return Response.json({ job_id: prior.id, status: prior.status });
  const { data, error } = await db.from('report_delivery_jobs').insert({
    user_id: user.id, schedule_id: schedule.id, origin: 'on_demand', idempotency_key: parsed.data.idempotency_key,
    period_from: parsed.data.from, period_to: parsed.data.to, status: 'scheduled'
  }).select('id,user_id,period_from,period_to,status').single();
  if (error?.code === '23505') {
    const { data: existing } = await db.from('report_delivery_jobs').select('id,status').eq('user_id', user.id).eq('idempotency_key', parsed.data.idempotency_key).single();
    if (existing) return Response.json({ job_id: existing.id, status: existing.status });
  }
  if (error || !data) return Response.json({ error: 'Não foi possível registrar o pedido.' }, { status: 500 });
  const status = await processDelivery(data);
  return Response.json({ job_id: data.id, status });
}
