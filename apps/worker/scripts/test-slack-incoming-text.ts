import assert from 'node:assert/strict';
import { notifySlackIncoming } from '../src/services/slack.js';

type Block = { type: string; text?: { text: string }; accessory?: unknown; image_url?: string };
type Message = { channel: string; text: string; blocks: Block[]; username: string; icon_url?: string };
const originalFetch = globalThis.fetch;
const messages: Message[] = [];
let translation: string | null = null;
let failPart = 0;
let transportFailure = false;
let rejectImage = false;
let translationCalls = 0;
const base = {
  slackToken: 'local-mock-token', slackChannelId: 'local-test-channel',
  friendName: 'SYSTEM TEST', accountName: 'WhatsApp (English)', messageType: 'text',
};
const header = '*SYSTEM TEST* (WhatsApp (English)) からのメッセージ:\n>';

globalThis.fetch = async (input, init) => {
  const url = String(input);
  const body = JSON.parse(String(init?.body));
  if (url.startsWith('https://translation.googleapis.com/')) {
    translationCalls += 1;
    assert.equal(body.target, 'ja');
    return Response.json(translation === null ? {} : {data: {translations: [{translatedText: translation}]}});
  }
  assert.equal(url, 'https://slack.com/api/chat.postMessage');
  assert.equal(body.channel, base.slackChannelId);
  assert.ok(body.text.length <= 40000, 'Fallback text stays within Slack message limit');
  assert.ok(body.blocks.length <= 50, 'Slack blocks stay within limit');
  for (const block of body.blocks as Block[]) {
    if (!block.text) continue;
    assert.ok(block.text.text.length <= 3000, 'Slack section stays within limit');
    assert.equal(block.text.text.isWellFormed(), true, 'No broken surrogate pairs');
  }
  messages.push(body);
  if (rejectImage && body.icon_url) return Response.json({ok: false, error: 'invalid_arguments'});
  if (messages.length === failPart) {
    if (transportFailure) throw new Error('Local fixture: unknown transport outcome');
    return Response.json({ok: false, error: 'invalid_blocks'});
  }
  return Response.json({ok: true});
};
function reset() {
  messages.length = 0;
  translation = null;
  failPart = 0;
  transportFailure = false;
  rejectImage = false;
  translationCalls = 0;
}
function text() {
  return messages.flatMap(message => message.blocks.filter(block => block.type === 'section').map(block => block.text!.text)).join('');
}
try {
  for (const length of [0, 1, 2799 - header.length, 2800 - header.length, 2801 - header.length, 2999, 3000, 3069, 40000, 150000]) {
    reset();
    const messageText = 'x'.repeat(length);
    await notifySlackIncoming({...base, messageText});
    assert.equal(text(), header + messageText, `Exact full original preserved at length ${length}`);
    if (length === 3069) assert.equal(messages.length, 1, 'Sam-size fixture fits a single split-block post');
    if (length === 150000) assert.ok(messages.length > 1, 'Huge original splits across bounded posts');
  }
  reset();
  translation = '和訳が長くなる場合も本文を保持します。'.repeat(700);
  const messageText = 'A comfortable privately guided tour.\n'.repeat(86).slice(0, 3069);
  await notifySlackIncoming({...base, messageText, googleTranslateApiKey: 'mock-key'});
  assert.equal(translationCalls, 1);
  assert.equal(text(), header + messageText + '\n*和訳:* ' + translation, 'Original and expanded translation both preserved');

  reset();
  await notifySlackIncoming({...base, messageText: 'x'.repeat(2799 - header.length) + '😀'.repeat(2000)});
  assert.equal(text(), header + 'x'.repeat(2799 - header.length) + '😀'.repeat(2000));
  reset();
  const multiline = ('line\n\n' + 'y'.repeat(1600) + '\n').repeat(50);
  await notifySlackIncoming({...base, messageText: multiline});
  assert.equal(text(), header + multiline, 'Line boundaries and whitespace preserved exactly');

  reset();
  await notifySlackIncoming({...base, messageText: 'Hello'});
  assert.equal(messages.length, 1);
  assert.equal(messages[0].blocks.length, 1);
  assert.equal(messages[0].text, '💬 SYSTEM TEST (WhatsApp (English)): Hello');
  reset();
  await notifySlackIncoming({...base, messageText: 'Translate fails safely', googleTranslateApiKey: 'mock-key'});
  assert.equal(text(), header + 'Translate fails safely', 'Missing translation cannot lose the original');

  for (const messageType of ['image', 'file', 'video', 'audio']) {
    reset();
    await notifySlackIncoming({...base, messageType, messageText: 'media caption\n'.repeat(3000),
      friendPictureUrl: 'https://example.test/avatar.png', mediaUrl: 'https://example.test/media', fileName: 'file.pdf'});
    const blocks = messages.flatMap(message => message.blocks);
    assert.equal(blocks.filter(block => block.accessory).length, 1, 'Avatar only appears once');
    const attachments = blocks.filter(block => block.type === 'image' || block.text?.text.includes('https://example.test/media'));
    assert.equal(attachments.length, 1, 'Media attachment only appears once');
    assert.equal(blocks.at(-1), attachments[0], 'Attachment follows the full caption');
    assert.equal(translationCalls, 0, 'Media is not translated');
  }
  reset();
  rejectImage = true;
  await notifySlackIncoming({...base, messageText: 'Preserve image fallback', friendPictureUrl: 'https://example.test/avatar.png'});
  assert.equal(messages.length, 2, 'Existing explicit image rejection fallback is preserved');
  assert.ok(!messages[1].blocks[0].accessory);
  assert.equal(messages[1].text, messages[0].text);

  for (const unknownOutcome of [false, true]) {
    reset();
    failPart = 2;
    transportFailure = unknownOutcome;
    await notifySlackIncoming({...base, messageText: 'x'.repeat(150000)});
    assert.equal(messages.length, 2, 'No retry or later parts after rejected/unknown outcome');
  }
  console.log('SLACK_INCOMING_TEXT_TEST_OK: exact text, translation expansion, Unicode, Slack limits, media, failure boundaries');
} finally {
  globalThis.fetch = originalFetch;
}
