import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const composer = readFileSync(new URL('../src/components/chat-composer.tsx', import.meta.url), 'utf8')
const chats = readFileSync(new URL('../src/app/chats/page.tsx', import.meta.url), 'utf8')
const api = readFileSync(new URL('../src/lib/api.ts', import.meta.url), 'utf8')

assert.match(
  composer,
  /const supportsUndoSend = !isKakao && !isWhatsApp/,
  'WhatsApp manual replies must bypass the 30-second undo hold',
)
assert.match(chats, /function WhatsappDeliveryIndicator/)
for (const label of ['Meta受付', '送信済み', '配達済み', '既読', '配達失敗', '送達未確認']) {
  assert.ok(chats.includes(label), `Missing WhatsApp delivery label: ${label}`)
}
for (const field of ['deliveryStatus', 'deliveryStatusAt', 'deliveryErrorCode']) {
  assert.ok(api.includes(field), `Missing API delivery field: ${field}`)
}

console.log('PASS: WhatsApp sends bypass undo hold and delivery states are exposed in chat UI')
