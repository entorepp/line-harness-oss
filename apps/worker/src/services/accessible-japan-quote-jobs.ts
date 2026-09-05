import { ACCESSIBLE_JAPAN_FORM_ID } from '@line-crm/shared';

type QuoteJobEnv = {
  DB: D1Database;
  ACCESSIBLE_JAPAN_QUOTE_INTAKE_URL?: string;
  ACCESSIBLE_JAPAN_QUOTE_INTAKE_TOKEN?: string;
};

type QuoteJobRow = {
  submission_id: string;
  status: 'pending' | 'processing' | 'retry' | 'complete' | 'failed';
  attempts: number;
  next_attempt_at: string;
  lease_until: string | null;
  case_id: string | null;
};

type SubmissionRow = {
  id: string;
  form_id: string;
  data: string;
  created_at: string;
};

const ENDPOINT_PATH = '/api/integrations/accessible-japan-quote-intents';
const LEASE_MILLISECONDS = 5 * 60_000;
// The form currently permits 12 city periods and TravelWorker caps each city
// at 20 resumable search passes. Keep a small allowance for transient HTTP
// failures while retaining an explicit external-call circuit breaker.
const MAX_ATTEMPTS = 260;

function nowIso(offsetMilliseconds = 0): string {
  return new Date(Date.now() + offsetMilliseconds).toISOString();
}

function retryDelayMilliseconds(attempts: number): number {
  return Math.min(15 * 60_000, 30_000 * (2 ** Math.min(5, Math.max(0, attempts - 1))));
}

function configuredEndpoint(env: QuoteJobEnv): URL | null {
  const raw = env.ACCESSIBLE_JAPAN_QUOTE_INTAKE_URL?.trim();
  const token = env.ACCESSIBLE_JAPAN_QUOTE_INTAKE_TOKEN?.trim();
  if (!raw || !token) return null;
  try {
    const url = new URL(raw);
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    if ((!local && url.protocol !== 'https:') || url.username || url.password || url.pathname !== ENDPOINT_PATH) {
      return null;
    }
    url.search = '';
    url.hash = '';
    return url;
  } catch {
    return null;
  }
}

export async function enqueueAccessibleJapanQuoteJob(
  db: D1Database,
  submissionId: string,
): Promise<void> {
  await db.prepare(
    `INSERT OR IGNORE INTO accessible_japan_quote_jobs
      (submission_id, status, attempts, next_attempt_at, created_at, updated_at)
     VALUES (?, 'pending', 0, ?, ?, ?)`,
  ).bind(submissionId, nowIso(), nowIso(), nowIso()).run();
}

async function dueJobs(
  db: D1Database,
  submissionId: string | undefined,
  limit: number,
): Promise<QuoteJobRow[]> {
  const due = nowIso();
  const query = submissionId
    ? `SELECT submission_id, status, attempts, next_attempt_at, lease_until, case_id
       FROM accessible_japan_quote_jobs
       WHERE submission_id = ?
         AND ((status IN ('pending', 'retry') AND next_attempt_at <= ?)
           OR (status = 'processing' AND COALESCE(lease_until, '') <= ?))
       LIMIT 1`
    : `SELECT submission_id, status, attempts, next_attempt_at, lease_until, case_id
       FROM accessible_japan_quote_jobs
       WHERE ((status IN ('pending', 'retry') AND next_attempt_at <= ?)
         OR (status = 'processing' AND COALESCE(lease_until, '') <= ?))
       ORDER BY next_attempt_at, created_at
       LIMIT ?`;
  const statement = submissionId
    ? db.prepare(query).bind(submissionId, due, due)
    : db.prepare(query).bind(due, due, limit);
  const result = await statement.all<QuoteJobRow>();
  return result.results || [];
}

async function claimJob(db: D1Database, row: QuoteJobRow): Promise<QuoteJobRow | null> {
  const now = nowIso();
  const claimed = await db.prepare(
    `UPDATE accessible_japan_quote_jobs
     SET status = 'processing', attempts = attempts + 1, lease_until = ?, updated_at = ?
     WHERE submission_id = ?
       AND ((status IN ('pending', 'retry') AND next_attempt_at <= ?)
         OR (status = 'processing' AND COALESCE(lease_until, '') <= ?))`,
  ).bind(nowIso(LEASE_MILLISECONDS), now, row.submission_id, now, now).run();
  if (!claimed.meta.changes) return null;
  return db.prepare(
    `SELECT submission_id, status, attempts, next_attempt_at, lease_until, case_id
     FROM accessible_japan_quote_jobs WHERE submission_id = ?`,
  ).bind(row.submission_id).first<QuoteJobRow>();
}

async function markRetry(db: D1Database, job: QuoteJobRow, errorCode: string): Promise<void> {
  const failed = job.attempts >= MAX_ATTEMPTS;
  await db.prepare(
    `UPDATE accessible_japan_quote_jobs
     SET status = ?, next_attempt_at = ?, lease_until = NULL, last_error_code = ?, updated_at = ?
     WHERE submission_id = ?`,
  ).bind(
    failed ? 'failed' : 'retry',
    nowIso(retryDelayMilliseconds(job.attempts)),
    errorCode.slice(0, 100),
    nowIso(),
    job.submission_id,
  ).run();
}

async function processOne(env: QuoteJobEnv, job: QuoteJobRow, endpoint: URL): Promise<void> {
  const submission = await env.DB.prepare(
    `SELECT id, form_id, data, created_at FROM form_submissions WHERE id = ? AND form_id = ?`,
  ).bind(job.submission_id, ACCESSIBLE_JAPAN_FORM_ID).first<SubmissionRow>();
  if (!submission) {
    await env.DB.prepare(
      `UPDATE accessible_japan_quote_jobs
       SET status = 'failed', lease_until = NULL, last_error_code = 'submission_not_found', updated_at = ?
       WHERE submission_id = ?`,
    ).bind(nowIso(), job.submission_id).run();
    return;
  }
  let submissionData: Record<string, unknown>;
  try {
    const parsed = JSON.parse(submission.data);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid');
    submissionData = parsed as Record<string, unknown>;
  } catch {
    await env.DB.prepare(
      `UPDATE accessible_japan_quote_jobs
       SET status = 'failed', lease_until = NULL, last_error_code = 'invalid_submission_json', updated_at = ?
       WHERE submission_id = ?`,
    ).bind(nowIso(), job.submission_id).run();
    return;
  }
  try {
    const response = await fetch(endpoint.toString(), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-accessible-japan-quote-token': env.ACCESSIBLE_JAPAN_QUOTE_INTAKE_TOKEN!.trim(),
      },
      body: JSON.stringify({
        formId: submission.form_id,
        submissionId: submission.id,
        submittedAt: submission.created_at,
        submissionData,
      }),
    });
    let result: Record<string, unknown> = {};
    try {
      const parsed = await response.json();
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        result = parsed as Record<string, unknown>;
      }
    } catch {
      result = {};
    }
    const resultStatus = typeof result.status === 'string' ? result.status : '';
    const caseId = typeof result.caseId === 'string' ? result.caseId.slice(0, 191) : '';
    if (response.ok && ['ready', 'needs_review'].includes(resultStatus)) {
      await env.DB.prepare(
        `UPDATE accessible_japan_quote_jobs
         SET status = 'complete', case_id = ?, lease_until = NULL, last_error_code = NULL, updated_at = ?
         WHERE submission_id = ?`,
      ).bind(caseId || null, nowIso(), job.submission_id).run();
      return;
    }
    if (response.ok && (response.status === 202 || resultStatus === 'searching')) {
      await env.DB.prepare(
        `UPDATE accessible_japan_quote_jobs
         SET status = 'retry', case_id = COALESCE(?, case_id), next_attempt_at = ?, lease_until = NULL,
             last_error_code = NULL, updated_at = ?
         WHERE submission_id = ?`,
      ).bind(caseId || null, nowIso(30_000), nowIso(), job.submission_id).run();
      return;
    }
    if (response.status >= 500 || response.status === 409 || response.status === 429) {
      await markRetry(env.DB, job, `http_${response.status}`);
      return;
    }
    await env.DB.prepare(
      `UPDATE accessible_japan_quote_jobs
       SET status = 'failed', lease_until = NULL, last_error_code = ?, updated_at = ?
       WHERE submission_id = ?`,
    ).bind(`http_${response.status}`, nowIso(), job.submission_id).run();
  } catch {
    await markRetry(env.DB, job, 'network_error');
  }
}

export async function processAccessibleJapanQuoteJobs(
  env: QuoteJobEnv,
  options: { submissionId?: string; limit?: number } = {},
): Promise<void> {
  const endpoint = configuredEndpoint(env);
  if (!endpoint) return;
  const rows = await dueJobs(env.DB, options.submissionId, Math.min(5, Math.max(1, options.limit || 3)));
  for (const row of rows) {
    const claimed = await claimJob(env.DB, row);
    if (!claimed) continue;
    await processOne(env, claimed, endpoint);
  }
}
