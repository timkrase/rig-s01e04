import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestRow, NightDigest, ReadNight } from './types.js';

type RunEvent = {
  at: string;
  time: number;
  job: string;
  status: DigestRow['lastStatus'];
  owner: string | null;
  error: string | null;
};

function isNight(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

function parseEvent(line: string): RunEvent | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  if (!('at' in value) || typeof value.at !== 'string') return null;
  if (!('job' in value) || typeof value.job !== 'string' || value.job.trim() === '') return null;
  if (!('status' in value) || (value.status !== 'ok' && value.status !== 'retry' && value.status !== 'fail')) return null;
  if (!('owner' in value) || (value.owner !== null && typeof value.owner !== 'string')) return null;
  let error: string | null = null;
  if ('error' in value) {
    if (typeof value.error !== 'string') return null;
    error = value.error;
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value.at)) return null;
  const time = Date.parse(value.at);
  if (!isNight(value.at.slice(0, 10)) || !Number.isFinite(time)) return null;
  return {
    at: value.at,
    time,
    job: value.job,
    status: value.status,
    owner: value.owner,
    error,
  };
}

export const readNight: ReadNight = (runsDir, night) => {
  if (!isNight(night)) return null;
  let contents: string;
  try {
    contents = readFileSync(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }

  const digest: NightDigest = { rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 } };
  const jobs = new Map<string, { row: DigestRow; firstTime: number; lastTime: number; errorTime: number }>();
  for (const line of contents.split(/\r?\n/)) {
    if (line.trim() === '') continue;
    const event = parseEvent(line);
    if (event === null) {
      digest.badLines++;
      continue;
    }
    digest.counts[event.status]++;
    const job = jobs.get(event.job);
    if (!job) {
      jobs.set(event.job, {
        row: {
          job: event.job,
          owner: event.owner,
          runs: 1,
          retries: event.status === 'retry' ? 1 : 0,
          lastStatus: event.status,
          lastError: event.error,
          firstAt: event.at,
          lastAt: event.at,
        },
        firstTime: event.time,
        lastTime: event.time,
        errorTime: event.error === null ? -Infinity : event.time,
      });
      continue;
    }
    job.row.runs++;
    if (event.status === 'retry') job.row.retries++;
    if (event.time < job.firstTime) {
      job.firstTime = event.time;
      job.row.firstAt = event.at;
    }
    if (event.time >= job.lastTime) {
      job.lastTime = event.time;
      job.row.lastAt = event.at;
      job.row.lastStatus = event.status;
      job.row.owner = event.owner;
    }
    if (event.error !== null && event.time >= job.errorTime) {
      job.errorTime = event.time;
      job.row.lastError = event.error;
    }
  }
  digest.rows = [...jobs.values()].map(({ row }) => row).sort((a, b) => a.job.localeCompare(b.job));
  return digest;
};
