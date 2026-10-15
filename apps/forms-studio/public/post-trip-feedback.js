export const FORM_ID = '8dc19365-8dd7-49e7-92fb-fdd697572771'
const PAGE_FILES = 64
export class MediaUploader {
  constructor(request = fetch, wait = ms => new Promise(resolve => setTimeout(resolve, ms))) {
    this.request = request; this.wait = wait; this.states = new Map(); this.collection = null
  }
  async call(path, options, notify) {
    for (let attempt = 0; ; attempt++) {
      try {
        const response = await this.request(path, { ...options, signal: AbortSignal.timeout(120000) })
        const json = await response.json().catch(() => ({}))
        if (!response.ok || !json.success) {
          const error = new Error(json.error || 'Your upload could not be saved. Please try again.')
          error.retryable = response.status >= 500 || response.status === 429 || json.retryable
          throw error
        }
        return json.data
      } catch (error) {
        const retryable = error.retryable || error instanceof TypeError || error.name === 'TimeoutError'
        if (!retryable || attempt >= 3) throw new Error(error instanceof TypeError ? 'Connection interrupted. Your selected files and completed uploads are still here. Please try again.' : error.message)
        notify('Connection interrupted. Retrying this part; completed uploads will be kept…')
        await this.wait([1500, 4000, 10000][attempt])
      }
    }
  }
  async upload(file, notify) {
    let state = this.states.get(file)
    if (!state) {
      const session = await this.call('/api/form-media/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ formId: FORM_ID, fieldName: 'memory_photos', fileName: file.name, fileSize: file.size }) }, notify)
      state = { session, next: 0, offset: 0, proof: undefined, file: null }; this.states.set(file, state)
    }
    if (state.file) return state.file
    const { session } = state
    for (; state.next < session.count; state.next++) {
      notify(`Uploading ${file.name}\n${Math.floor(state.next / session.count * 100)}% of this file`)
      await this.call(`/api/form-media/${session.id}/chunks/${state.next}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Upload-Token': session.token }, body: file.slice(state.next * session.chunkBytes, Math.min(file.size, (state.next + 1) * session.chunkBytes)) }, notify)
    }
    while (!state.file) {
      notify(`Verifying ${file.name}…`)
      const data = await this.call(`/api/form-media/${session.id}/complete`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Upload-Token': session.token }, body: JSON.stringify({ offset: state.offset, proof: state.proof }) }, notify)
      if (data.file) state.file = data.file
      else { state.offset = data.nextOffset; state.proof = data.proof }
    }
    return state.file
  }
  async uploadAll(files, notify) {
    if (!files.length) return []
    const completed = []
    for (let i = 0; i < files.length; i++) {
      notify(`Saving file ${i + 1} of ${files.length}…`)
      completed.push(await this.upload(files[i], text => notify(`File ${i + 1} of ${files.length}: ${text}`)))
    }
    const fingerprint = completed.map(f => f.key).join('|')
    if (this.collection?.fingerprint !== fingerprint) this.collection = { fingerprint, offset: 0, last: null }
    const collection = this.collection
    while (collection.offset < completed.length) {
      notify('Organising your photos and videos…')
      collection.last = await this.call('/api/form-media/collection', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ files: completed.slice(collection.offset, collection.offset + PAGE_FILES).map(f => ({ key: f.key, url: f.url })), previous: collection.last?.url }) }, notify)
      collection.offset += PAGE_FILES
    }
    return [collection.last]
  }
}

export async function mountFeedback(doc = document) {
  const $ = id => doc.getElementById(id)
  const showError = message => { $('error').textContent = message; $('error').hidden = false; $('error').scrollIntoView({ block: 'center', behavior: 'smooth' }) }
  const params = new URLSearchParams(location.search)
  let issue
  let form
  try {
    if (params.get('issue')) {
      const r = await fetch(`/api/form-issues/${encodeURIComponent(params.get('issue'))}`); const json = await r.json()
      if (!r.ok || !json.success || json.data?.form?.id !== FORM_ID) throw new Error('This feedback link is unavailable. Please ask your travel coordinator for a new link.')
      issue = json.data.issue; form = json.data.form
    } else {
      const r = await fetch(`/api/forms/${FORM_ID}`); const json = await r.json()
      if (!r.ok || !json.success || !json.data?.isActive) throw new Error('This feedback form is unavailable. Please try again later.')
      form = json.data
    }
  } catch (error) { showError(error instanceof TypeError ? 'Unable to connect. Please check your connection and reload this page.' : error.message); $('intro').textContent = ''; return }
  $('intro').textContent = form.description
  const files = []
  const controls = new Map()
  const uploader = new MediaUploader()
  let busy = false
  const element = (tag, text, className) => { const el = doc.createElement(tag); if (text) el.textContent = text; if (className) el.className = className; return el }
  const drawFiles = list => {
    list.replaceChildren()
    files.forEach((file, i) => {
      const li = element('li'); li.append(element('span', `${file.name} · ${(file.size / 1024 / 1024).toFixed(1)} MB`, 'filename'))
      const remove = element('button', 'Remove', 'remove'); remove.type = 'button'; remove.disabled = busy
      remove.addEventListener('click', () => { files.splice(i, 1); drawFiles(list) }); li.append(remove); list.append(li)
    })
  }
  for (const field of form.fields) {
    const section = element('section'); const id = `field-${field.name}`
    const label = element('label', field.label, 'title'); label.htmlFor = id
    if (field.required) label.append(element('span', 'Required', 'required'))
    const hint = field.helperText ? element('p', field.helperText, 'hint') : null
    if (hint) hint.id = `${id}-hint`
    const inputs = []
    if (['radio', 'checkbox'].includes(field.type)) {
      const fieldset = element('fieldset'); const legend = element('legend'); legend.append(...label.childNodes); fieldset.append(legend)
      for (const option of field.options || []) {
        const choice = element('label', '', 'choice'); const input = doc.createElement('input'); input.type = field.type; input.name = field.name; input.value = option; input.required = !!field.required
        choice.append(input, element('span', option)); fieldset.append(choice); inputs.push(input)
      }
      if (hint) fieldset.append(hint)
      section.append(fieldset)
    } else if (field.type === 'file') {
      section.append(label); if (hint) section.append(hint)
      const picker = element('label', 'Add photos and videos', 'picker'); const input = doc.createElement('input'); input.type = 'file'; input.accept = field.accept; input.multiple = true; input.id = id
      input.addEventListener('change', () => { files.push(...Array.from(input.files || [])); input.value = ''; drawFiles(list) })
      picker.append(input); section.append(picker)
      const list = element('ul', '', 'files'); section.append(list); controls.set('__filesList', list); inputs.push(input)
    } else {
      section.append(label); if (hint) section.append(hint)
      const input = doc.createElement(field.type === 'textarea' ? 'textarea' : 'input'); if (field.type !== 'textarea') input.type = field.type
      input.id = id; input.name = field.name; input.required = !!field.required; input.placeholder = field.placeholder || ''; if (hint) input.setAttribute('aria-describedby', hint.id)
      section.append(input); inputs.push(input)
    }
    controls.set(field.name, inputs); $('fields').append(section)
  }
  $('submit').textContent = form.submitButtonLabel
  $('feedback').hidden = false
  $('feedback').addEventListener('submit', async event => {
    event.preventDefault(); if (busy || !$('feedback').reportValidity()) return
    busy = true; $('error').hidden = true
    const all = $('feedback').querySelectorAll('input,textarea,button'); all.forEach(el => { el.disabled = true })
    const notify = text => { $('status').textContent = text }
    try {
      const data = {}
      for (const field of form.fields) {
        const inputs = controls.get(field.name)
        if (field.type === 'file') continue
        data[field.name] = ['radio', 'checkbox'].includes(field.type) ? (field.type === 'checkbox' ? inputs.filter(i => i.checked).map(i => i.value) : inputs.find(i => i.checked)?.value || '') : inputs[0].value
      }
      data.memory_photos = await uploader.uploadAll(files, notify)
      notify('Sending your feedback…')
      // Do not automatically retry the answer POST: a lost response could already have been saved.
      const r = await fetch(`/api/forms/${FORM_ID}/submit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ issueId: issue?.id || undefined, sharedByFriendId: params.get('sharedBy') || undefined, slackChannelId: params.get('slackChannelId') || undefined, data }) })
      const json = await r.json()
      if (!r.ok || !json.success) throw new Error('Your feedback could not be confirmed. Your selected files and completed uploads are still here. Please try again or contact your travel coordinator.')
      $('feedback').hidden = true; $('success').hidden = false; $('success').focus()
    } catch (error) {
      showError(error instanceof TypeError ? 'Connection interrupted. Your selected files and completed uploads are still here. Please retry, or contact your travel coordinator if you are unsure whether your feedback was received.' : error.message)
      all.forEach(el => { el.disabled = false }); $('status').textContent = ''; busy = false
    }
  })
  addEventListener('beforeunload', event => { if (busy) { event.preventDefault(); event.returnValue = '' } })
}
if (typeof document !== 'undefined') mountFeedback()
