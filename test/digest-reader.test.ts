import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/reader.js';

const temporaryDirectories: string[] = [];

function runsDirectory(contents?: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'rig-digest-'));
  temporaryDirectories.push(dir);
  if (contents !== undefined) writeFileSync(join(dir, '2026-10-28.jsonl'), contents);
  return dir;
}

afterEach(() => {
  for (const dir of temporaryDirectories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('readNight', () => {
  it('reads the real night with five sorted jobs and one bad line', () => {
    expect(readNight('runs', '2026-10-28')).toEqual({
      rows: [
        {
          job: 'digest/render', owner: null, runs: 1, retries: 0, lastStatus: 'ok', lastError: null,
          firstAt: '2026-10-29T05:41:09+01:00', lastAt: '2026-10-29T05:41:09+01:00',
        },
        {
          job: 'fixtures/refresh', owner: 'rook', runs: 4, retries: 3, lastStatus: 'ok', lastError: 'upstream 503',
          firstAt: '2026-10-29T01:30:00+01:00', lastAt: '2026-10-29T01:37:00+01:00',
        },
        {
          job: 'lane/sync', owner: 'rook', runs: 8, retries: 1, lastStatus: 'ok', lastError: 'lock held',
          firstAt: '2026-10-28T23:00:06+01:00', lastAt: '2026-10-29T05:00:04+01:00',
        },
        {
          job: 'notes/backup', owner: 'lane-07', runs: 1, retries: 0, lastStatus: 'fail', lastError: 'quota exceeded',
          firstAt: '2026-10-29T04:00:01+01:00', lastAt: '2026-10-29T04:00:01+01:00',
        },
        {
          job: 'rig/rotate-logs', owner: 'lane-07', runs: 1, retries: 0, lastStatus: 'ok', lastError: null,
          firstAt: '2026-10-28T23:00:02+01:00', lastAt: '2026-10-28T23:00:02+01:00',
        },
      ],
      badLines: 1,
      counts: { ok: 10, retry: 4, fail: 1 },
    });
  });

  it('distinguishes an empty night from a missing night', () => {
    expect(readNight(runsDirectory(''), '2026-10-28')).toEqual({
      rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 },
    });
    expect(readNight(runsDirectory(), '2026-10-28')).toBeNull();
  });

  it('counts malformed JSON and invalid event schemas without dropping valid null owners', () => {
    const valid = { at: '2026-10-28T23:00:00+01:00', job: '__proto__', owner: null, status: 'ok' };
    const invalid = [
      null, [], 7, 'text', {},
      { ...valid, at: 0 },
      { ...valid, at: 'yesterday' },
      { ...valid, at: '2026-02-30T23:00:00+01:00' },
      { ...valid, at: '2026-10-28T23:00:00' },
      { ...valid, job: 7 },
      { ...valid, job: ' ' },
      { ...valid, status: 'pending' },
      { ...valid, owner: 7 },
      { at: valid.at, job: valid.job, status: valid.status },
      { ...valid, error: 7 },
      { ...valid, error: null },
    ];
    const contents = [...invalid.map((event) => JSON.stringify(event)), '{broken', JSON.stringify(valid)].join('\r\n') + '\r\n';
    expect(readNight(runsDirectory(contents), '2026-10-28')).toEqual({
      rows: [{
        job: '__proto__', owner: null, runs: 1, retries: 0, lastStatus: 'ok', lastError: null,
        firstAt: '2026-10-28T23:00:00+01:00', lastAt: '2026-10-28T23:00:00+01:00',
      }],
      badLines: 17,
      counts: { ok: 1, retry: 0, fail: 0 },
    });
  });

  it('compares actual instants while retaining offsets and the latest error after recovery', () => {
    const contents = [
      { at: '2026-10-28T23:30:00-02:00', job: 'sync', owner: null, status: 'ok' },
      { at: '2026-10-29T00:30:00Z', job: 'sync', owner: 'new', status: 'retry', error: 'new error' },
      { at: '2026-10-29T01:00:00+02:00', job: 'sync', owner: 'old', status: 'fail', error: 'old error' },
    ].map((event) => JSON.stringify(event)).join('\n');
    expect(readNight(runsDirectory(contents), '2026-10-28')).toEqual({
      rows: [{
        job: 'sync', owner: null, runs: 3, retries: 1, lastStatus: 'ok', lastError: 'new error',
        firstAt: '2026-10-29T01:00:00+02:00', lastAt: '2026-10-28T23:30:00-02:00',
      }],
      badLines: 0,
      counts: { ok: 1, retry: 1, fail: 1 },
    });
  });

  it('uses the later line for events at the same instant', () => {
    const contents = [
      { at: '2026-10-28T23:00:00Z', job: 'sync', owner: 'old', status: 'fail', error: 'old error' },
      { at: '2026-10-29T00:00:00+01:00', job: 'sync', owner: null, status: 'retry', error: 'new error' },
    ].map((event) => JSON.stringify(event)).join('\n');
    expect(readNight(runsDirectory(contents), '2026-10-28')).toEqual({
      rows: [{
        job: 'sync', owner: null, runs: 2, retries: 1, lastStatus: 'retry', lastError: 'new error',
        firstAt: '2026-10-28T23:00:00Z', lastAt: '2026-10-29T00:00:00+01:00',
      }],
      badLines: 0,
      counts: { ok: 0, retry: 1, fail: 1 },
    });
  });

  it.each(['../2026-10-28', '/2026-10-28', '2026-10-28/other', '2026-10-28\0', '2026-02-30', '2026-13-01'])(
    'rejects invalid night %s before reading a path', (night) => {
      const dir = runsDirectory('');
      const nested = join(dir, 'nested');
      mkdirSync(nested);
      expect(readNight(nested, night)).toBeNull();
    },
  );

  it('propagates unexpected filesystem failures', () => {
    const dir = runsDirectory();
    mkdirSync(join(dir, '2026-10-28.jsonl'));
    expect(() => readNight(dir, '2026-10-28')).toThrow();
  });
});
