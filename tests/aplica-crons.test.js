// O deploy aplica os crons do wrangler.toml — scripts/aplica-crons.mjs.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { cronsDoToml, cronsDaApi, mesmosCrons, aplicaCrons, CRONS_DO_WORKER } from '../scripts/aplica-crons.mjs';

/** Uma API falsa: guarda os agendamentos e anota as chamadas. */
function apiFalsa(inicial, op = {}) {
  let atuais = inicial.map(cron => ({ cron }));
  const chamadas = [];
  const fetchFn = async (url, init = {}) => {
    chamadas.push({ url, metodo: init.method || 'GET', corpo: init.body });
    if (op.status) return new Response(JSON.stringify({ success: false, errors: [{ code: 10000, message: 'Authentication error' }] }), { status: op.status });
    if (init.method === 'PUT' && !op.ignoraPut) atuais = JSON.parse(init.body);
    return new Response(JSON.stringify({ success: true, result: { schedules: atuais } }));
  };
  return { fetchFn, chamadas };
}
const base = { conta: 'c1', worker: 'fotos', token: 't' };

describe('cronsDoToml', () => {
  it('lê os crons do topo e ignora os de um [env.x]', () => {
    const toml = '[vars]\nA = "1"\n\n[env.previa.triggers]\ncrons = ["0 1 * * *"]\n\n[triggers]\n# comentário\ncrons = ["*/5 * * * *"] # a cada 5 min\n';
    expect(cronsDoToml(toml)).toEqual(['*/5 * * * *']);
  });
  it('o wrangler.toml de verdade pede o cron de 5 em 5 minutos', () => {
    expect(cronsDoToml(readFileSync('wrangler.toml', 'utf8'))).toEqual(['*/5 * * * *']);
  });
  it('CRONS_DO_WORKER bate com o wrangler.toml (o que vai para a API é a constante)', () => {
    expect(mesmosCrons(cronsDoToml(readFileSync('wrangler.toml', 'utf8')), [...CRONS_DO_WORKER])).toBe(true);
  });
  it('sem crons, ou com lixo, reprova', () => {
    expect(() => cronsDoToml('[vars]\nA = "1"\n')).toThrow(/sem `crons`/);
    expect(() => cronsDoToml('[triggers]\ncrons = [1]\n')).toThrow(/inválidos/);
  });
});

describe('cronsDaApi e mesmosCrons', () => {
  it('aceita result.schedules e result como lista; recusa o resto', () => {
    expect(cronsDaApi({ result: { schedules: [{ cron: '0 3 * * *' }] } })).toEqual(['0 3 * * *']);
    expect(cronsDaApi({ result: [{ cron: '*/5 * * * *' }] })).toEqual(['*/5 * * * *']);
    expect(() => cronsDaApi({ result: {} })).toThrow(/sem a lista/);
  });
  it('compara como conjunto', () => {
    expect(mesmosCrons(['a', 'b'], ['b', 'a', 'a'])).toBe(true);
    expect(mesmosCrons(['a'], ['a', 'b'])).toBe(false);
    expect(mesmosCrons([], [])).toBe(true);
  });
});

describe('aplicaCrons', () => {
  it('troca o das 03:00 pelo de 5 em 5 minutos, e confere relendo', async () => {
    const { fetchFn, chamadas } = apiFalsa(['0 3 * * *']);
    const r = await aplicaCrons({ ...base, desejados: ['*/5 * * * *'], fetchFn });
    expect(r).toEqual({ antes: ['0 3 * * *'], depois: ['*/5 * * * *'], mudou: true });
    expect(chamadas.map(c => c.metodo)).toEqual(['GET', 'PUT', 'GET']);
    expect(JSON.parse(chamadas[1].corpo)).toEqual([{ cron: '*/5 * * * *' }]);
    expect(chamadas[0].url).toBe('https://api.cloudflare.com/client/v4/accounts/c1/workers/scripts/fotos/schedules');
  });
  it('já igual: só lê, não grava', async () => {
    const { fetchFn, chamadas } = apiFalsa(['*/5 * * * *']);
    const r = await aplicaCrons({ ...base, desejados: ['*/5 * * * *'], fetchFn });
    expect(r.mudou).toBe(false);
    expect(chamadas.map(c => c.metodo)).toEqual(['GET']);
  });
  it('a API não aplicou: reprova com o que ficou lá', async () => {
    const { fetchFn } = apiFalsa(['0 3 * * *'], { ignoraPut: true });
    await expect(aplicaCrons({ ...base, desejados: ['*/5 * * * *'], fetchFn })).rejects.toThrow(/depois do PUT/);
  });
  it('erro da API reprova com o código e a mensagem', async () => {
    const { fetchFn } = apiFalsa([], { status: 403 });
    await expect(aplicaCrons({ ...base, desejados: ['*/5 * * * *'], fetchFn })).rejects.toThrow(/403 \(10000: Authentication error\)/);
  });
});

describe('deploy.yml', () => {
  it('roda o script depois da promoção, com o token e a conta', () => {
    const wf = readFileSync('.github/workflows/deploy.yml', 'utf8');
    const promo = wf.indexOf('name: Promover para produção');
    const passo = wf.indexOf('node scripts/aplica-crons.mjs');
    expect(promo).toBeGreaterThan(0);
    expect(passo).toBeGreaterThan(promo);
    const trecho = wf.slice(wf.lastIndexOf('- name:', passo), passo);
    expect(trecho).toContain('CLOUDFLARE_API_TOKEN');
    expect(trecho).toContain('CLOUDFLARE_ACCOUNT_ID');
  });
});
