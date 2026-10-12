import { generateReport } from './report';
import { serverDb } from './server-supabase';

type Job = { id: string; user_id: string; period_from: string; period_to: string; status: string };

export async function processDelivery(job: Job) {
  const db = serverDb();
  const { data: schedule, error } = await db.from('report_schedules').select('*').eq('user_id', job.user_id).single();
  if (error || !schedule) throw new Error('SCHEDULE_MISSING');
  if (schedule.delivery_mode !== 'cloud_api' || !process.env.WHATSAPP_CLOUD_API_ENABLED || process.env.WHATSAPP_CLOUD_API_ENABLED !== 'true') {
    await db.from('report_delivery_jobs').update({ status: 'awaiting_manual_share' }).eq('id', job.id);
    return 'awaiting_manual_share';
  }
  if (!schedule.recipient_e164 || !schedule.recipient_opted_in_at) {
    await db.from('report_delivery_jobs').update({ status: 'failed', last_error_code: 'RECIPIENT_NOT_CONSENTED' }).eq('id', job.id);
    return 'failed';
  }
  // Meta does not offer a reliable zero-cost quote before dispatching a template.
  // With a zero ceiling we must not send a message that may be billed.
  if (schedule.zero_cost_only || process.env.WHATSAPP_ALLOW_BILLABLE !== 'true') {
    await db.from('report_delivery_jobs').update({ status: 'blocked_by_zero_cost_policy' }).eq('id', job.id);
    return 'blocked_by_zero_cost_policy';
  }
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phone = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const template = process.env.WHATSAPP_TEMPLATE_NAME;
  const version = process.env.WHATSAPP_GRAPH_API_VERSION ?? 'v23.0';
  if (!token || !phone || !template || !/^v\d+\.\d+$/.test(version)) {
    await db.from('report_delivery_jobs').update({ status: 'failed', last_error_code: 'PROVIDER_NOT_CONFIGURED' }).eq('id', job.id);
    return 'failed';
  }
  const { data: claimed } = await db.from('report_delivery_jobs').update({ status: 'sending' }).eq('id', job.id).in('status', ['scheduled', 'ready_for_share']).select('id').maybeSingle();
  if (!claimed) return 'already_processed';
  try {
    const bytes = await generateReport(job.user_id, job.period_from, job.period_to);
    const media = new FormData();
    media.append('messaging_product', 'whatsapp');
    media.append('type', 'application/pdf');
    media.append('file', new Blob([Buffer.from(bytes)], { type: 'application/pdf' }), `EXA-${job.period_from}-${job.period_to}.pdf`);
    const endpoint = `https://graph.facebook.com/${version}/${encodeURIComponent(phone)}`;
    const uploaded = await fetch(`${endpoint}/media`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: media });
    if (!uploaded.ok) throw new Error('MEDIA_UPLOAD_FAILED');
    const mediaId = (await uploaded.json() as { id?: string }).id;
    if (!mediaId) throw new Error('MEDIA_ID_MISSING');
    const sent = await fetch(`${endpoint}/messages`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({
      messaging_product: 'whatsapp', to: schedule.recipient_e164.replace('+', ''), type: 'template',
      template: { name: template, language: { code: 'pt_BR' }, components: [{ type: 'header', parameters: [{ type: 'document', document: { id: mediaId, filename: `EXA-${job.period_from}-${job.period_to}.pdf` } }] }] }
    }) });
    if (!sent.ok) throw new Error('MESSAGE_SEND_FAILED');
    const messageId = (await sent.json() as { messages?: { id: string }[] }).messages?.[0]?.id;
    if (!messageId) throw new Error('MESSAGE_ID_MISSING');
    await db.from('report_delivery_jobs').update({ status: 'provider_accepted', provider_message_id: messageId, attempts: 1 }).eq('id', job.id);
    return 'provider_accepted';
  } catch (cause) {
    const code = cause instanceof Error ? cause.message : 'PROVIDER_FAILED';
    await db.from('report_delivery_jobs').update({ status: 'failed', last_error_code: code, attempts: 1 }).eq('id', job.id);
    return 'failed';
  }
}
