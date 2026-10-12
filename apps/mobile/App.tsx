import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { Session } from '@supabase/supabase-js';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { formatBrl, parseBrlCents } from '@exa/domain';
import { db, deviceHeaders, setMobileIdentity, mobileStorageKey } from './src/db';

type Account = { id: string; name: string; opening_balance_cents: number | null };
type Movement = { id: string; kind: string; description: string; amount_cents: number; occurred_on: string };
type Event = { id: string; title: string; starts_at: string };
type FinanceSummary = { income_cents: number; balance_cents: number; balance_known: boolean; account_balances: Record<string, number | null> };
type Screen = 'inicio' | 'financas' | 'agenda' | 'relatorio' | 'vinculo';

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [busy, setBusy] = useState(true);
  const [screen, setScreen] = useState<Screen>('inicio');
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [financeSummary, setFinanceSummary] = useState<FinanceSummary | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [kind, setKind] = useState<'income' | 'expense'>('expense');
  const [eventTitle, setEventTitle] = useState('');
  const [eventWhen, setEventWhen] = useState('');
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [scanning, setScanning] = useState(false);
  const [pairingId, setPairingId] = useState<string | null>(null);
  const [pairingStatus, setPairingStatus] = useState('');
  const [authorized, setAuthorized] = useState(false);
  const [joinLink, setJoinLink] = useState('');
  const [issuedPair, setIssuedPair] = useState<{ id: string; link: string; expires_at: string; status?: string; requested_device_name?: string } | null>(null);
  const [devices, setDevices] = useState<{ id: string; name: string; kind: string }[]>([]);
  const [openingBalance, setOpeningBalance] = useState('');
  const currentUser = useRef(session?.user.id);
  currentUser.current = session?.user.id;
  const preparing = useRef<string | null>(null);
  const [authorizedOwner, setAuthorizedOwner] = useState<string | null>(null);

  async function prepareDevice() {
    if (!db || !session) return;
    if (preparing.current === session.user.id) return;
    preparing.current = session.user.id;
    try {
    const verified = await db.auth.getUser();
    if (!verified.data.user?.email_confirmed_at) { setPairingStatus('Confirme o e-mail antes de acessar.'); return; }
    const storage = (name: string) => mobileStorageKey(name, session.user.id);
    let installation = await SecureStore.getItemAsync(storage('installation')) ?? await SecureStore.getItemAsync('exa-installation');
    if (!installation) installation = Crypto.randomUUID();
    await SecureStore.setItemAsync(storage('installation'), installation);
    const hash = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, installation);
    const { data: list, error } = await db.from('authorized_devices').select('id,name,kind,installation_id_hash,revoked_at');
    if (error) { setPairingStatus('Não foi possível verificar os dispositivos. Tente novamente.'); return; }
    let own = list?.find(item => item.installation_id_hash === hash && !item.revoked_at);
    let key = await SecureStore.getItemAsync(storage('device-key'));
    if (!key && own) key = await SecureStore.getItemAsync('exa-device-key');
    if (!key) key = Array.from(Crypto.getRandomBytes(32), b => b.toString(16).padStart(2,'0')).join('');
    await SecureStore.setItemAsync(storage('device-key'), key);
    if (!own && !list?.length) {
      const result = await db.rpc('bootstrap_device', { p_installation_hash: hash, p_name: 'EXA Android', p_device_key_hash: await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256,key), p_kind: 'android' });
      if (result.error) { setPairingStatus(result.error.message); return; }
      own = result.data;
    }
    if (own) await SecureStore.setItemAsync(storage('device-id'),own.id);
    else await SecureStore.deleteItemAsync(storage('device-id'));
    const access = await db.rpc('has_active_device');
    const ready = !access.error && access.data === true;
    if (session.user.id !== currentUser.current) return;
    setAuthorizedOwner(session.user.id);
    setAuthorized(ready);
    setDevices((list ?? []).filter(item => !item.revoked_at));
    setPairingStatus(ready ? 'Este dispositivo está autorizado.' : 'Solicite o vínculo e aprove no dispositivo de origem.');
    if (!ready) setScreen('vinculo');
    } catch { setPairingStatus('Conexão indisponível. Tente verificar a autorização novamente.'); }
    finally { if (preparing.current === session.user.id) preparing.current = null; }
  }

  useEffect(() => {
    setMobileIdentity(session?.user.id ?? null);
    setAuthorized(false); setAccounts([]); setMovements([]); setEvents([]); setFinanceSummary(null);
    setPairingId(null); setIssuedPair(null); setJoinLink('');
    if (session) void prepareDevice();
  }, [session?.user.id]);

  useEffect(() => {
    if (!db) { setBusy(false); return; }
    void db.auth.getSession().then(({ data }) => { setSession(data.session); setBusy(false); });
    const { data: { subscription } } = db.auth.onAuthStateChange((_event, value) => setSession(value));
    return () => subscription.unsubscribe();
  }, []);

  async function reload() {
    if (!db || !session) return;
    const owner = session.user.id;
    const [a, m, e, summary] = await Promise.all([
      db.from('financial_accounts').select('id,name,opening_balance_cents').is('deleted_at', null).order('created_at'),
      db.from('transactions').select('id,kind,description,amount_cents,occurred_on').is('deleted_at', null).order('occurred_on', { ascending: false }).limit(100),
      db.from('calendar_events').select('id,title,starts_at').is('deleted_at', null).order('starts_at').limit(100),
      db.rpc('dashboard_finance_summary')
    ]);
    if (owner !== currentUser.current) return;
    if (a.error || m.error || e.error || summary.error) { Alert.alert('Sincronização', a.error?.message ?? m.error?.message ?? e.error?.message ?? summary.error?.message); return; }
    setAccounts((a.data ?? []) as Account[]); setMovements((m.data ?? []) as Movement[]); setEvents((e.data ?? []) as Event[]);
    setFinanceSummary(summary.data as FinanceSummary);
  }

  useEffect(() => {
    const client = db;
    if (!client || !session || !authorized) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const reconcile = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(async () => {
        const access = await client.rpc('has_active_device');
        if (access.error) return;
        if (!access.data) { setAuthorized(false); setAccounts([]); setMovements([]); setEvents([]); setFinanceSummary(null); setScreen('vinculo'); return; }
        void reload();
      }, 180);
    };
    void reload();
    const channel = client.channel('exa-mobile')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'financial_accounts' }, reconcile)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions' }, reconcile)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'calendar_events' }, reconcile)
      .subscribe(status => { if (status === 'SUBSCRIBED') reconcile(); });
    const appState = AppState.addEventListener('change', state => { if (state === 'active') reconcile(); });
    const poll = setInterval(() => { if (AppState.currentState === 'active') reconcile(); },15000);
    return () => { clearInterval(poll); if (timer) clearTimeout(timer); appState.remove(); void client.removeChannel(channel); };
  }, [session?.user.id, authorized]);

  async function login(signup: boolean) {
    if (!db) return;
    setBusy(true);
    const result = signup ? await db.auth.signUp({ email, password, options: { emailRedirectTo: `${process.env.EXPO_PUBLIC_APP_URL}/auth/confirm`, data: { display_name: name } } }) : await db.auth.signInWithPassword({ email, password });
    setBusy(false);
    Alert.alert(result.error ? 'Erro' : 'EXA', result.error?.message ?? (result.data.session ? 'Acesso realizado.' : 'Confira seu e-mail para confirmar o cadastro.'));
  }

  async function addAccount() {
    if (!db || !session || !name.trim()) return;
    try {
      const opening = openingBalance.trim() ? parseBrlCents(openingBalance) : null;
      const { error } = await db.from('financial_accounts').insert({ user_id: session.user.id, name: name.trim(), opening_balance_cents: opening, opening_date: opening === null ? null : new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }) });
      if (error) throw new Error(error.message);
      setName(''); setOpeningBalance(''); await reload();
    } catch (cause) { Alert.alert('Conta',cause instanceof Error ? cause.message : 'Falha ao salvar conta.'); }
  }

  async function addMovement() {
    if (!db || !session || !accounts[0]) { Alert.alert('Crie uma conta primeiro.'); return; }
    try {
      const cents = parseBrlCents(amount);
      const { error } = await db.from('transactions').insert({ user_id: session.user.id, account_id: accounts[0].id, kind, description: description.trim(), amount_cents: cents, occurred_on: new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }), status: 'settled', idempotency_key: Crypto.randomUUID() });
      if (error) throw error;
      setAmount(''); setDescription(''); await reload();
    } catch (cause) { Alert.alert('Erro', cause instanceof Error ? cause.message : 'Não foi possível salvar.'); }
  }

  async function addEvent() {
    if (!db || !session) return;
    const start = new Date(eventWhen);
    if (Number.isNaN(start.getTime())) { Alert.alert('Data inválida', 'Use AAAA-MM-DD HH:MM.'); return; }
    const end = new Date(start.getTime() + 3_600_000);
    const { error } = await db.from('calendar_events').insert({ user_id: session.user.id, title: eventTitle.trim(), starts_at: start.toISOString(), ends_at: end.toISOString(), description: '' });
    if (error) Alert.alert('Erro', error.message); else { setEventTitle(''); setEventWhen(''); await reload(); }
  }

  async function shareReport() {
    if (!session) return;
    const base = process.env.EXPO_PUBLIC_APP_URL;
    if (!base || !FileSystem.cacheDirectory) { Alert.alert('Configuração incompleta', 'Configure EXPO_PUBLIC_APP_URL.'); return; }
    setBusy(true);
    try {
      const to = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
      const from = new Date(Date.now() - 30 * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
      const response = await fetch(`${base}/api/reports/generate`, { method: 'POST', headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json', ...(await deviceHeaders()) }, body: JSON.stringify({ from, to }) });
      if (!response.ok) throw new Error((await response.json()).error ?? 'Falha no relatório.');
      const bytes = new Uint8Array(await response.arrayBuffer());
      const binary = Array.from(bytes, b => String.fromCharCode(b)).join('');
      const encoded = btoa(binary);
      const path = `${FileSystem.cacheDirectory}EXA-${from}-${to}.pdf`;
      await FileSystem.writeAsStringAsync(path, encoded, { encoding: FileSystem.EncodingType.Base64 });
      if (!(await Sharing.isAvailableAsync())) throw new Error('Compartilhamento não disponível neste aparelho.');
      await Sharing.shareAsync(path, { mimeType: 'application/pdf', dialogTitle: 'Enviar relatório pelo WhatsApp' });
      setTimeout(() => { void FileSystem.deleteAsync(path, { idempotent: true }); }, 5 * 60_000);
    } catch (cause) { Alert.alert('Relatório', cause instanceof Error ? cause.message : 'Falha ao compartilhar.'); }
    setBusy(false);
  }

  async function scanPairing(value: string) {
    setScanning(false);
    if (!session || !db) return;
    try {
      const link = new URL(value);
      const sessionId = link.searchParams.get('session');
      const nonce = link.searchParams.get('nonce');
      if (link.protocol !== 'exa:' || link.hostname !== 'pair' || !sessionId || !nonce) throw new Error('QR inválido.');
      const installation = await SecureStore.getItemAsync(mobileStorageKey('installation',session.user.id));
      const key = await SecureStore.getItemAsync(mobileStorageKey('device-key',session.user.id));
      if (!installation || !key) throw new Error('Aguarde a preparação do dispositivo.');
      const hash = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, installation);
      const keyHash = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, key);
      const { error } = await db.rpc('request_device_pairing', { p_session_id: sessionId, p_nonce: nonce, p_installation_hash: hash, p_key_hash: keyHash, p_name: 'EXA Android', p_kind: 'android' });
      if (error) throw new Error(error.message);
      setJoinLink(''); setPairingId(sessionId); setPairingStatus('Aguardando aprovação no dispositivo de origem.');
    } catch (cause) { Alert.alert('Vínculo', cause instanceof Error ? cause.message : 'Não foi possível ler o QR.'); }
  }

  useEffect(() => {
    if (!pairingId || !db) return;
    const client = db;
    const timer = setInterval(async () => {
      const { data } = await client.from('pairing_sessions').select('status,expires_at').eq('id', pairingId).maybeSingle();
      if (data?.status === 'approved') {
        setPairingStatus('Android vinculado com sucesso.'); setPairingId(null); void prepareDevice();
      }
      if (data && (data.status === 'rejected' || Date.parse(data.expires_at) <= Date.now())) { setPairingStatus('Vínculo encerrado. Gere outro QR.'); setPairingId(null); }
    }, 3000);
    return () => clearInterval(timer);
  }, [pairingId, session?.user.id]);

  async function createPair() {
    const result = await db!.rpc('create_device_pairing');
    if (result.error) Alert.alert('Vínculo',result.error.message); else setIssuedPair(result.data);
  }
  async function approvePair() {
    if (!issuedPair || !session) return;
    const source = await SecureStore.getItemAsync(mobileStorageKey('device-id',session.user.id));
    const result = await db!.rpc('approve_pairing',{ p_session_id: issuedPair.id, p_source_device_id: source });
    if (result.error) Alert.alert('Vínculo',result.error.message); else { setIssuedPair(null); void prepareDevice(); }
  }
  useEffect(() => {
    if (!issuedPair || !db) return;
    const client = db;
    const poll = setInterval(async () => {
      const { data } = await client.from('pairing_sessions').select('status,requested_device_name').eq('id',issuedPair.id).maybeSingle();
      if (data) setIssuedPair(previous => previous?.id === issuedPair.id ? { ...previous,...data } : previous);
    },3000);
    return () => clearInterval(poll);
  },[issuedPair?.id]);

  async function revokeDevice(id: string) {
    Alert.alert('Revogar dispositivo','O acesso aos dados será encerrado.',[{text:'Cancelar',style:'cancel'},{text:'Revogar',style:'destructive',onPress: async () => {
      const result = await db!.rpc('revoke_device',{p_device_id:id});
      if (result.error) Alert.alert('Dispositivo',result.error.message); else void prepareDevice();
    }}]);
  }

  if (!db) return <SafeAreaView style={styles.root}><Text style={styles.title}>EXA</Text><Text style={styles.muted}>Configure Supabase no arquivo .env do aplicativo.</Text></SafeAreaView>;
  if (busy && !session) return <SafeAreaView style={styles.root}><ActivityIndicator color="#b9efb0"/></SafeAreaView>;
  if (!session) return <SafeAreaView style={styles.root}><ScrollView contentContainerStyle={styles.content}><Text style={styles.logo}>e.</Text><Text style={styles.title}>Bem-vindo ao EXA.</Text><Text style={styles.muted}>Seu centro pessoal no Android.</Text><Field value={email} onChangeText={setEmail} placeholder="E-mail" keyboardType="email-address" autoCapitalize="none"/><Field value={password} onChangeText={setPassword} placeholder="Senha" secureTextEntry/><Button label="Entrar" onPress={() => void login(false)}/><Text style={styles.muted}>Para criar conta, informe também seu nome.</Text><Field value={name} onChangeText={setName} placeholder="Seu nome"/><Button label="Criar conta" onPress={() => void login(true)} subtle/></ScrollView></SafeAreaView>;

  return <SafeAreaView style={styles.root}><View style={styles.header}><Text style={styles.logo}>e.</Text><Text style={styles.headerTitle}>EXA</Text><Pressable onPress={() => void db?.auth.signOut()}><Text style={styles.muted}>Sair</Text></Pressable></View><ScrollView contentContainerStyle={styles.content}>
    {authorized && authorizedOwner === session.user.id && screen === 'inicio' && <><Text style={styles.kicker}>VISÃO GERAL</Text><Text style={styles.title}>Seu dia em foco.</Text><View style={styles.hero}><Text style={styles.muted}>Saldo consolidado</Text><Text style={styles.big}>{financeSummary?.balance_known ? formatBrl(financeSummary.balance_cents) : 'Não configurado'}</Text><Text style={styles.muted}>Entradas deste mês: {formatBrl(financeSummary?.income_cents ?? 0)}</Text></View><Text style={styles.section}>Últimas movimentações</Text>{movements.slice(0,5).map(m => <Row key={m.id} title={m.description} detail={`${m.occurred_on} · ${formatBrl(m.amount_cents)}`}/>)}</>}
    {authorized && authorizedOwner === session.user.id && screen === 'financas' && <><Text style={styles.kicker}>FINANÇAS</Text><Text style={styles.title}>Lançamentos</Text><Text style={styles.section}>Contas</Text>{accounts.map(a => <Row key={a.id} title={a.name} detail={financeSummary?.account_balances?.[a.id] == null ? 'Saldo não configurado' : formatBrl(financeSummary.account_balances[a.id]!)}/>)}<Field value={name} onChangeText={setName} placeholder="Nova conta"/><Field value={openingBalance} onChangeText={setOpeningBalance} placeholder="Saldo inicial opcional: 100 ou 100,50" keyboardType="decimal-pad"/><Button label="Criar conta" onPress={() => void addAccount()} subtle/><Text style={styles.section}>Novo lançamento (primeira conta)</Text><View style={styles.choice}><Button label="Despesa" onPress={() => setKind('expense')} subtle={kind !== 'expense'}/><Button label="Receita" onPress={() => setKind('income')} subtle={kind !== 'income'}/></View><Field value={description} onChangeText={setDescription} placeholder="Descrição"/><Field value={amount} onChangeText={setAmount} placeholder="Valor: 39,90" keyboardType="decimal-pad"/><Button label="Salvar lançamento" onPress={() => void addMovement()}/><Text style={styles.section}>Histórico</Text>{movements.map(m => <Row key={m.id} title={m.description} detail={`${m.occurred_on} · ${formatBrl(m.amount_cents)}`}/>)}</>}
    {authorized && authorizedOwner === session.user.id && screen === 'agenda' && <><Text style={styles.kicker}>AGENDA</Text><Text style={styles.title}>Compromissos</Text><Field value={eventTitle} onChangeText={setEventTitle} placeholder="Título"/><Field value={eventWhen} onChangeText={setEventWhen} placeholder="AAAA-MM-DD HH:MM"/><Button label="Criar evento de 1 hora" onPress={() => void addEvent()}/>{events.map(e => <Row key={e.id} title={e.title} detail={new Date(e.starts_at).toLocaleString('pt-BR')}/>)}</>}
    {authorized && authorizedOwner === session.user.id && screen === 'relatorio' && <><Text style={styles.kicker}>RELATÓRIOS</Text><Text style={styles.title}>Relatório em PDF</Text><Text style={styles.muted}>Gere os últimos 30 dias e escolha WhatsApp no compartilhamento do Android.</Text><View style={{ height: 24 }}/><Button label={busy ? 'Gerando…' : 'Gerar e compartilhar PDF'} onPress={() => void shareReport()}/></>}
    {screen === 'vinculo' && <><Text style={styles.kicker}>DISPOSITIVOS</Text><Text style={styles.title}>Dispositivos vinculados</Text><Text style={styles.muted}>{pairingStatus}</Text><Button label="Verificar autorização" onPress={() => void prepareDevice()} subtle/>{!authorized ? <><Text style={styles.muted}>Entre na mesma conta em um dispositivo autorizado. Gere um vínculo nas Configurações, leia o QR ou cole o código, e aprove na origem.</Text><Field value={joinLink} onChangeText={setJoinLink} placeholder="exa://pair?..." autoCapitalize="none"/><Button label="Solicitar vínculo" onPress={() => void scanPairing(joinLink)}/>{scanning ? cameraPermission?.granted ? <CameraView style={{ height: 320 }} barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={({ data }) => void scanPairing(data)}/> : <Button label="Permitir câmera" onPress={() => void requestCameraPermission()}/> : <Button label="Ler QR" onPress={() => setScanning(true)}/>}</> : <><Button label="Gerar vínculo para outro dispositivo" onPress={() => void createPair()}/>{issuedPair && <><Text selectable style={styles.muted}>{issuedPair.link}</Text><Text style={styles.muted}>Expira em {new Date(issuedPair.expires_at).toLocaleTimeString('pt-BR')}. Compartilhe apenas com seu próprio dispositivo.</Text>{issuedPair.status === 'requested' && <Button label={`Aprovar ${issuedPair.requested_device_name ?? 'dispositivo'}`} onPress={() => void approvePair()}/>}</>}{devices.map(device => <View key={device.id}><Row title={device.name} detail={device.kind}/><Button label="Revogar" onPress={() => void revokeDevice(device.id)} subtle/></View>)}</>}</>}
  </ScrollView><View style={styles.bottom}>{((authorized ? ['inicio','financas','agenda','relatorio','vinculo'] : ['vinculo']) as Screen[]).map(item => <Pressable key={item} onPress={() => setScreen(item)} style={styles.tab}><Text style={[styles.tabText, screen === item && styles.selected]}>{item === 'inicio' ? 'Início' : item === 'financas' ? 'Finanças' : item === 'agenda' ? 'Agenda' : item === 'vinculo' ? 'Vínculo' : 'PDF'}</Text></Pressable>)}</View></SafeAreaView>;
}

function Field(props: React.ComponentProps<typeof TextInput>) { return <TextInput {...props} placeholderTextColor="#82938f" style={styles.input}/>; }
function Button({ label, onPress, subtle = false }: { label: string; onPress: () => void; subtle?: boolean }) { return <Pressable onPress={onPress} style={[styles.button, subtle && styles.subtle]}><Text style={[styles.buttonText, subtle && styles.subtleText]}>{label}</Text></Pressable>; }
function Row({ title, detail }: { title: string; detail: string }) { return <View style={styles.row}><Text style={styles.rowTitle}>{title}</Text><Text style={styles.muted}>{detail}</Text></View>; }

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0d1115' }, content: { padding: 22, paddingBottom: 45, gap: 13 },
  header: { height: 64, borderBottomWidth: 1, borderColor: '#2a3338', paddingHorizontal: 22, flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerTitle: { color: '#e8f3eb', fontSize: 18, fontWeight: '800', flex: 1 },
  logo: { width: 35, height: 35, textAlign: 'center', textAlignVertical: 'center', borderRadius: 9, backgroundColor: '#b9efb0', color: '#17251b', fontSize: 24, fontWeight: '900' },
  kicker: { color: '#b9efb0', fontSize: 10, letterSpacing: 2, fontWeight: '800', marginTop: 15 },
  title: { color: '#eff6f0', fontSize: 30, fontWeight: '800', marginBottom: 6 }, muted: { color: '#9aa9a5', fontSize: 12, lineHeight: 19 },
  section: { color: '#eff6f0', fontSize: 17, fontWeight: '700', marginTop: 20 },
  hero: { backgroundColor: '#223d2d', borderRadius: 16, padding: 22, gap: 8, marginTop: 12 }, big: { color: '#fff', fontSize: 28, fontWeight: '800' },
  row: { borderBottomWidth: 1, borderColor: '#2a3338', paddingVertical: 15, gap: 5 }, rowTitle: { color: '#edf3ee', fontSize: 14, fontWeight: '700' },
  input: { backgroundColor: '#1a2226', color: '#f0f4f1', borderWidth: 1, borderColor: '#39474a', borderRadius: 9, minHeight: 48, paddingHorizontal: 14, marginTop: 3 },
  button: { backgroundColor: '#b9efb0', borderRadius: 9, minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 15 }, buttonText: { color: '#18261b', fontWeight: '800' },
  subtle: { backgroundColor: '#293638', borderWidth: 1, borderColor: '#40504b' }, subtleText: { color: '#ecf4ed' }, choice: { flexDirection: 'row', gap: 8 },
  bottom: { flexDirection: 'row', borderTopWidth: 1, borderColor: '#2a3338', paddingTop: 13, paddingBottom: 11 }, tab: { flex: 1, alignItems: 'center' }, tabText: { color: '#84958f', fontSize: 11, fontWeight: '700' }, selected: { color: '#b9efb0' }
});
