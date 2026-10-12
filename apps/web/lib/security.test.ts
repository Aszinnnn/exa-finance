import { describe, expect, it, vi } from 'vitest';
vi.mock('./server-supabase', () => ({ serverDb: vi.fn() }));
import { limitedJson } from './security';

function request(body: string, headers: Record<string,string> = {}) {
  return new Request('https://exa.invalid/api/test', { method: 'POST', body,
    headers: { 'content-type': 'application/json', ...headers } });
}

describe('bounded JSON input', () => {
  it('accepts valid JSON', async () => expect(await limitedJson(request('{"amount":100}'))).toEqual({amount:100}));
  it('accepts JSON with charset', async () => expect(await limitedJson(request('{}',{'content-type':'application/json; charset=utf-8'}))).toEqual({}));
  it('rejects form submissions (CSRF)', async () => expect(await limitedJson(request('{}',{'content-type':'application/x-www-form-urlencoded'}))).toBeNull());
  it('rejects text content type', async () => expect(await limitedJson(request('{}',{'content-type':'text/plain'}))).toBeNull());
  it('rejects malformed JSON', async () => expect(await limitedJson(request('{'))).toBeNull());
  it('rejects advertised oversized payload', async () => expect(await limitedJson(request('{}',{'content-length':'9000'}))).toBeNull());
  it('rejects oversized body without trusting content length', async () => expect(await limitedJson(request(JSON.stringify('a'.repeat(9000)),{'content-length':'1'}))).toBeNull());
  it('counts bytes rather than characters', async () => expect(await limitedJson(request(JSON.stringify('é'.repeat(5000))))).toBeNull());
  it('rejects absent body', async () => expect(await limitedJson(new Request('https://exa.invalid',{method:'POST',headers:{'content-type':'application/json'}}))).toBeNull());
  it('keeps SQL-like text as data', async () => expect(await limitedJson(request(JSON.stringify({name:"'; DROP TABLE users; --"})))).toEqual({name:"'; DROP TABLE users; --"}));
});
