import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

const night = '2026-10-28';
const temporaryDirectories: string[] = [];

function runsDirectory(contents?: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'rig-digest-routes-'));
  temporaryDirectories.push(dir);
  if (contents !== undefined) writeFileSync(join(dir, `${night}.jsonl`), contents);
  return dir;
}

function appFor(contents?: string) {
  return createApp({
    adapter: 'shim',
    installed: '2026-10-29T14:06:00+01:00',
    beatEverySeconds: 60,
    runsDir: runsDirectory(contents),
  });
}

afterEach(() => {
  for (const dir of temporaryDirectories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('digest routes', () => {
  it('renders sorted rows and returns the same digest as JSON', async () => {
    const events = [
      { at: '2026-10-28T23:00:00+03:00', job: 'omega', owner: null, status: 'ok' },
      { at: '2026-10-28T23:01:00+03:00', job: 'alpha', owner: 'rook', status: 'retry', error: 'temporary issue' },
      { at: '2026-10-28T23:02:00+03:00', job: 'alpha', owner: 'rook', status: 'retry', error: 'temporary issue' },
      { at: '2026-10-28T23:03:00+03:00', job: 'alpha', owner: 'rook', status: 'retry', error: 'temporary issue' },
      { at: '2026-10-28T23:04:00+03:00', job: 'alpha', owner: 'rook', status: 'fail', error: 'can’t <run> & recover' },
    ].map((event) => JSON.stringify(event)).join('\n');
    const app = appFor(events);

    const page = await app.request(`/digest/${night}`);
    const html = await page.text();
    expect(page.status).toBe(200);
    expect(html.indexOf('>alpha</td>')).toBeLessThan(html.indexOf('>omega</td>'));
    expect(html).toContain('<td>—</td>');
    expect(html).toContain('2026-10-28T23:00:00+03:00');
    expect(html).toContain('2026-10-28T23:04:00+03:00');
    expect(html).toContain('can’t &lt;run&gt; &amp; recover');
    expect(html).toContain('<td class="warn">3</td>');
    expect(html).toContain('<td class="warn">fail</td>');

    const api = await app.request(`/api/digest/${night}`);
    expect(api.status).toBe(200);
    expect(await api.json()).toEqual({
      rows: [
        {
          job: 'alpha', owner: 'rook', runs: 4, retries: 3, lastStatus: 'fail',
          lastError: 'can’t <run> & recover',
          firstAt: '2026-10-28T23:01:00+03:00', lastAt: '2026-10-28T23:04:00+03:00',
        },
        {
          job: 'omega', owner: null, runs: 1, retries: 0, lastStatus: 'ok', lastError: null,
          firstAt: '2026-10-28T23:00:00+03:00', lastAt: '2026-10-28T23:00:00+03:00',
        },
      ],
      badLines: 0,
      counts: { ok: 1, retry: 3, fail: 1 },
    });
  });

  it('returns 404 from both routes when the night file is missing', async () => {
    const app = appFor();
    expect((await app.request(`/digest/${night}`)).status).toBe(404);
    expect((await app.request(`/api/digest/${night}`)).status).toBe(404);
  });

  it('renders an empty night and returns empty rows and counts', async () => {
    const app = appFor('');

    const page = await app.request(`/digest/${night}`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('nothing ran');

    const api = await app.request(`/api/digest/${night}`);
    expect(api.status).toBe(200);
    expect(await api.json()).toEqual({
      rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it('counts malformed lines while both routes still return 200', async () => {
    const event = JSON.stringify({
      at: '2026-10-28T23:00:00-04:00', job: 'refresh', owner: null, status: 'ok',
    });
    const app = appFor(`{malformed\n${event}\n`);

    const page = await app.request(`/digest/${night}`);
    const html = await page.text();
    expect(page.status).toBe(200);
    expect(html).toContain('malformed lines: 1');
    expect(html).toContain('>refresh</td>');
    expect(html).toContain('<td>—</td>');

    const api = await app.request(`/api/digest/${night}`);
    expect(api.status).toBe(200);
    expect(await api.json()).toEqual({
      rows: [{
        job: 'refresh', owner: null, runs: 1, retries: 0, lastStatus: 'ok', lastError: null,
        firstAt: '2026-10-28T23:00:00-04:00', lastAt: '2026-10-28T23:00:00-04:00',
      }],
      badLines: 1,
      counts: { ok: 1, retry: 0, fail: 0 },
    });
  });

  it('returns 404 for invalid nights on both routes', async () => {
    const app = appFor('');
    expect((await app.request('/digest/2026-02-30')).status).toBe(404);
    expect((await app.request('/api/digest/2026-02-30')).status).toBe(404);
  });
});
