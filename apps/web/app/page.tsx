'use client';

import { useEffect, useMemo, useState } from 'react';
import { browserDb, browserDeviceHeaders } from '@/lib/supabase';
import { formatBrl, parseBrlCents } from '@exa/domain';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { CalendarDays, ChartNoAxesCombined, CreditCard, Download, LogOut, Menu, Plus, Send, Settings2, Wallet, X } from 'lucide-react';
import QRCode from 'qrcode';
import { CardPanel } from '@/components/CardPanel';

type Account = { id: string; name: string; opening_balance_cents: number | null; opening_date: string | null };
type Movement = { id: string; account_id: string; kind: 'income' | 'expense' | 'transfer' | 'refund' | 'adjustment' | 'invoice_payment'; amount_cents: number; description: string; occurred_on: string; status: 'pending' | 'settled' };
type Event = { id: string; title: string; starts_at: string; ends_at: string; description: string };
type Schedule = { id: string; enabled: boolean; next_delivery_at: string | null; delivery_mode: 'manual' | 'cloud_api'; recipient_e164: string | null; recipient_opted_in_at: string | null; zero_cost_only: boolean };
type ReportJob = { id: string; period_from: string; period_to: string; status: string; origin: string; requested_at: string };
type Device = { id: string; name: string; kind: string; revoked_at: string | null };
type Pairing = { id: string; expires_at: string; link: string; qr: string; status: string; requested_device_name?: string };
type FinanceSummary = { income_cents: number; expense_cents: number; balance_cents: number; balance_known: boolean; account_balances: Record<string, number | null> };
type Tab = 'inicio' | 'financas' | 'agenda' | 'relatorios' | 'configuracoes';

const tabs: { id: Tab; label: string; Icon: typeof Wallet }[] = [
  { id: 'inicio', label: 'Visão geral', Icon: ChartNoAxesCombined },
  { id: 'financas', label: 'Finanças', Icon: Wallet },
  { id: 'agenda', label: 'Agenda', Icon: CalendarDays },
  { id: 'relatorios', label: 'Relatórios', Icon: Download },
  { id: 'configuracoes', label: 'Configurações', Icon: Settings2 }
];

function today() { return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }); }

export default function Home() {
  const db = useMemo(() => { try { return browserDb(); } catch { return null; } }, []);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('inicio');
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [financeSummary, setFinanceSummary] = useState<FinanceSummary | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [reportJobs, setReportJobs] = useState<ReportJob[]>([]);
  const [message, setMessage] = useState('');
  const [dialog, setDialog] = useState<'account' | 'movement' | 'event' | null>(null);
  const [mobileNav, setMobileNav] = useState(false);
  const [devices, setDevices] = useState<Device[]>([]);
  const [sourceDevice, setSourceDevice] = useState<Device | null>(null);
  const [pairing, setPairing] = useState<Pairing | null>(null);

  useEffect(() => {
    if (!db) { setLoading(false); return; }
    void db.auth.getSession().then(({ data }) => { setSession(data.session); setLoading(false); });
    const { data: { subscription } } = db.auth.onAuthStateChange((_event, value) => setSession(value));
    return () => subscription.unsubscribe();
  }, [db]);

  async function reload(client: SupabaseClient) {
    const [a, m, e, s, j, f] = await Promise.all([
      client.from('financial_accounts').select('id,name,opening_balance_cents,opening_date').is('deleted_at', null).order('created_at'),
      client.from('transactions').select('id,account_id,kind,amount_cents,description,occurred_on,status').is('deleted_at', null).order('occurred_on', { ascending: false }).limit(200),
      client.from('calendar_events').select('id,title,starts_at,ends_at,description').is('deleted_at', null).order('starts_at').limit(100),
      client.from('report_schedules').select('id,enabled,next_delivery_at,delivery_mode,recipient_e164,recipient_opted_in_at,zero_cost_only').maybeSingle(),
      client.from('report_delivery_jobs').select('id,period_from,period_to,status,origin,requested_at').order('requested_at', { ascending: false }).limit(12),
      client.rpc('dashboard_finance_summary')
    ]);
    const error = a.error ?? m.error ?? e.error ?? s.error ?? j.error ?? f.error;
    if (error) { setMessage(error.message); return; }
    setAccounts((a.data ?? []) as Account[]);
    setMovements((m.data ?? []) as Movement[]);
    setFinanceSummary(f.data as FinanceSummary);
    setEvents((e.data ?? []) as Event[]);
    setSchedule(s.data as Schedule | null);
    setReportJobs((j.data ?? []) as ReportJob[]);
  }

  useEffect(() => {
    if (!db || !session) return;
    void reload(db);
    void setupDevices();
    let syncTimer: ReturnType<typeof setTimeout> | undefined;
    const reconcile = () => {
      if (syncTimer) clearTimeout(syncTimer);
      syncTimer = setTimeout(() => { void reload(db); }, 180);
    };
    const channel = db.channel('exa-updates')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'financial_accounts' }, () => void reload(db))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions' }, () => void reload(db))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'calendar_events' }, () => void reload(db))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'report_schedules' }, () => void reload(db))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'report_delivery_jobs' }, () => void reload(db))
      .subscribe(status => { if (status === 'SUBSCRIBED') reconcile(); });
    const onFocus = () => reconcile();
    const onVisibility = () => { if (document.visibilityState === 'visible') reconcile(); };
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      if (syncTimer) clearTimeout(syncTimer);
      void db.removeChannel(channel);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [db, session]);

  async function setupDevices() {
    if (!db || !session) return;
    let installation = localStorage.getItem('exa-installation');
    if (!installation) { installation = crypto.randomUUID(); localStorage.setItem('exa-installation', installation); }
    const bytes = new TextEncoder().encode(installation);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const hash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
    const { data: list, error } = await db.from('authorized_devices').select('id,name,kind,revoked_at,installation_id_hash').eq('user_id', session.user.id).order('created_at');
    if (error) { setMessage(error.message); return; }
    let own = list?.find(d => d.installation_id_hash === hash && !d.revoked_at);
    if (!own && !list?.length) {
      const key = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
      const keyHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key))), b => b.toString(16).padStart(2, '0')).join('');
      const result = await db.rpc('bootstrap_first_device', { p_installation_hash: hash, p_name: 'Navegador principal', p_device_key_hash: keyHash });
      if (result.error) { setMessage(result.error.message); return; }
      own = result.data;
      localStorage.setItem('exa-device-key', key);
    }
    if (own && localStorage.getItem('exa-device-key')) localStorage.setItem('exa-device-id', own.id);
    setSourceDevice(own && localStorage.getItem('exa-device-key') ? { id: own.id, name: own.name, kind: own.kind, revoked_at: own.revoked_at } : null);
    const { data: updated } = await db.from('authorized_devices').select('id,name,kind,revoked_at').eq('user_id', session.user.id).order('created_at');
    setDevices((updated ?? []) as Device[]);
    if (own) await reload(db);
  }

  useEffect(() => {
    if (!pairing || !db || !session) return;
    const timer = setInterval(async () => {
      const { data } = await db.from('pairing_sessions').select('status,requested_device_name').eq('id', pairing.id).single();
      if (data) setPairing(previous => previous?.id === pairing.id ? { ...previous, status: data.status, requested_device_name: data.requested_device_name ?? undefined } : previous);
    }, 3000);
    return () => clearInterval(timer);
  }, [pairing?.id, db, session]);

  async function createPairing() {
    if (!sourceDevice) { setMessage('Este navegador ainda não está autorizado.'); return; }
    const response = await fetch('/api/pairing/create', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}`, ...browserDeviceHeaders() }, body: JSON.stringify({ source_device_id: sourceDevice.id }) });
    const result = await response.json() as { error?: string; id?: string; expires_at?: string; link?: string };
    if (!response.ok || !result.id || !result.link || !result.expires_at) { setMessage(result.error ?? 'Falha ao criar QR.'); return; }
    const qr = await QRCode.toDataURL(result.link, { margin: 1, width: 230 });
    setPairing({ id: result.id, expires_at: result.expires_at, link: result.link, qr, status: 'created' });
  }

  async function approvePairing() {
    if (!pairing || !sourceDevice) return;
    const response = await fetch('/api/pairing/approve', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}`, ...browserDeviceHeaders() }, body: JSON.stringify({ session_id: pairing.id, source_device_id: sourceDevice.id }) });
    const result = await response.json() as { error?: string };
    setMessage(response.ok ? 'Android vinculado.' : result.error ?? 'Falha na aprovação.');
    if (response.ok) { setPairing(null); await setupDevices(); }
  }

  async function revokeDevice(id: string) {
    const device = devices.find(item => item.id === id);
    if (!window.confirm(`Revogar ${device?.name ?? 'este dispositivo'}? O acesso aos dados será encerrado.`)) return;
    const { error } = await db!.rpc('revoke_device', { p_device_id: id });
    setMessage(error?.message ?? 'Dispositivo revogado.');
    if (!error) await setupDevices();
  }

  if (!db) return <div className="setup"><h1>EXA</h1><p>Configure Supabase em <code>.env.local</code> para iniciar.</p></div>;
  if (loading) return <div className="setup">Carregando EXA…</div>;
  if (!session) return <Auth db={db} />;

  const income = financeSummary?.income_cents ?? 0;
  const expense = financeSummary?.expense_cents ?? 0;
  const balanceKnown = financeSummary?.balance_known ?? false;
  const balance = financeSummary?.balance_cents ?? 0;

  async function saveSchedule(form: FormData) {
    const recipient = String(form.get('recipient') ?? '').trim();
    const mode = String(form.get('mode'));
    const enabled = form.get('enabled') === 'on';
    if (mode === 'cloud_api' && !/^\+[1-9]\d{7,14}$/.test(recipient)) { setMessage('Informe um destinatário válido no formato +5541999999999.'); return; }
    if (mode === 'cloud_api' && form.get('consent') !== 'on') { setMessage('Confirme o consentimento do destinatário.'); return; }
    const { error } = await db!.rpc('configure_report_schedule', { p_enabled: enabled, p_mode: mode, p_recipient: recipient || null,
      p_consent: form.get('consent') === 'on', p_zero_cost_only: form.get('allow_cost') !== 'on' });
    setMessage(error ? error.message : 'Rotina de 30 dias salva.');
    if (!error) await reload(db!);
  }

  async function downloadReport(range?: { from: string; to: string }) {
    setMessage('Gerando PDF…');
    const token = session?.access_token;
    const date = new Date();
    const to = range?.to ?? today();
    const from = range?.from ?? new Date(date.getTime() - 30 * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
    try {
      const response = await fetch('/api/reports/generate', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...browserDeviceHeaders() }, body: JSON.stringify({ from, to }) });
      if (!response.ok) throw new Error((await response.json()).error ?? 'Falha ao gerar PDF.');
      const blob = await response.blob();
      const file = new File([blob], `EXA-relatorio-${from}-${to}.pdf`, { type: 'application/pdf' });
      if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: 'Relatório EXA' }); setMessage('Compartilhamento aberto. Confirme o destinatário no WhatsApp.'); return; }
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a'); link.href = url; link.download = file.name; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setMessage('PDF baixado. Anexe o arquivo no WhatsApp Web para enviar.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Não foi possível gerar o PDF.'); }
  }

  async function requestAutomaticDelivery() {
    const to = today();
    const from = new Date(Date.now() - 30 * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
    setMessage('Registrando pedido de envio…');
    try {
      const response = await fetch('/api/reports/share', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}`, ...browserDeviceHeaders() }, body: JSON.stringify({ from, to, idempotency_key: crypto.randomUUID() }) });
      const result = await response.json() as { error?: string; status?: string };
      if (!response.ok) throw new Error(result.error ?? 'Falha ao solicitar envio.');
      setMessage(result.status === 'provider_accepted' ? 'Meta aceitou o envio. A confirmação de entrega ainda está pendente.' :
        result.status === 'blocked_by_zero_cost_policy' ? 'Envio automático bloqueado para evitar cobrança. Gere o PDF e compartilhe manualmente.' :
        result.status === 'awaiting_manual_share' ? 'Envio automático indisponível. Gere o PDF e compartilhe manualmente.' :
        'Pedido registrado. Confira o status em breve.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Não foi possível solicitar envio.'); }
  }

  return <div className="shell">
    <a className="skipLink" href="#conteudo">Ir para o conteúdo</a>
    {mobileNav && <button className="sidebarBackdrop" aria-label="Fechar menu" onClick={() => setMobileNav(false)}/>}
    <aside className={`sidebar ${mobileNav ? 'show' : ''}`}>
      <div className="brand"><div className="brandmark">e.</div><div><b>EXA</b><small>PAINEL PESSOAL</small></div></div>
      <div className="sideCaption">ESPAÇO DE TRABALHO</div>
      <nav aria-label="Navegação principal">{tabs.map(({ id, label, Icon }) => <button key={id} className={tab === id ? 'nav active' : 'nav'} aria-pressed={tab === id} onClick={() => { setTab(id); setMobileNav(false); }}><Icon size={19} strokeWidth={1.8} aria-hidden="true" />{label}</button>)}</nav>
      <div className="sideFoot"><div className="avatar">{session.user.email?.[0]?.toUpperCase() ?? 'E'}</div><div className="accountLabel"><b>Minha conta</b><small>{session.user.email}</small></div><button className="iconButton" aria-label="Sair" title="Sair" onClick={() => void db.auth.signOut()}><LogOut size={18}/></button></div>
    </aside>
    <main className="content" id="conteudo" tabIndex={-1}>
      <header className="topbar"><button className="iconButton mobileOnly" onClick={() => setMobileNav(!mobileNav)} aria-label={mobileNav ? 'Fechar menu' : 'Abrir menu'} aria-expanded={mobileNav}>{mobileNav ? <X/> : <Menu/>}</button><span>Centro pessoal <span className="crumb">/ {tabs.find(t => t.id === tab)?.label}</span></span><span className="live"><span/> Conta conectada</span></header>
      <div className="page">
        {message && <div className="notice" role="status">{message}<button onClick={() => setMessage('')} aria-label="Fechar aviso"><X size={15}/></button></div>}
        {tab === 'inicio' && <><div className="pageHeading"><div><p className="eyebrow">SEU DIA EM FOCO</p><h1>Olá, {session.user.user_metadata?.display_name || 'bem-vindo'}.</h1><p>Seus números e compromissos em um só lugar.</p></div><button className="primary" onClick={() => setDialog('movement')}><Plus size={18}/> Novo lançamento</button></div>
          <div className="heroGrid"><div className="heroCard"><p>Saldo consolidado <span>↗</span></p><strong>{balanceKnown ? formatBrl(balance) : 'Não configurado'}</strong><small>{balanceKnown ? 'Contas com saldo inicial informado' : 'Informe o saldo inicial em cada conta'}</small></div><div className="metric"><span className="metricIcon green"><Wallet size={22}/></span><p>Entradas do mês</p><strong>{formatBrl(income)}</strong><small>Receitas registradas</small></div><div className="metric"><span className="metricIcon orange"><CreditCard size={22}/></span><p>Despesas diretas do mês</p><strong>{formatBrl(expense)}</strong><small>Compras no cartão aparecem nas faturas</small></div></div>
          <div className="twoCol"><section className="panel"><div className="panelTitle"><div><h2>Últimas movimentações</h2><p>Acompanhe seus registros recentes</p></div><button className="textButton" onClick={() => setTab('financas')}>Ver todas</button></div><MovementList movements={movements.slice(0, 6)} accounts={accounts}/></section><section className="panel"><div className="panelTitle"><div><h2>Próximos compromissos</h2><p>Sua agenda nos próximos dias</p></div><button className="textButton" onClick={() => setTab('agenda')}>Ver agenda</button></div><EventList events={events.filter(e => new Date(e.starts_at) >= new Date()).slice(0, 5)}/></section></div></>}
        {tab === 'financas' && <><div className="pageHeading"><div><p className="eyebrow">FINANÇAS</p><h1>Seu dinheiro, com clareza.</h1><p>Contas e lançamentos registrados por você.</p></div><div className="actions"><button className="secondary" onClick={() => setDialog('account')}><Plus size={18}/> Nova conta</button><button className="primary" onClick={() => setDialog('movement')}><Plus size={18}/> Lançamento</button></div></div><div className="accountGrid">{accounts.length ? accounts.map(a => <div className="accountCard" key={a.id}><span className="metricIcon blue"><Wallet size={20}/></span><p>{a.name}</p><strong>{financeSummary?.account_balances?.[a.id] == null ? 'Saldo não configurado' : formatBrl(financeSummary.account_balances[a.id]!)}</strong></div>) : <Empty text="Crie uma conta para começar a registrar finanças."/>}</div><section className="panel"><div className="panelTitle"><h2>Movimentações</h2></div><MovementList movements={movements} accounts={accounts}/></section><div style={{ height: 20 }}/><CardPanel db={db} userId={session.user.id} accounts={accounts}/></>}
        {tab === 'agenda' && <><div className="pageHeading"><div><p className="eyebrow">AGENDA</p><h1>Organize seus próximos dias.</h1><p>Compromissos sincronizados entre web e Android.</p></div><button className="primary" onClick={() => setDialog('event')}><Plus size={18}/> Novo evento</button></div><section className="panel"><EventList events={events}/></section></>}
        {tab === 'relatorios' && <><div className="pageHeading"><div><p className="eyebrow">RELATÓRIOS</p><h1>Panorama em PDF.</h1><p>Gere seu relatório quando quiser e compartilhe pelo WhatsApp.</p></div></div><div className="twoCol"><section className="panel feature"><span className="featureIcon"><Download size={25}/></span><h2>Relatório dos últimos 30 dias</h2><p>Entradas, despesas, pagamentos e movimentações detalhadas. O PDF é gerado no momento do pedido.</p><button className="primary" onClick={() => void downloadReport()}><Download size={18}/> Gerar e compartilhar PDF</button>{schedule?.delivery_mode === 'cloud_api' && <button className="secondary" style={{ marginTop: 10 }} onClick={() => void requestAutomaticDelivery()}><Send size={18}/> Solicitar envio automático agora</button>}</section><section className="panel feature"><span className="featureIcon"><Send size={25}/></span><h2>Envio a cada 30 dias</h2><p>{schedule?.enabled ? `Próximo ciclo: ${new Date(schedule.next_delivery_at!).toLocaleDateString('pt-BR')}.` : 'Ative o agendamento para preparar seu relatório a cada 30 dias.'}</p><button className="secondary" onClick={() => setTab('configuracoes')}><Settings2 size={18}/> Configurar envio</button></section></div><section className="panel" style={{ marginTop: 20 }}><div className="panelTitle"><h2>Entregas anteriores</h2></div>{reportJobs.length ? <div className="list">{reportJobs.map(job => <div className="listRow" key={job.id}><div className="rowMain"><b>{job.period_from} a {job.period_to}</b><small>{job.origin === 'scheduled' ? 'Ciclo de 30 dias' : 'Pedido antecipado'} · {job.status}</small></div><button className="textButton" onClick={() => void downloadReport({ from: job.period_from, to: job.period_to })}>Compartilhar PDF</button></div>)}</div> : <Empty text="Nenhum ciclo registrado ainda."/>}</section></>}
        {tab === 'configuracoes' && <><div className="pageHeading"><div><p className="eyebrow">PREFERÊNCIAS</p><h1>Configure seus relatórios.</h1><p>O envio antecipado não muda a data do próximo ciclo.</p></div></div><section className="panel settings"><h2>WhatsApp e periodicidade</h2><form action={saveSchedule} key={schedule?.id ?? 'new'}><label className="check"><input type="checkbox" name="enabled" defaultChecked={schedule?.enabled ?? false}/> Preparar relatório a cada 30 dias</label><label>Modo de entrega<select name="mode" defaultValue={schedule?.delivery_mode ?? 'manual'}><option value="manual">Compartilhamento manual gratuito</option><option value="cloud_api">Envio automático pela Meta Cloud API</option></select></label><label>Destinatário (formato internacional)<input name="recipient" type="tel" autoComplete="tel" inputMode="tel" placeholder="Ex.: +5541999999999…" defaultValue={schedule?.recipient_e164 ?? ''}/></label><label className="check"><input type="checkbox" name="consent" defaultChecked={!!schedule?.recipient_opted_in_at}/> Confirmo que o destinatário aceitou receber o relatório</label><label className="check"><input type="checkbox" name="allow_cost" defaultChecked={schedule ? !schedule.zero_cost_only : false}/> Aceito possível cobrança pela Meta</label><p className="hint">Com custo zero, o sistema bloqueia mensagens que possam ser tarifadas. O PDF continua disponível para envio manual pelo WhatsApp.</p><button className="primary" type="submit">Salvar configuração</button></form></section><section className="panel settings" style={{ marginTop: 20 }}><h2>Dispositivos vinculados ({devices.filter(d => !d.revoked_at).length}/5)</h2><p className="hint">Vincule o Android após entrar na mesma conta no aplicativo.</p><button className="secondary" onClick={() => void createPairing()}>Gerar QR de vínculo</button>{pairing && <div className="pairing"><img src={pairing.qr} alt="QR para vincular Android" width="230" height="230"/><p>Expira em {new Date(pairing.expires_at).toLocaleTimeString('pt-BR')}.</p><p>Status: {pairing.status === 'requested' ? `Pedido de ${pairing.requested_device_name ?? 'Android'} aguardando aprovação.` : pairing.status}</p>{pairing.status === 'requested' && <button className="primary" onClick={() => void approvePairing()}>Aprovar dispositivo</button>}</div>}<div className="list">{devices.filter(d => !d.revoked_at).map(d => <div className="listRow" key={d.id}><div className="rowMain"><b>{d.name}</b><small>{d.kind === 'web' ? 'Navegador' : 'Android'}</small></div><button className="textButton" onClick={() => void revokeDevice(d.id)}>Revogar</button></div>)}</div></section></>}
      </div>
    </main>
    {dialog && <EntryDialog db={db} session={session} kind={dialog} accounts={accounts} onClose={() => setDialog(null)} onSaved={() => void reload(db)} onError={setMessage}/>}
  </div>;
}

function Auth({ db }: { db: SupabaseClient }) {
  const [signup, setSignup] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(form: FormData) {
    setBusy(true); setError('');
    const email = String(form.get('email')); const password = String(form.get('password'));
    const result = signup ? await db.auth.signUp({ email, password, options: { data: { display_name: String(form.get('name')) } } }) : await db.auth.signInWithPassword({ email, password });
    setError(result.error?.message ?? (signup && !result.data.session ? 'Confira seu e-mail para confirmar o cadastro.' : ''));
    setBusy(false);
  }
  return <div className="authPage"><div className="authLeft"><div className="brand"><div className="brandmark">e.</div><b>EXA</b></div><div><p className="eyebrow">ORGANIZE O QUE IMPORTA</p><h1>Mais clareza para seu dia a dia.</h1><p>Finanças, agenda e relatórios em um painel pessoal feito para você.</p></div><small>Seus dados ficam vinculados à sua conta.</small></div><div className="authRight"><form action={submit} className="authForm"><p className="eyebrow">BEM-VINDO AO EXA</p><h2>{signup ? 'Crie sua conta' : 'Entre na sua conta'}</h2><p>{signup ? 'Comece a organizar sua rotina.' : 'Acesse suas informações pessoais.'}</p>{signup && <label>Seu nome<input name="name" autoComplete="name" required placeholder="Ex.: Ana…"/></label>}<label>E-mail<input type="email" name="email" autoComplete="email" spellCheck={false} required placeholder="Ex.: voce@exemplo.com…"/></label><label>Senha<input type="password" name="password" autoComplete={signup ? 'new-password' : 'current-password'} required minLength={8} placeholder="Mínimo de 8 caracteres…"/></label>{error && <div className="notice" role="status">{error}</div>}<button className="primary wide" disabled={busy}>{busy ? 'Aguarde…' : signup ? 'Criar conta' : 'Entrar'}</button><button type="button" className="textButton" onClick={() => { setSignup(!signup); setError(''); }}>{signup ? 'Já tenho conta' : 'Criar conta'}</button></form></div></div>;
}

function MovementList({ movements, accounts }: { movements: Movement[]; accounts: Account[] }) {
  if (!movements.length) return <Empty text="Nenhum lançamento por enquanto."/>;
  return <div className="list">{movements.map(m => <div className="listRow" key={m.id}><div className={`rowIcon ${m.kind === 'income' ? 'income' : 'expense'}`}>{m.kind === 'income' ? '↙' : '↗'}</div><div className="rowMain"><b>{m.description}</b><small>{accounts.find(a => a.id === m.account_id)?.name ?? 'Conta'} · {new Date(`${m.occurred_on}T12:00:00`).toLocaleDateString('pt-BR')}</small></div><strong className={m.kind === 'income' ? 'positive' : ''}>{m.kind === 'income' ? '+' : '−'} {formatBrl(m.amount_cents)}</strong></div>)}</div>;
}

function EventList({ events }: { events: Event[] }) {
  if (!events.length) return <Empty text="Nenhum compromisso registrado."/>;
  return <div className="list">{events.map(e => <div className="listRow" key={e.id}><div className="dateBadge"><b>{new Date(e.starts_at).toLocaleDateString('pt-BR', { day: '2-digit', timeZone: 'America/Sao_Paulo' })}</b><small>{new Date(e.starts_at).toLocaleDateString('pt-BR', { month: 'short', timeZone: 'America/Sao_Paulo' })}</small></div><div className="rowMain"><b>{e.title}</b><small>{new Date(e.starts_at).toLocaleString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })}{e.description ? ` · ${e.description}` : ''}</small></div></div>)}</div>;
}

function Empty({ text }: { text: string }) { return <div className="empty">{text}</div>; }

function EntryDialog({ db, session, kind, accounts, onClose, onSaved, onError }: { db: SupabaseClient; session: Session; kind: 'account'|'movement'|'event'; accounts: Account[]; onClose: () => void; onSaved: () => void; onError: (value: string) => void }) {
  const [busy, setBusy] = useState(false);
  async function submit(form: FormData) {
    setBusy(true);
    try {
      if (kind === 'account') {
        const opening = String(form.get('opening') ?? '').trim();
        const { error } = await db.from('financial_accounts').insert({ user_id: session.user.id, name: String(form.get('name')).trim(), opening_balance_cents: opening ? parseBrlCents(opening) : null, opening_date: opening ? today() : null });
        if (error) throw error;
      } else if (kind === 'movement') {
        const { error } = await db.from('transactions').insert({ user_id: session.user.id, account_id: String(form.get('account')), kind: String(form.get('kind')), description: String(form.get('description')).trim(), amount_cents: parseBrlCents(String(form.get('amount'))), occurred_on: String(form.get('date')), status: 'settled', idempotency_key: crypto.randomUUID() });
        if (error) throw error;
      } else {
        const starts = new Date(String(form.get('starts'))); const ends = new Date(String(form.get('ends')));
        if (ends <= starts) throw new Error('O término deve ocorrer após o início.');
        const { error } = await db.from('calendar_events').insert({ user_id: session.user.id, title: String(form.get('title')).trim(), starts_at: starts.toISOString(), ends_at: ends.toISOString(), description: String(form.get('description') ?? '') });
        if (error) throw error;
      }
      onSaved(); onClose();
    } catch (error) { onError(error instanceof Error ? error.message : 'Não foi possível salvar.'); }
    setBusy(false);
  }
  return <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }} onKeyDown={e => { if (e.key === 'Escape') onClose(); }}><div className="modal" role="dialog" aria-modal="true" aria-label={kind === 'account' ? 'Nova conta' : kind === 'event' ? 'Novo evento' : 'Novo lançamento'}><div className="modalHead"><h2>{kind === 'account' ? 'Nova conta' : kind === 'event' ? 'Novo evento' : 'Novo lançamento'}</h2><button className="iconButton" onClick={onClose} aria-label="Fechar"><X size={20}/></button></div><form action={submit}>
    {kind === 'account' && <><label>Nome da conta<input name="name" required placeholder="Ex.: Conta principal"/></label><label>Saldo inicial (opcional)<input name="opening" placeholder="0,00" inputMode="decimal"/></label></>}
    {kind === 'movement' && <><label>Tipo<select name="kind"><option value="expense">Despesa</option><option value="income">Receita</option></select></label><label>Descrição<input name="description" required placeholder="Ex.: Mercado"/></label><label>Valor em reais<input name="amount" required inputMode="decimal" placeholder="39,90"/></label><label>Conta<select name="account" required><option value="">Selecione</option>{accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label><label>Data<input type="date" name="date" defaultValue={today()} required/></label>{!accounts.length && <p className="hint">Crie uma conta antes de lançar movimentações.</p>}</>}
    {kind === 'event' && <><label>Título<input name="title" required placeholder="Ex.: Consulta médica"/></label><label>Início<input type="datetime-local" name="starts" required/></label><label>Término<input type="datetime-local" name="ends" required/></label><label>Descrição<input name="description" placeholder="Opcional"/></label></>}
    <div className="modalActions"><button type="button" className="secondary" onClick={onClose}>Cancelar</button><button className="primary" disabled={busy || (kind === 'movement' && !accounts.length)}>{busy ? 'Salvando…' : 'Salvar'}</button></div>
  </form></div></div>;
}
