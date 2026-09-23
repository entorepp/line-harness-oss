import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import WhatsAppPhone from '../src/components/whatsapp-phone'
import { loadChatFriends } from '../src/lib/chat-friends'

const render = (phone?: string | null, channelType = 'whatsapp') =>
  renderToStaticMarkup(<WhatsAppPhone channelType={channelType} phone={phone} />)

async function main() {
  assert.match(render('+15555550100'), /\+15555550100/)
  assert.match(render('090-0000-0000'), /090-0000-0000/, 'preserve domestic formatting without guessing country')
  for (const phone of [undefined, null, '', 'U123456789', 'unknown', '+12', '<img src=x>']) {
    assert.match(render(phone), /電話番号を取得できません/)
  }
  for (const channel of ['line', 'instagram', 'facebook', 'wechat', 'kakao']) {
    assert.equal(render('+15555550100', channel), '', 'other channel IDs must not become phone numbers')
  }

  const originalFetch = globalThis.fetch
  const calls: URL[] = []
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(String(input))
    calls.push(url)
    assert.equal(url.searchParams.get('lineAccountId'), 'wa-account')
    const offset = Number(url.searchParams.get('offset'))
    const items = Array.from({ length: offset === 0 ? 100 : 1 }, (_, i) => ({
      id: `friend-${offset + i}`, displayName: 'Same display name', lineUserId: `+1555555${String(offset + i).padStart(4, '0')}`,
    }))
    return Response.json({ success: true, data: { items, total: 101, hasNextPage: offset === 0 } })
  }) as typeof fetch
  try {
    const friends = await loadChatFriends('wa-account', 'whatsapp')
    assert.equal(friends.length, 101, 'older conversations also receive their phone number')
    assert.equal(friends.find(friend => friend.id === 'friend-100')?.lineUserId, '+15555550100')
    assert.deepEqual(calls.map(url => url.searchParams.get('offset')), ['0', '100'])
    calls.length = 0
    await loadChatFriends('wa-account', 'line')
    assert.equal(calls.length, 1, 'preserve other channels existing request volume')
    globalThis.fetch = (async () => Response.json({ success: false })) as typeof fetch
    await assert.rejects(loadChatFriends('wa-account', 'whatsapp'))
  } finally {
    globalThis.fetch = originalFetch
  }
  console.log('PASS: WhatsApp phone display, missing/invalid numbers, channel isolation and contact pagination')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
