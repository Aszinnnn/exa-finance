'use client';

import { useEffect, useState } from 'react';
import { browserDb } from '@/lib/supabase';

// Shared promise prevents consuming a one-time code twice in StrictMode.
let verification: Promise<void> | undefined;
async function confirm() {
  const db = browserDb();
  const params = new URLSearchParams(window.location.search);
  const fragment = new URLSearchParams(window.location.hash.slice(1));
  if (params.has('error') || fragment.has('error')) throw new Error('Link expirado ou inválido. Solicite outro e-mail.');
  const tokenHash = params.get('token_hash');
  const code = params.get('code');
  if (tokenHash) {
    const type = params.get('type');
    if (type !== 'signup' && type !== 'email') throw new Error('Tipo de confirmação inválido.');
    const { error } = await db.auth.verifyOtp({ token_hash: tokenHash, type });
    if (error) throw new Error('Não foi possível confirmar. Solicite outro e-mail.');
  } else if (code) {
    const { error } = await db.auth.exchangeCodeForSession(code);
    if (error) throw new Error('Abra este link no navegador usado no cadastro ou entre novamente.');
  } else {
    await db.auth.getSession(); // Supabase consumes the implicit-flow fragment.
  }
  const { data, error } = await db.auth.getUser();
  if (error || !data.user?.email_confirmed_at) throw new Error('Entre com sua senha para conferir a confirmação do e-mail.');
}

export default function ConfirmPage() {
  const [message, setMessage] = useState('Confirmando seu e-mail…');
  useEffect(() => {
    verification ??= confirm();
    void verification.then(() => window.location.replace('/')).catch(error => {
      window.history.replaceState({}, '', '/auth/confirm');
      setMessage(error instanceof Error ? error.message : 'Falha na confirmação.');
    });
  }, []);
  return <main className="setup"><h1>Confirmação de conta</h1><p role="status">{message}</p><a href="/">Voltar para entrar ou reenviar confirmação</a></main>;
}
