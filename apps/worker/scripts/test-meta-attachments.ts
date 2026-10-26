import assert from 'node:assert/strict';
import { persistAttachment } from '../src/routes/meta-webhook.js';
import { normalizeMetaEvent } from '../src/services/meta-webhook-utils.js';
import { notifySlackIncoming } from '../src/services/slack.js';

const originalFetch = globalThis.fetch;
const sent: any[] = [];
let translationCalls = 0;
let mediaCalls = 0;
let uploads = 0;
const env = { WORKER_URL: 'https://worker.test', UPLOADS: { async put() { uploads++; } } } as any;
globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (url.startsWith('https://translation.googleapis.com')) {
    translationCalls++;
    return Response.json({data: {translations: [{translatedText: '和訳テスト'}]}});
  }
  if (url === 'https://slack.com/api/chat.postMessage') {
    sent.push(JSON.parse(String(init?.body)));
    return Response.json({ok: true});
  }
  assert.equal(url, 'https://cdn.test/photo');
  mediaCalls++;
  return new Response('image fixture', { headers: {'content-type': 'image/jpeg'} });
};
try {
  for (const payload of [undefined, {}, {template_type: 'generic'}, {elements: [null, 42, {}]}]) {
    const stored = await persistAttachment(env, {type: 'template', payload});
    assert.match(stored.content, /元DMを確認/);
    assert.doesNotMatch(stored.content, /\[template\]/);
    await notifySlackIncoming({slackToken: 'mock', slackChannelId: 'mock', friendName: 'SYSTEM TEST',
      messageText: stored.eventText, messageType: stored.notificationType!, googleTranslateApiKey: 'mock'});
  }
  const card = await persistAttachment(env, {type: 'template', payload: {elements: [{
    title: 'Trip details', subtitle: 'Tokyo and Kyoto',
    default_action: {url: 'https://example.test/trip'}, image_url: 'https://example.test/image',
    buttons: [{title: 'Details', url: 'https://example.test/details'},
      {title: 'Choose', payload: 'PRIVATE_POSTBACK'}, {url: 'javascript:alert(1)'}],
  }]}});
  for (const value of ['Trip details', 'Tokyo and Kyoto', 'https://example.test/trip', 'https://example.test/details', 'Choose']) {
    assert.ok(card.content.includes(value));
  }
  assert.doesNotMatch(card.content, /PRIVATE_POSTBACK|javascript:/);
  assert.equal(card.messageType, 'text', 'Existing chat renderer can display the full card summary');
  assert.equal(mediaCalls, 0, 'Card destinations are never fetched as attachments');
  assert.equal(uploads, 0);
  assert.equal(translationCalls, 0, 'Unavailable attachment notices are not translated');
  assert.ok(sent.every(item => !item.text.includes('和訳')));
  const button = await persistAttachment(env, {type: 'template', payload: {text: 'Please choose', buttons: [{title: 'Open', url: 'https://example.test'}]}});
  assert.match(button.content, /Please choose/);
  const unknown = await persistAttachment(env, {type: 'future_type'});
  assert.match(unknown.content, /元DMを確認/);
  assert.equal(unknown.notificationType, 'attachment');
  const photo = await persistAttachment(env, {type: 'image', payload: {url: 'https://cdn.test/photo'}});
  assert.equal(photo.messageType, 'image');
  assert.equal(mediaCalls, 1);
  assert.equal(uploads, 1);
  const text = normalizeMetaEvent({sender: {id: 'customer'}, message: {mid: 'message', text: 'Hello'}}, {});
  assert.equal(text?.text, 'Hello');
  await notifySlackIncoming({slackToken: 'mock', slackChannelId: 'mock', friendName: 'SYSTEM TEST',
    messageText: text!.text, messageType: 'text', googleTranslateApiKey: 'mock'});
  assert.equal(translationCalls, 1, 'Ordinary customer text still translates');
  assert.equal(normalizeMetaEvent({sender: {id: 'customer'}, message: {is_deleted: true}}, {}), null);
  console.log('PASS: Meta card summaries, empty and malformed cards, safe links, no placeholder translation, ordinary text and media');
} finally { globalThis.fetch = originalFetch; }
