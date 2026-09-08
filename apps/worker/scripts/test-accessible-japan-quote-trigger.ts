import assert from 'node:assert/strict';
import { ACCESSIBLE_JAPAN_FORM_ID } from '@line-crm/shared';
import {
  enqueueAccessibleJapanQuoteJob,
  processAccessibleJapanQuoteJobs,
} from '../src/services/accessible-japan-quote-jobs.js';

type Job = {
  submission_id: string;
  status: 'pending' | 'processing' | 'retry' | 'complete' | 'failed';
  attempts: number;
  next_attempt_at: string;
  lease_until: string | null;
  case_id: string | null;
  last_error_code: string | null;
};

const submission = {
  id: 'submission-immediate-trigger-test',
  form_id: ACCESSIBLE_JAPAN_FORM_ID,
  data: JSON.stringify({
    first_name: 'Test',
    last_name: 'Traveller',
    email: 'test@example.com',
  }),
  created_at: '2026-09-07T16:10:24.458+09:00',
};
const jobs = new Map<string, Job>();
const posts: Array<Record<string, unknown>> = [];

function statement(sqlInput: string) {
  const sql = sqlInput.replace(/\s+/g, ' ').trim();
  let bindings: unknown[] = [];
  const value = {
    bind(...next: unknown[]) {
      bindings = next;
      return value;
    },
    async run() {
      if (sql.startsWith('INSERT OR IGNORE INTO accessible_japan_quote_jobs')) {
        const submissionId = String(bindings[0]);
        if (!jobs.has(submissionId)) {
          jobs.set(submissionId, {
            submission_id: submissionId,
            status: 'pending',
            attempts: 0,
            next_attempt_at: String(bindings[1]),
            lease_until: null,
            case_id: null,
            last_error_code: null,
          });
        }
        return { success: true, meta: { changes: 1 } };
      }
      if (sql.startsWith("UPDATE accessible_japan_quote_jobs SET status = 'processing'")) {
        const submissionId = String(bindings[2]);
        const job = jobs.get(submissionId);
        if (!job || !['pending', 'retry', 'processing'].includes(job.status)) {
          return { success: true, meta: { changes: 0 } };
        }
        job.status = 'processing';
        job.attempts += 1;
        job.lease_until = String(bindings[0]);
        return { success: true, meta: { changes: 1 } };
      }
      if (sql.startsWith("UPDATE accessible_japan_quote_jobs SET status = 'complete'")) {
        const submissionId = String(bindings[2]);
        const job = jobs.get(submissionId)!;
        job.status = 'complete';
        job.case_id = String(bindings[0]);
        job.lease_until = null;
        job.last_error_code = null;
        return { success: true, meta: { changes: 1 } };
      }
      if (sql.startsWith("UPDATE accessible_japan_quote_jobs SET status = 'retry', case_id")) {
        const job = jobs.get(String(bindings[3]))!;
        job.status = 'retry';
        job.case_id = bindings[0] ? String(bindings[0]) : job.case_id;
        job.next_attempt_at = String(bindings[1]);
        job.lease_until = null;
        job.last_error_code = null;
        return { success: true, meta: { changes: 1 } };
      }
      throw new Error(`Unexpected run SQL: ${sql}`);
    },
    async all<T>() {
      if (sql.includes('FROM accessible_japan_quote_jobs')) {
        const exact = sql.includes('WHERE submission_id = ?');
        const due = String(bindings[exact ? 1 : 0]);
        const rows = [...jobs.values()].filter(job =>
          (!exact || job.submission_id === bindings[0]) &&
          ((['pending', 'retry'].includes(job.status) && job.next_attempt_at <= due) ||
           (job.status === 'processing' && (job.lease_until || '') <= due))
        );
        return { results: rows.slice(0, exact ? 1 : Number(bindings[2])) as T[] };
      }
      throw new Error(`Unexpected all SQL: ${sql}`);
    },
    async first<T>() {
      if (sql.startsWith('SELECT submission_id, status, attempts')) {
        return (jobs.get(String(bindings[0])) || null) as T | null;
      }
      if (sql.startsWith('SELECT id, form_id, data, created_at FROM form_submissions')) {
        return (
          bindings[0] === submission.id && bindings[1] === ACCESSIBLE_JAPAN_FORM_ID
            ? submission
            : null
        ) as T | null;
      }
      throw new Error(`Unexpected first SQL: ${sql}`);
    },
  };
  return value;
}

const env = {
  DB: { prepare: statement },
  ACCESSIBLE_JAPAN_QUOTE_INTAKE_URL:
    'https://travelworker.example/api/integrations/accessible-japan-quote-intents',
  ACCESSIBLE_JAPAN_QUOTE_INTAKE_TOKEN: 'test-token',
} as any;

const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  assert.equal(
    String(input),
    'https://travelworker.example/api/integrations/accessible-japan-quote-intents',
  );
  assert.equal((init?.headers as Record<string, string>)['x-accessible-japan-quote-token'], 'test-token');
  posts.push(JSON.parse(String(init?.body || '{}')));
  const intakeOnly = posts.at(-1)?.intakeOnly === true;
  return new Response(
    JSON.stringify({ status: intakeOnly ? 'searching' : 'ready', caseId: 'flatworker-auto-test' }),
    { status: intakeOnly ? 202 : 200, headers: { 'content-type': 'application/json' } },
  );
}) as typeof fetch;

try {
  await enqueueAccessibleJapanQuoteJob(env.DB, submission.id);
  await enqueueAccessibleJapanQuoteJob(env.DB, submission.id);
  assert.equal(jobs.size, 1, 'duplicate submission enqueue must stay idempotent');
  assert.equal(jobs.get(submission.id)?.status, 'pending');

  await processAccessibleJapanQuoteJobs(env, { submissionId: submission.id, limit: 1 });

  assert.equal(posts.length, 1, 'the submission should call TravelWorker immediately');
  assert.equal(posts[0].submissionId, submission.id);
  assert.equal(posts[0].formId, ACCESSIBLE_JAPAN_FORM_ID);
  assert.equal(posts[0].intakeOnly, true, 'HTTP event must not wait for DIDA searches');
  assert.equal(jobs.get(submission.id)?.status, 'retry');
  assert.equal(jobs.get(submission.id)?.lease_until, null, 'do not wait five minutes for the HTTP lease');
  assert.equal(jobs.get(submission.id)?.case_id, 'flatworker-auto-test');

  await processAccessibleJapanQuoteJobs(env, { limit: 3 });
  assert.equal(posts.length, 1, 'cron respects the normal 30-second resume boundary');
  jobs.get(submission.id)!.next_attempt_at = '2000-01-01T00:00:00.000Z';
  await processAccessibleJapanQuoteJobs(env, { limit: 3 });
  assert.equal(posts.length, 2, 'existing cron resumes the initial case');
  assert.equal(posts[1].intakeOnly, undefined, 'cron performs normal resumable searches');
  assert.deepEqual(posts[1], Object.fromEntries(Object.entries(posts[0]).filter(([key]) => key !== 'intakeOnly')));
  assert.equal(jobs.get(submission.id)?.status, 'complete');
  assert.equal(jobs.get(submission.id)?.case_id, 'flatworker-auto-test');
} finally {
  globalThis.fetch = originalFetch;
}

console.log('accessible japan quote trigger tests passed');
