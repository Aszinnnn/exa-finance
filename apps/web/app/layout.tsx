import type { Metadata } from 'next';
import { headers } from 'next/headers';
import './style.css';

export const metadata: Metadata = { title: 'EXA — Centro pessoal', description: 'Finanças, agenda e relatórios em um só lugar.', robots: { index: false, follow: false } };

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  await headers(); // A nonce precisa ser aplicado no HTML de cada requisição.
  return <html lang="pt-BR"><body>{children}</body></html>;
}
