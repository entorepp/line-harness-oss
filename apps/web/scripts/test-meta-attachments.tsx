import assert from 'node:assert/strict'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import ChatComposer from '../src/components/chat-composer'
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
const storage = { getItem: () => null, setItem() {} }
;(globalThis as any).localStorage = storage
;(globalThis as any).window = { localStorage: storage, setInterval: () => 1, clearInterval() {} }
const calls: any[] = []
let failUpload = false
globalThis.fetch = (async (input: any, init: RequestInit = {}) => {
  const path = new URL(String(input)).pathname
  if (init.method !== 'POST') return Response.json({ success: true, data: [] })
  if (path === '/api/upload') {
    assert.ok(init.body instanceof FormData)
    const file = init.body.get('file') as File
    calls.push({ upload: file.type, name: file.name })
    if (failUpload && file.name === 'second.png') return Response.json({ success: false, error: 'Upload failed' })
    return Response.json({ success: true, data: { url: `https://example.com/${file.name}`, fileName: file.name, fileSizeFormatted: '4 B', isImage: file.type.startsWith('image/'), icon: 'file' } })
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
  for (const failure of [false, true]) {
    calls.length = 0
    failUpload = failure
    const errors: string[] = []
    let ui!: ReactTestRenderer
    await act(async () => { ui = create(<ChatComposer friendId="test-friend" channelType="instagram" onError={e => errors.push(e)} />) })
    const picker = ui.root.findByProps({ type: 'file' })
    assert.equal(picker.props.multiple, true)
    const photo = (name: string) => new File(['test'], name, { type: 'image/png' })
    await act(async () => picker.props.onChange({ target: { files: [photo('first.png'), photo('remove.png')] } }))
    await act(async () => picker.props.onChange({ target: { files: [photo('second.png')] } }))
    assert.equal(ui.root.findAllByType('img').length, 3, 'additional selection appends')
    await act(async () => ui.root.findByProps({ 'aria-label': 'remove.pngを削除' }).props.onClick())
    assert.equal(ui.root.findAllByType('img').length, 2)
    const send = ui.root.findAllByType('button').find(b => b.children.join('') === '送信')!
    await act(async () => { await send.props.onClick() })
    assert.deepEqual(calls.filter(c => c.upload).map(c => c.name), ['first.png', 'second.png'])
    const messages = calls.filter(c => c.body)
    if (failure) {
      assert.equal(messages.length, 0, 'finish all uploads before sending any message')
      assert.equal(ui.root.findAllByType('img').length, 2, 'retain draft after failed upload')
      assert.deepEqual(errors.filter(Boolean), ['Upload failed'])
    } else {
      assert.deepEqual(messages.map(c => JSON.parse(c.body.content).url), ['https://example.com/first.png', 'https://example.com/second.png'])
      assert.ok(messages[0].body.undoGroupId)
      assert.equal(messages[0].body.undoGroupId, messages[1].body.undoGroupId)
      assert.equal(ui.root.findAllByType('img').length, 0, 'clear successful batch')
    }
    await act(async () => ui.unmount())
  }
  console.log('PASS: Meta file picker, image/PDF/video/audio upload and undo-held send payloads')
}
main().then(() => process.exit(0), error => { console.error(error); process.exit(1) })
