import assert from 'node:assert/strict'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import ChatComposer from '../src/components/chat-composer'
import { whatsappLatestScheduleTime, type WhatsappReplyWindow } from '../src/lib/whatsapp-reply-window'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
const originalNow = Date.now
const originalFetch = globalThis.fetch
const now = Date.parse('2026-09-25T00:00:15+09:00')
Date.now = () => now
const storage = new Map<string, string>()
const localStorage = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
}
;(globalThis as any).localStorage = localStorage
;(globalThis as any).window = { localStorage, setInterval: () => 1, clearInterval: () => {} }
const calls: { path: string; method: string; body?: any }[] = []
let queue: any[] = []
globalThis.fetch = (async (input: any, init: RequestInit = {}) => {
  const path = new URL(String(input)).pathname
  const method = init.method ?? 'GET'
  const body = init.body ? JSON.parse(String(init.body)) : undefined
  calls.push({ path, method, body })
  if (method === 'GET' && path.endsWith('/scheduled-messages')) return Response.json({ success: true, data: queue })
  if (method === 'POST' && (path.endsWith('/send') || path.endsWith('/messages'))) {
    assert.ok(body.scheduledAt, 'scheduling must never fall through to immediate send')
    const item = { id: 'scheduled-1', friendId: 'friend-a', chatId: 'chat-a', messageType: 'text', content: body.content,
      metadata: JSON.stringify({ deliveryMode: body.deliveryMode }), scheduledAt: body.scheduledAt,
      status: 'scheduled', createdAt: new Date(now).toISOString(), lastError: null }
    queue = [item]
    return Response.json({ success: true, data: { scheduled: true, scheduledMessage: item } })
  }
  if (method === 'PUT' && path === '/api/scheduled-messages/scheduled-1') {
    queue = queue.map(item => ({ ...item, scheduledAt: body.scheduledAt }))
    return Response.json({ success: true, data: queue[0] })
  }
  throw new Error(`Unexpected request: ${method} ${path}`)
}) as typeof fetch
const textOf = (node: any): string => typeof node === 'string' ? node : (node?.children ?? []).map(textOf).join('')
const byLabel = (ui: ReactTestRenderer, label: string) => ui.root.findByProps({ 'aria-label': label })
function button(ui: ReactTestRenderer, label: string) {
  const found = ui.root.findAllByType('button').find(node => textOf(node) === label)
  assert.ok(found, label)
  return found
}
async function click(node: any) {
  assert.ok(!node.props.disabled, 'button must be enabled')
  await act(async () => { await node.props.onClick() })
}
async function main() {
  try {
    const boundaryWindow: WhatsappReplyWindow = { friendId: 'friend-a', lastIncomingAt: null, expiresAt: '2026-09-25T00:05:00+09:00', canSend: true }
    assert.equal(whatsappLatestScheduleTime(boundaryWindow, 'friend-a'), Date.parse('2026-09-25T00:04:00+09:00'))
    assert.equal(whatsappLatestScheduleTime({ ...boundaryWindow, expiresAt: '2026-09-24T15:05:00.001Z' }, 'friend-a'), Date.parse('2026-09-25T00:05:00+09:00'))
    assert.equal(whatsappLatestScheduleTime(boundaryWindow, 'another-friend'), undefined)
    assert.equal(whatsappLatestScheduleTime({ ...boundaryWindow, canSend: false }, 'friend-a'), undefined)
    assert.equal(whatsappLatestScheduleTime({ ...boundaryWindow, expiresAt: 'bad' }, 'friend-a'), undefined)
    assert.equal(whatsappLatestScheduleTime(boundaryWindow, 'friend-a', Date.parse(boundaryWindow.expiresAt!)), undefined)
    for (const channel of ['whatsapp', 'line'] as const) {
      for (const direct of [false, true]) {
        queue = []; calls.length = 0
        const errors: string[] = []
        const replyWindow: WhatsappReplyWindow = { friendId: 'friend-a', lastIncomingAt: '2026-09-24T00:05:00+09:00', expiresAt: '2026-09-25T00:05:00+09:00', canSend: true }
        let ui!: ReactTestRenderer
        await act(async () => { ui = create(<ChatComposer friendId="friend-a" chatId={direct ? undefined : 'chat-a'} channelType={channel} whatsappReplyWindow={replyWindow} onError={error => errors.push(error)} />) })
        await act(async () => ui.root.findByType('textarea').props.onChange({ target: { value: 'Scheduled test' } }))
        await click(byLabel(ui, '予約送信を設定'))
        const input = ui.root.findByProps({ type: 'datetime-local' })
        if (channel === 'whatsapp') {
          assert.ok(Date.parse(input.props.value + ':00+09:00') < Date.parse(replyWindow.expiresAt!), 'opening scheduling near expiry must choose a valid time instead of disabling a still-available reservation')
          assert.equal(input.props.max, '2026-09-25T00:04', 'exact expiry is not selectable')
          await act(async () => input.props.onChange({ target: { value: '2026-09-25T00:05' } }))
          assert.equal(button(ui, '予約送信').props.disabled, true)
          assert.match(textOf(ui.toJSON()), /00:04/, 'the valid deadline stays visible when the chosen time is blocked')
        } else {
          assert.equal(input.props.value, '2026-09-25T00:10', 'LINE keeps its default and has no WhatsApp limit')
          assert.equal(input.props.max, undefined)
        }
        const chosen = channel === 'line' ? '2026-09-27T10:03' : '2026-09-25T00:03'
        await act(async () => input.props.onChange({ target: { value: chosen } }))
        await click(button(ui, '予約送信'))
        const writes = calls.filter(call => call.method === 'POST')
        assert.equal(writes.length, 1)
        assert.equal(writes[0].path, direct ? '/api/friends/friend-a/messages' : '/api/chats/chat-a/send')
        assert.equal(writes[0].body.scheduledAt, chosen + ':00.000+09:00')
        assert.equal(writes[0].body.deliveryMode, 'scheduled')
        assert.match(textOf(ui.toJSON()), /予約送信設定中/)
        await click(button(ui, '変更'))
        const editInput = ui.root.findByProps({ type: 'datetime-local' })
        assert.equal(editInput.props.max, channel === 'whatsapp' ? '2026-09-25T00:04' : undefined)
        await act(async () => editInput.props.onChange({ target: { value: '2026-09-25T00:02' } }))
        await click(button(ui, '保存'))
        assert.equal(calls.filter(call => call.method === 'PUT').at(-1)?.body.scheduledAt, '2026-09-25T00:02:00.000+09:00')
        assert.deepEqual(errors.filter(Boolean), [])
        await act(async () => ui.unmount())
      }
    }
    // Less than a full selectable minute remains: preserve the draft and
    // never convert the empty reservation into an immediate send.
    calls.length = 0; queue = []
    let ui!: ReactTestRenderer
    const errors: string[] = []
    await act(async () => { ui = create(<ChatComposer friendId="friend-a" channelType="whatsapp" whatsappReplyWindow={{ ...boundaryWindow, expiresAt: '2026-09-25T00:00:45+09:00' }} onError={error => errors.push(error)} />) })
    await act(async () => ui.root.findByType('textarea').props.onChange({ target: { value: 'Keep draft' } }))
    await click(byLabel(ui, '予約送信を設定'))
    assert.equal(ui.root.findByProps({ type: 'datetime-local' }).props.value, '')
    assert.equal(button(ui, '予約送信').props.disabled, true)
    assert.match(textOf(ui.toJSON()), /予約できる時刻が残っていません/)
    await act(async () => { ui.root.findByType('textarea').props.onKeyDown({ key: 'Enter', ctrlKey: true, preventDefault() {} }); await Promise.resolve() })
    assert.equal(calls.filter(call => call.method === 'POST').length, 0)
    assert.equal(ui.root.findByType('textarea').props.value, 'Keep draft')
    assert.ok(errors.some(Boolean))
    await click(byLabel(ui, '予約設定を閉じる'))
    assert.equal(button(ui, '送信').props.disabled, false, 'closing the reservation restores immediate-send availability')
    await act(async () => ui.unmount())
    console.log('PASS: WhatsApp/LINE scheduling and editing on both chat/direct routes, near-expiry default, visible deadline, JST payload and no immediate send')
  } finally { Date.now = originalNow; globalThis.fetch = originalFetch }
}
main().then(() => process.exit(0), error => { console.error(error); process.exit(1) })
