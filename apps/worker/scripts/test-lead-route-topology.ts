import assert from 'node:assert/strict';
import worker from '../src/index.js';

const env = {
  META_VERIFY_TOKEN: 'topology-test-token',
} as any;

const executionCtx = {
  waitUntil() {},
  passThroughOnException() {},
} as any;

const metaChallenge = await worker.fetch(new Request(
  'https://line-flattravel.flat-travel.workers.dev/webhook/meta?hub.mode=subscribe&hub.verify_token=topology-test-token&hub.challenge=route-present',
), env, executionCtx);
assert.equal(metaChallenge.status, 200);
assert.equal(await metaChallenge.text(), 'route-present');

const deletionPage = await worker.fetch(new Request(
  'https://line-flattravel.flat-travel.workers.dev/meta-data-deletion',
), env, executionCtx);
assert.equal(deletionPage.status, 200);
assert.match(await deletionPage.text(), /Meta Data Deletion Instructions/);

const quoteRoute = await worker.fetch(new Request(
  'https://line-flattravel.flat-travel.workers.dev/api/travel/quote-intents',
  {
    method: 'POST',
    headers: {
      origin: 'https://example.com',
      'content-type': 'text/plain;charset=UTF-8',
    },
    body: '{}',
  },
), env, executionCtx);
assert.equal(quoteRoute.status, 403);
assert.match(await quoteRoute.text(), /Origin not allowed/);

console.log('lead route topology: Meta webhook, deletion page, and public quote-intent route mounted');
