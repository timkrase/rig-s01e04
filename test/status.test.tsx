import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

const config = { adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir: 'runs' };

describe('status board', () => {
  it('links each night to its digest and shows event counts', async () => {
    process.env.LANE_MARKER = 'TEST-MARKER';
    const app = createApp(config);
    const board = await app.request('/');
    const html = await board.text();

    expect(board.status).toBe(200);
    expect(html).toContain('TEST-MARKER');
    expect(html).toContain('<a href="/digest/2026-10-28">2026-10-28</a>');
    expect(html).toContain('ok 10 · retry 4 · fail 1');
    expect(html).toContain('<a href="/digest/2026-10-27">2026-10-27</a>');
    expect(html).toContain('ok 7 · retry 0 · fail 0');

    for (const night of ['2026-10-28', '2026-10-27']) {
      const digest = await app.request(`/digest/${night}`);
      expect(digest.status).toBe(200);
    }
  });

  it('health answers with the lane id', async () => {
    const res = await createApp(config).request('/health');
    expect(await res.json()).toEqual({ ok: true, lane: 'lane-07' });
  });
});
