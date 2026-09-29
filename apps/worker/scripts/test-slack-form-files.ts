import assert from 'node:assert/strict';
import { notifySlackFormSubmission } from '../src/services/slack.js';
import { createFormFileAccessUrl, verifyFormFileAccess } from '../src/services/form-file-access.js';

const originalFetch = globalThis.fetch;
const nowMs = Date.UTC(2026, 8, 29);
const expiresAt = Math.floor(nowMs / 1000) + 86400;
const secret = 'local-test-secret';
const urls = await Promise.all(Array.from({ length: 1000 }, (_, index) => createFormFileAccessUrl({
  workerUrl: 'https://worker.example.test', key: `private-passport-${index}.pdf`, expiresAt, secret,
})));
const translateInputs: string[][] = [];
const messages: Array<{ blocks: Array<{ type: string; text?: { text: string } }> }> = [];
globalThis.fetch = async (input, init) => {
  const url = String(input);
  const body = JSON.parse(String(init?.body));
  if (url.startsWith('https://translation.googleapis.com/')) {
    translateInputs.push(body.q);
    return Response.json({ data: { translations: body.q.map(() => ({ translatedText: '空港で介助が必要です' })) } });
  }
  assert.equal(url, 'https://slack.com/api/chat.postMessage');
  messages.push(body);
  return Response.json({ ok: true });
};

function readLinks(): string[] {
  const links: string[] = [];
  for (const message of messages) {
    assert.ok(message.blocks.length <= 50, 'Slack block limit');
    for (const block of message.blocks) {
      if (!block.text) continue;
      assert.ok(block.text.text.length <= 3000, 'Slack section limit');
      for (const match of block.text.text.matchAll(/<(https?:[^<>]+)\|添付ファイルを開く>/g)) {
        links.push(match[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'));
      }
    }
  }
  return links;
}

const base = {
  slackToken: 'mock-token', slackChannelId: 'mock-channel', friendName: 'SYSTEM TEST',
  formName: 'Local fixture only', googleTranslateApiKey: 'mock-translation-key',
};
try {
  await notifySlackFormSubmission({ ...base, answers: [
    { label: 'Insurance', value: `📎 insurance_<plan>&.pdf\n${urls[0]}` },
    { label: 'Passports', value: urls.slice(1, 5).map((url, i) => `📎 passport_${i}.pdf\n${url}`).join('\n') },
    { label: 'Support', value: 'I need assistance at the airport' },
  ] });
  assert.deepEqual(translateInputs, [['I need assistance at the airport']]);
  assert.deepEqual(readLinks(), urls.slice(0, 5));
  assert.ok(JSON.stringify(messages).includes('insurance_&lt;plan&gt;&amp;.pdf'));
  assert.ok(JSON.stringify(messages).includes('空港で介助が必要です'));
  for (const link of readLinks()) {
    const parsed = new URL(link);
    assert.equal(await verifyFormFileAccess({
      key: decodeURIComponent(parsed.pathname.split('/').at(-1)!),
      expiresAt: Number(parsed.searchParams.get('expires')),
      signature: parsed.searchParams.get('sig')!, secret, nowMs,
    }), true, 'Slack link retains the original valid HMAC');
  }

  messages.length = 0;
  translateInputs.length = 0;
  await notifySlackFormSubmission({ ...base, answers: [{
    label: 'Many passports',
    value: urls.map((url, i) => `📎 passport_${i}.pdf\n${url}`).join('\n'),
  }] });
  assert.equal(translateInputs.length, 0, 'No private URLs sent to translation');
  assert.ok(messages.length > 1, 'Large answer is split within Slack limits');
  assert.deepEqual(readLinks(), urls, 'All attachments survive without truncation or duplicates');

  messages.length = 0;
  await notifySlackFormSubmission({ ...base, answers: [] });
  assert.equal(messages.length, 1, 'Empty form still notifies');
  console.log('SLACK_FORM_FILES_TEST_OK: translation isolation, exact signed links, 1000 attachments, Slack limits');
} finally {
  globalThis.fetch = originalFetch;
}
