import assert from 'node:assert/strict'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import ChatComposer from '../src/components/chat-composer'
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
const storage = { getItem: () => null, setItem() {} }
;(globalThis as any).localStorage = storage
;(globalThis as any).window = { localStorage: storage, setInterval: () => 1, clearInterval() {} }
const calls: any[] = []
globalThis.fetch = (async (input: any, init: RequestInit = {}) => {
  const path = new URL(String(input)).pathname
  if (init.method !== 'POST') return Response.json({ success: true, data: [] })
  if (path === '/api/upload') {
    assert.ok(init.body instanceof FormData)
    const file = init.body.get('file') as File
    calls.push({ upload: file.type })
    return Response.json({ success: true, data: { url: 'https://example.com/media', fileName: file.name, fileSizeFormatted: '4 B', isImage: file.type.startsWith('image/'), icon: 'file' } })
  }
  calls.push({ path, body: JSON.parse(String(init.body)) })
  return Response.json({ success: true, data: {} })
}) as typeof fetch
async function main() {
  for (const channel of ['instagram', 'facebook'] as const) {
    for (const [mime, expected] of [['image/png', 'image'], ['application/pdf', 'file'], ['video/mp4', 'video'], ['audio/mpeg', 'audio']]) {
      calls.length = 0
      let ui!: ReactTestRenderer
      let opened = false
      const errors: string[] = []
      await act(async () => { ui = create(<ChatComposer friendId="test-friend" channelType={channel} onError={e => errors.push(e)} />, { createNodeMock: element => element.type === 'input' && (element.props as { type?: string }).type === 'file' ? { click() { opened = true } } : null }) })
      const plus = ui.root.findByProps({ title: '画像やファイルを追加' })
      assert.equal(plus.props.disabled, false)
      await act(async () => plus.props.onClick())
      assert.ok(opened, 'plus opens the real file input')
      await act(async () => ui.root.findByProps({ type: 'file' }).props.onChange({ target: { files: [new File(['test'], 'sample', { type: mime })] } }))
      const send = ui.root.findAllByType('button').find(b => b.children.join('') === '送信')!
      await act(async () => { await send.props.onClick() })
      assert.deepEqual(errors.filter(Boolean), [])
      assert.equal(calls[0].upload, mime)
      assert.equal(calls[1].body.messageType, expected)
      assert.equal(calls[1].path, '/api/friends/test-friend/messages')
      assert.equal(calls[1].body.deliveryMode, 'undo_hold')
      await act(async () => ui.unmount())
    }
  }
  console.log('PASS: Meta file picker, image/PDF/video/audio upload and undo-held send payloads')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
