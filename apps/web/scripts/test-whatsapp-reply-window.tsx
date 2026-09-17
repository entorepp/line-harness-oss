import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import ChatComposer from '../src/components/chat-composer'
import { whatsappReplyBlock, type WhatsappReplyWindow } from '../src/lib/whatsapp-reply-window'

const now = Date.now()
const window: WhatsappReplyWindow = {
  friendId: 'friend-a', lastIncomingAt: new Date(now - 1000).toISOString(),
  expiresAt: new Date(now + 60_000).toISOString(), canSend: true,
}
function render(channelType: 'whatsapp' | 'line', replyWindow?: WhatsappReplyWindow) {
  const html = renderToStaticMarkup(<ChatComposer friendId="friend-a" channelType={channelType} whatsappReplyWindow={replyWindow} />)
  const sendButton = html.match(/<button\b[^>]*>送信<\/button>/)?.[0]
  assert.ok(sendButton, 'the actual composer must contain its send button')
  return { html, disabled: sendButton.includes('disabled=""') }
}

assert.equal(render('whatsapp').disabled, true, 'missing metadata cannot permit a send')
assert.equal(render('whatsapp', { ...window, friendId: 'previous-friend' }).disabled, true,
  'stale metadata from another chat cannot permit a send')
assert.equal(render('whatsapp', window).disabled, false, 'a current customer reply permits sending')
const expired = render('whatsapp', { ...window, expiresAt: new Date(now - 1).toISOString() })
assert.equal(expired.disabled, true, 'the client clock closes stale server metadata')
assert.ok(expired.html.includes('メールなどで連絡'), 'blocked send provides a recovery step')
assert.ok(!expired.html.match(/<textarea[^>]*disabled/), 'staff can still edit a draft')
assert.equal(render('whatsapp', { ...window, canSend: false }).disabled, true)
assert.equal(render('line').disabled, false, 'other messaging channels retain their behavior')
assert.equal(whatsappReplyBlock(window, 'friend-a', Date.parse(window.expiresAt!)) !== null, true,
  'exact expiry is closed even if the server previously returned canSend')
assert.equal(whatsappReplyBlock(window, 'friend-a', now, new Date(now + 59_000).toISOString()), null)
assert.match(whatsappReplyBlock(window, 'friend-a', now, window.expiresAt!)!, /予約時刻/)
assert.ok(whatsappReplyBlock({ ...window, expiresAt: 'bad-date' }, 'friend-a', now))
console.log('PASS: rendered WhatsApp send guard, chat identity, new reply, clock expiry, editable draft, schedule boundary and LINE compatibility')
