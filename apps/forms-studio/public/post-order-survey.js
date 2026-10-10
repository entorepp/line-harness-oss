(() => {
  'use strict'

  const script = document.currentScript
  const formId = script?.dataset.formId
  if (!formId) return

  function applyRequestedLanguage() {
    const language = new URLSearchParams(window.location.search).get('lang')
    if (!['en', 'ja'].includes(language) || document.documentElement.lang === language) return
    document.querySelector(`[data-lang-btn="${language}"]`)?.click()
  }
  applyRequestedLanguage()
  window.addEventListener('flat-form-draft-ready', applyRequestedLanguage)

  const QUESTION_COUNT = 54
  const FILE_QUESTIONS = new Set([5, 7, 13])
  const STORE_KEY = 'flattravel_intake_v2'
  const PRIVATE_UPLOAD_ACCESS = 'form-private'
  const selectedFiles = new Map()
  const uploadedFileCache = new Map()
  const MAX_FILE_BYTES = 25 * 1024 * 1024

  const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim()
  const isJapanese = () => document.documentElement.lang === 'ja'
  const text = (english, japanese) => isJapanese() ? japanese : english

  function questionNumber(card) {
    const labelMatch = clean(card.querySelector('.qn')?.textContent).match(/^Q(\d+)$/)
    if (labelMatch) return Number(labelMatch[1])
    for (const control of card.querySelectorAll('[data-k]')) {
      const keyMatch = String(control.dataset.k || '').match(/^q(\d+)/)
      if (keyMatch) return Number(keyMatch[1])
    }
    return null
  }

  function isConditionallyVisible(element) {
    if (element.hidden) return false
    return !element.closest('[hidden]')
  }

  function blockLabel(card) {
    const block = card.closest('.person')
    if (!block) return ''
    const title = clean(block.querySelector('.ptitle')?.textContent)
    const name = clean(block.querySelector('.pname')?.textContent)
    return [title, name].filter(Boolean).join(' — ')
  }

  function fileInputsForQuestion(number) {
    return Array.from(document.querySelectorAll('.q input[type="file"]'))
      .filter((input) => questionNumber(input.closest('.q')) === number)
  }

  function fileInputKey(input) {
    const card = input.closest('.q')
    const number = card ? questionNumber(card) : null
    if (!number) return ''
    return `q${number}:${fileInputsForQuestion(number).indexOf(input)}`
  }

  function restoreFileSelection(input, files) {
    if (!files?.length || typeof DataTransfer === 'undefined') return
    try {
      const transfer = new DataTransfer()
      files.forEach((file) => transfer.items.add(file))
      input.files = transfer.files
    } catch (_error) {
      // The in-memory selection is still used for validation and upload when a
      // WebView does not allow assigning FileList.
    }
  }

  function updateFileStatus(input, files) {
    const pick = input.closest('.filepick')
    const status = pick?.querySelector('.filestatus')
    if (!status) return
    const summary = files.length ? text(`${files.length} files selected`, `${files.length}件のファイルを選択済み`)
      : text('No file selected', 'ファイルが選択されていません')
    if (status.textContent !== summary) status.textContent = summary
    if (input._displayedFiles?.length === files.length && files.every((file, i) => input._displayedFiles[i] === file)) return
    input._displayedFiles = [...files]
    let list = pick.parentElement.querySelector('.selected-file-list')
    if (!list) {
      list = document.createElement('ul')
      list.className = 'selected-file-list'
      list.style.cssText = 'padding-left:20px;font-size:14px;overflow-wrap:anywhere'
      pick.after(list)
    }
    list.replaceChildren()
    for (const file of files) {
      const row = document.createElement('li')
      const name = document.createElement('span')
      name.textContent = `${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MiB) `
      const remove = document.createElement('button')
      remove.type = 'button'
      remove.textContent = text('Remove', '削除')
      remove.setAttribute('aria-label', text(`Remove ${file.name}`, `${file.name}を削除`))
      remove.addEventListener('click', () => {
        if (document.querySelector('button.submit')?.dataset.submitting === 'true') return
        const remaining = filesForInput(input).filter(item => item !== file)
        selectedFiles.set(input.dataset.privateUploadKey || fileInputKey(input), remaining)
        input.value = ''
        restoreFileSelection(input, remaining)
        updateFileStatus(input, remaining)
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
      row.append(name, remove)
      list.append(row)
    }
  }

  function decorateFileInputs() {
    for (const input of document.querySelectorAll('.q input[type="file"]')) {
      input.multiple = true
      // Do not let an OS MIME filter hide a valid cloud/phone document. Validate
      // the supported formats by content after selection instead.
      if (!input.dataset.acceptedTypes) input.dataset.acceptedTypes = input.accept
      input.removeAttribute('accept')
      const key = fileInputKey(input)
      if (!key) continue
      input.dataset.privateUploadKey = key
      const files = selectedFiles.get(key)
      if (files?.length && !input.files?.length) restoreFileSelection(input, files)
      updateFileStatus(input, files || Array.from(input.files || []))
    }
  }

  document.addEventListener('change', (event) => {
    const input = event.target
    if (!(input instanceof HTMLInputElement) || input.type !== 'file') return
    const key = input.dataset.privateUploadKey || fileInputKey(input)
    if (!key) return
    const incoming = Array.from(input.files || [])
    const previous = selectedFiles.get(key) || []
    const files = [...previous]
    const rejected = []
    for (const file of incoming) {
      if (!file.size || file.size > MAX_FILE_BYTES) { rejected.push(file); continue }
      if (!files.some(item => fileFingerprint([item]) === fileFingerprint([file]))) files.push(file)
    }
    selectedFiles.set(key, files)
    input.value = ''
    restoreFileSelection(input, files)
    updateFileStatus(input, files)
    const inline = input.closest('.q')?.querySelector('.filerr')
    if (inline) { inline.textContent = ''; inline.style.display = 'none' }
    if (rejected.length) fileError(input, text(
      `${rejected.map(file => file.name).join(', ')} could not be added. Each file must be non-empty and at most 25 MiB (26.2 MB). Your other files are still selected.`,
      `${rejected.map(file => file.name).join(', ')} は追加できません。空でない25 MiB（約26.2 MB）以下のファイルを選択してください。他の添付は保持されています。`,
    ))
  })

  document.addEventListener('click', (event) => {
    const remove = event.target.closest?.('.pdel')
    const section = remove?.closest?.('section.sec')
    if (!remove || section?.id !== 's3') return
    const blocks = Array.from(section.querySelectorAll('.person'))
    const removedIndex = blocks.indexOf(remove.closest('.person'))
    if (removedIndex < 0) return
    for (let index = removedIndex; index < blocks.length - 1; index += 1) {
      const next = selectedFiles.get(`q13:${index + 1}`)
      if (next) selectedFiles.set(`q13:${index}`, next)
      else selectedFiles.delete(`q13:${index}`)
    }
    selectedFiles.delete(`q13:${blocks.length - 1}`)
  }, true)

  const observer = new MutationObserver(() => requestAnimationFrame(decorateFileInputs))
  const formRoot = document.getElementById('form')
  if (formRoot) observer.observe(formRoot, { childList: true, subtree: true })
  decorateFileInputs()

  function selectedControlText(control) {
    if (control instanceof HTMLSelectElement) {
      return clean(control.selectedOptions[0]?.textContent)
    }
    if (control.matches('input[type="radio"],input[type="checkbox"]')) {
      if (!control.checked) return ''
      return clean(
        control.closest('label')?.querySelector(
          '.cardname,.upthumbname,.t,span',
        )?.textContent || control.value,
      )
    }
    return clean(control.value)
  }

  function controlContext(control) {
    const row = control.closest('.arow,.gitem,.pcitem,.fcell')
    return clean(row?.querySelector('.alb,.gname,.pclb,.flb')?.textContent)
  }

  function serializeQuestionCard(card) {
    const lines = []
    const handled = new Set()

    const radioGroups = new Map()
    for (const radio of card.querySelectorAll('input[type="radio"]')) {
      const group = radioGroups.get(radio.name) || []
      group.push(radio)
      radioGroups.set(radio.name, group)
    }
    for (const radios of radioGroups.values()) {
      const checked = radios.find((radio) => radio.checked)
      if (!checked) continue
      const value = selectedControlText(checked)
      const context = controlContext(checked)
      if (value) lines.push(context ? `${context}: ${value}` : value)
      radios.forEach((radio) => handled.add(radio))
    }

    for (const checkbox of card.querySelectorAll('input[type="checkbox"]')) {
      handled.add(checkbox)
      if (!checkbox.checked) continue
      const value = selectedControlText(checkbox)
      const context = controlContext(checkbox)
      if (value) lines.push(context ? `${context}: ${value}` : value)
    }

    const plainControls = Array.from(card.querySelectorAll('input,select,textarea'))
      .filter((control) => control.type !== 'file' && !handled.has(control))
    const useLabels = plainControls.length > 1
    let unnamedIndex = 0
    for (const control of plainControls) {
      const value = selectedControlText(control)
      if (!value) continue
      unnamedIndex += 1
      const context = controlContext(control)
      const label = context || (useLabels ? `${text('Entry', '入力')}${unnamedIndex}` : '')
      lines.push(label ? `${label}: ${value}` : value)
    }
    return lines.join('\n')
  }

  function serializeInterests() {
    const categories = Array.from(document.querySelectorAll('.up .upcat'))
      .map((category) => clean(category.firstElementChild?.textContent || category.textContent))
    const lines = []
    for (const input of document.querySelectorAll('.up input[type="checkbox"][data-k]')) {
      if (!input.checked) continue
      const match = String(input.dataset.k).match(/^up_(\d+)_/)
      const category = match ? categories[Number(match[1])] : ''
      const label = clean(
        input.closest('label')?.querySelector('.upthumbname,.t')?.textContent || input.value,
      )
      lines.push(category ? `${category}: ${label}` : label)
    }
    return lines.join('\n')
  }

  function serializeAnswers() {
    const grouped = new Map()
    for (let number = 1; number <= QUESTION_COUNT; number += 1) grouped.set(number, [])

    for (const card of document.querySelectorAll('.q')) {
      if (!isConditionallyVisible(card)) continue
      const number = questionNumber(card)
      if (!number || FILE_QUESTIONS.has(number)) continue
      const value = serializeQuestionCard(card)
      if (!value) continue
      const label = blockLabel(card)
      grouped.get(number).push(label ? `${label}\n${value}` : value)
    }

    const data = {}
    for (let number = 1; number <= QUESTION_COUNT; number += 1) {
      data[`q${number}`] = grouped.get(number).join('\n\n')
    }
    data.additional_interests = serializeInterests()
    data.response_language = isJapanese() ? 'Japanese / 日本語' : 'English / 英語'
    data.consent = document.getElementById('agree')?.checked
      ? 'Agreed / 同意済み'
      : ''
    return data
  }

  function filesForInput(input) {
    const key = input.dataset.privateUploadKey || fileInputKey(input)
    return selectedFiles.get(key) || Array.from(input.files || [])
  }

  function acceptedFile(input, file) {
    const accept = String(input.dataset?.acceptedTypes || input.accept || '').split(',').map(item => item.trim()).filter(Boolean)
    return !accept.length || accept.some(rule => rule === file.type
      || (rule.endsWith('/*') && file.type.startsWith(rule.slice(0, -1))))
  }

  async function fileForUpload(file) {
    const header = file.slice(0, 1024)
    const buffer = typeof header.arrayBuffer === 'function' ? await header.arrayBuffer()
      : await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result)
        reader.onerror = () => reject(new Error(text('This file could not be read. Please select it again.', 'ファイルを読み込めませんでした。もう一度選択してください。')))
        reader.readAsArrayBuffer(header)
      })
    const bytes = new Uint8Array(buffer)
    const ascii = (start, end) => String.fromCharCode(...bytes.slice(start, end))
    let type = ''
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) type = 'image/jpeg'
    else if ([137,80,78,71,13,10,26,10].every((value, index) => bytes[index] === value)) type = 'image/png'
    else if (['GIF87a', 'GIF89a'].includes(ascii(0, 6))) type = 'image/gif'
    else if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') type = 'image/webp'
    else if (ascii(0, 2) === 'BM') type = 'image/bmp'
    else if ([0x49,0x49,0x2a,0].every((v,i) => bytes[i] === v)
      || [0x4d,0x4d,0,0x2a].every((v,i) => bytes[i] === v)) type = 'image/tiff'
    else if (ascii(4, 8) === 'ftyp') {
      const brands = [ascii(8, 12)]
      const boxSize = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0)
      for (let i = 16; i + 4 <= Math.min(boxSize, bytes.length); i += 4) brands.push(ascii(i, i + 4))
      if (brands.some(b => ['avif', 'avis'].includes(b))) type = 'image/avif'
      else if (brands.some(b => ['heic', 'heix', 'hevc', 'hevx'].includes(b))) type = 'image/heic'
      else if (brands.some(b => ['mif1', 'msf1'].includes(b))) type = 'image/heif'
    }
    if (!type && /%PDF-\d\.\d/.test(ascii(0, 1024))) type = 'application/pdf'
    if (!type) throw new Error(text(
      'The file format could not be recognised. Please select a photo or PDF in one of the formats listed above.',
      'ファイル形式を確認できませんでした。上記に記載された写真またはPDF形式を選択してください。',
    ))
    // Preserve the original bytes; mobile pickers can report missing or incorrect MIME types.
    return new Blob([file], { type })
  }

  function requiredCardComplete(card) {
    const controls = Array.from(card.querySelectorAll('input,select,textarea'))
    const fileInputs = controls.filter((control) => control.type === 'file')
    if (fileInputs.length) return fileInputs.every((input) => filesForInput(input).length > 0)

    const radios = controls.filter((control) => control.type === 'radio')
    if (radios.length) {
      const names = [...new Set(radios.map((radio) => radio.name))]
      return names.every((name) => radios.some((radio) => radio.name === name && radio.checked))
    }

    const checkboxes = controls.filter((control) => control.type === 'checkbox')
    if (checkboxes.length) return checkboxes.some((checkbox) => checkbox.checked)

    const requiredControls = controls.filter((control) => control.dataset.optional !== 'true')
    return requiredControls.length > 0 && requiredControls.every((control) => clean(control.value))
  }

  function setCardInvalid(card, invalid) {
    for (const control of card.querySelectorAll('input,select,textarea')) {
      const plain = !['file', 'radio', 'checkbox'].includes(control.type)
      const invalidControl = invalid && (plain
        ? control.dataset.optional !== 'true' && !clean(control.value) : true)
      if (invalidControl) control.setAttribute('aria-invalid', 'true')
      else control.removeAttribute('aria-invalid')
    }
    card.style.outline = invalid ? '2px solid #b42318' : ''
    card.style.outlineOffset = invalid ? '2px' : ''
  }

  function showSubmitMessage(message, success = false) {
    document.querySelector('.submit-error,.submit-success')?.remove()
    const result = document.createElement('p')
    result.className = success ? 'submit-success' : 'submit-error'
    result.style.cssText = [
      'margin:12px 0 0',
      `color:${success ? 'var(--accent)' : '#b42318'}`,
      'font-size:14px',
      'font-weight:700',
      'text-align:center',
    ].join(';')
    result.textContent = message
    document.querySelector('.submit-wrap')?.appendChild(result)
  }

  function revealCard(card) {
    const section = card.closest('section.sec')
    if (section && !section.classList.contains('open')) section.querySelector('h2')?.click()
    const block = card.closest('.person')
    if (block?.classList.contains('shut')) block.querySelector('.phead')?.click()
    card.scrollIntoView({ behavior: 'smooth', block: 'center' })
    const target = card.querySelector('[aria-invalid="true"]') || card.querySelector('input,select,textarea')
    target?.focus({ preventScroll: true })
  }

  function fileError(input, message) {
    const card = input.closest('.q')
    const label = clean(card.querySelector('.qt')?.textContent)
    const detail = `${label}: ${message}`
    const inline = card.querySelector('.filerr')
    if (inline) { inline.textContent = message; inline.style.display = 'block' }
    setCardInvalid(card, true)
    showSubmitMessage(detail)
    revealCard(card)
    return detail
  }

  function validateBeforeSubmit() {
    let firstInvalid = null
    for (const card of document.querySelectorAll('.q')) {
      if (!isConditionallyVisible(card) || !card.querySelector('.must')) {
        setCardInvalid(card, false)
        continue
      }
      const flightCard = [42, 43].includes(questionNumber(card))
      const firstValue = card.querySelector('input')?.value?.trim() || ''
      const flightUnknown = flightCard && /^(not booked|not flying|unknown|未定|利用なし)$/i.test(firstValue)
      const invalid = !flightUnknown && !requiredCardComplete(card)
      setCardInvalid(card, invalid)
      if (invalid && !firstInvalid) firstInvalid = card
    }

    for (const card of document.querySelectorAll('.q')) {
      if (!isConditionallyVisible(card)) continue
      const number = questionNumber(card)
      if ([42, 43].includes(number)) {
        const controls = [...card.querySelectorAll('input')]
        const flight = (controls[0]?.value || '').normalize('NFKC').replace(/\s+/g, '').toUpperCase()
        const unknown = /^(NOTBOOKED|NOTFLYING|UNKNOWN|未定|利用なし)$/.test(flight)
        const day = controls[1]?.value || ''
        const validDate = /^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(Date.parse(day)) && new Date(day).toISOString().slice(0, 10) === day
        if (!unknown && (!/^(?:[A-Z]{2}|[A-Z][0-9]|[0-9][A-Z])[0-9]{1,4}[A-Z]?$/.test(flight) || !validDate)) {
          setCardInvalid(card, true)
          showSubmitMessage(text('Please enter a complete flight number (for example AF274) and the date in Japan. Airline name alone is not enough. If undecided, enter Not booked.', '便名はAF274のように番号まで入力し、日本での日付を選んでください。航空会社名だけでは送信できません。未定ならNot bookedと入力してください。'))
          revealCard(card)
          return false
        }
        if (!unknown) controls[0].value = flight
      }
      if ([17, 18, 22].includes(number)) {
        const inputs = [...card.querySelectorAll('input')]
        const invalid = inputs.some((input, index) => {
          if (!input.value.trim()) return false
          const maximum = number === 17 ? [300, 200, 250][index] : number === 22 ? [250, 500][index] : 500
          return !/^\d+(?:\.\d+)?$/.test(input.value.trim()) || !(Number(input.value) > (number === 22 && index === 0 ? 30 : 0) && Number(input.value) <= maximum)
        })
        if (invalid) {
          setCardInvalid(card, true)
          showSubmitMessage(text('Please enter a valid measurement using centimetres (cm) or kilograms (kg). Leave unknown equipment measurements blank.', '寸法はcm、重量はkgの正しい数値をご入力ください。不明な機器の寸法・重量は空欄で構いません。'))
          revealCard(card)
          return false
        }
      }
    }

    for (const input of document.querySelectorAll('.q input[type="file"]')) {
      if (!isConditionallyVisible(input)) continue
      const files = filesForInput(input)
      const invalidFile = files.find(file => !file.size || file.size > MAX_FILE_BYTES)
      if (invalidFile) {
        fileError(input, text(
          `${invalidFile.name}: each file must be non-empty and at most 25 MiB (26.2 MB).`,
          `${invalidFile.name}: 空でない25 MiB（約26.2 MB）以下のファイルを選択してください。`,
        ))
        return false
      }
    }

    if (firstInvalid) {
      showSubmitMessage(text(
        'Please complete the required question highlighted above.',
        '赤枠の必須項目をご入力ください。',
      ))
      revealCard(firstInvalid)
      return false
    }
    if (!document.getElementById('agree')?.checked) {
      showSubmitMessage(text(
        'Please read and agree to the statements above before sending.',
        '上記内容をご確認のうえ、同意にチェックしてください。',
      ))
      return false
    }
    return true
  }

  function fileFingerprint(files) {
    return files.map((file) => [file.name, file.size, file.type, file.lastModified].join(':')).join('|')
  }

  async function uploadPrivateFile(file, fieldName, input) {
    const payload = new FormData()
    const normalized = await fileForUpload(file)
    if (input && !acceptedFile(input, normalized)) throw new Error(text(
      'Please use one of the file formats listed for this question.',
      'この項目に記載されたファイル形式を選択してください。',
    ))
    payload.append('file', normalized, file.name)
    payload.append('access', PRIVATE_UPLOAD_ACCESS)
    payload.append('formId', formId)
    payload.append('fieldName', fieldName)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 300_000)
    let response
    try {
      response = await fetch('/api/upload', { method: 'POST', body: payload, signal: controller.signal })
    } catch (error) {
      throw new Error(error?.name === 'AbortError' ? text(
        'The upload timed out. Your answers are still here. Check your connection and try again.',
        'アップロードがタイムアウトしました。回答は保持されています。通信状況を確認して再試行してください。',
      ) : text(
        'The upload could not connect. Your answers are still here. Check your connection and try again.',
        'アップロードの通信に失敗しました。回答は保持されています。通信状況を確認して再試行してください。',
      ))
    } finally { clearTimeout(timer) }
    const result = await response.json().catch(() => ({}))
    if (!response.ok || !result.success || result.data?.access !== PRIVATE_UPLOAD_ACCESS) {
      throw new Error(result.error || text(
        `${file.name} could not be uploaded.`,
        `${file.name} のアップロードに失敗しました。`,
      ))
    }
    if (!result.data.expiresAt || !String(result.data.url || '').includes('/api/form-files/')) {
      throw new Error(text(
        'The attachment was not returned through the protected file path.',
        '添付ファイルが保護された経路で返されませんでした。',
      ))
    }
    return result.data
  }

  async function appendFileAnswers(data) {
    for (const number of FILE_QUESTIONS) data[`q${number}`] = []

    for (const input of document.querySelectorAll('.q input[type="file"]')) {
      if (!isConditionallyVisible(input)) continue
      const card = input.closest('.q')
      const number = questionNumber(card)
      if (!FILE_QUESTIONS.has(number)) continue
      const files = filesForInput(input)
      const context = blockLabel(card)
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index]
        let cached = uploadedFileCache.get(file)
        let uploaded = cached?.get(number)
        if (!uploaded || Date.parse(uploaded.expiresAt) <= Date.now()) {
          const progress = text(`Uploading ${file.name} (${index + 1}/${files.length})… Please keep this page open.`,
            `${file.name} をアップロード中（${index + 1}/${files.length}）… この画面を開いたままお待ちください。`)
          showSubmitMessage(progress, true)
          const inline = card.querySelector('.filerr')
          if (inline) { inline.textContent = ''; inline.style.display = 'none' }
          try { uploaded = await uploadPrivateFile(file, `q${number}`, input) }
          catch (error) { throw new Error(fileError(input, `${file.name}: ${error.message}`)) }
          if (!cached) { cached = new Map(); uploadedFileCache.set(file, cached) }
          // Commit each success immediately so Retry never repeats completed files.
          cached.set(number, uploaded)
        }
        data[`q${number}`].push({ ...uploaded,
          fileName: context ? `${context} — ${uploaded.fileName}` : uploaded.fileName,
        })
      }
    }
  }

  function leadTravellerName() {
    const card = Array.from(document.querySelectorAll('.q'))
      .find((candidate) => questionNumber(candidate) === 1)
    if (!card) return ''
    return Array.from(card.querySelectorAll('input'))
      .map((input) => clean(input.value))
      .filter(Boolean)
      .join(' ')
  }

  async function submitSurvey() {
    const button = document.querySelector('button.submit')
    if (!button || button.dataset.submitting === 'true' || button.dataset.submitted === 'true') return
    document.querySelector('.submit-error,.submit-success')?.remove()
    if (!validateBeforeSubmit()) return

    button.dataset.submitting = 'true'
    button.disabled = true
    button.textContent = text('Uploading and sending…', 'アップロード・送信中…')
    try {
      const data = serializeAnswers()
      await appendFileAnswers(data)
      showSubmitMessage(text('Attachments uploaded. Sending your answers…', '添付完了。回答を送信中…'), true)
      const params = new URLSearchParams(window.location.search)
      const submissionController = new AbortController()
      const submissionTimer = setTimeout(() => submissionController.abort(), 90_000)
      const response = await fetch(`/api/forms/${formId}/submit`, {
        signal: submissionController.signal,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          issueId: params.get('issue') || undefined,
          sharedByFriendId: params.get('sharedBy') || undefined,
          slackChannelId: params.get('slackChannelId') || undefined,
          responderDisplayName: leadTravellerName(),
          data,
        }),
      }).catch(() => { throw new Error(text(
        'We could not confirm that your answers were received. Your answers and uploaded files are still here. Check your connection before trying Send again. Please keep this page open.',
        '回答の受信を確認できませんでした。回答とアップロード済みの添付は保持されています。画面を開いたまま通信状況を確認し、再度送信してください。',
      )) }).finally(() => clearTimeout(submissionTimer))
      const result = await response.json().catch(() => ({}))
      if (!response.ok || !result.success) {
        throw new Error(result.error || text('Submission failed.', '送信に失敗しました。'))
      }
      window.FlatFormDraft?.clear().catch(() => {})
      try { localStorage.removeItem(STORE_KEY) } catch (_error) {}
      button.dataset.submitted = 'true'
      button.dataset.submitting = 'false'
      button.textContent = text('Sent', '送信しました')
      button.disabled = true
      showSubmitMessage(text(
        'Thank you. Your answers and attachments have been sent securely.',
        'ありがとうございます。ご回答と添付ファイルを安全に送信しました。',
      ), true)
    } catch (error) {
      button.dataset.submitting = 'false'
      button.textContent = text('Retry Send', '再度送信')
      button.disabled = !document.getElementById('agree')?.checked
      showSubmitMessage(error instanceof Error ? error.message : text(
        'Submission failed.',
        '送信に失敗しました。',
      ))
    }
  }

  document.addEventListener('input', (event) => {
    const card = event.target.closest?.('.q')
    if (card) setCardInvalid(card, false)
  })
  document.querySelector('button.submit')?.addEventListener('click', submitSurvey)
})()
