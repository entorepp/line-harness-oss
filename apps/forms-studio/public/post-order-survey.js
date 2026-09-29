(() => {
  'use strict'

  const script = document.currentScript
  const formId = script?.dataset.formId
  if (!formId) return

  const QUESTION_COUNT = 53
  const FILE_QUESTIONS = new Set([5, 7, 13])
  const STORE_KEY = 'flattravel_intake_v2'
  const PRIVATE_UPLOAD_ACCESS = 'form-private'
  const selectedFiles = new Map()
  const uploadedFileCache = new Map()
  const FILE_TYPES = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
    heic: 'image/heic', heif: 'image/heif', pdf: 'application/pdf',
  }
  const GENERIC_FILE_TYPES = new Set(['', 'application/octet-stream', 'binary/octet-stream'])

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
    const status = input.closest('.filepick')?.querySelector('.filestatus')
    if (!status) return
    status.textContent = files.length === 0
      ? text('No file selected', 'ファイルが選択されていません')
      : files.length === 1
        ? files[0].name
        : text(`${files.length} files selected`, `${files.length}件のファイルを選択済み`)
    status.title = files.map((file) => file.name).join(', ')
  }

  function decorateFileInputs() {
    for (const input of document.querySelectorAll('.q input[type="file"]')) {
      const accept = new Set(String(input.accept || '').split(',').filter(Boolean))
      for (const [extension, type] of Object.entries(FILE_TYPES)) {
        if (accept.has(type)) accept.add(`.${extension}`)
      }
      input.accept = [...accept].join(',')
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
    const files = Array.from(input.files || [])
    if (files.length) selectedFiles.set(key, files)
    else selectedFiles.delete(key)
    updateFileStatus(input, files)
    uploadedFileCache.delete(key)
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
      uploadedFileCache.delete(`q13:${index}`)
    }
    selectedFiles.delete(`q13:${blocks.length - 1}`)
    uploadedFileCache.delete(`q13:${blocks.length - 1}`)
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
    const accept = String(input.accept || '').split(',').map((item) => item.trim()).filter(Boolean)
    if (!accept.length) return true
    const declaredType = String(file.type || '').toLowerCase()
    const type = declaredType === 'image/jpg' ? 'image/jpeg'
      : GENERIC_FILE_TYPES.has(declaredType)
        ? FILE_TYPES[file.name.split('.').pop()?.toLowerCase()] : declaredType
    return accept.some((rule) => {
      if (rule.startsWith('.')) return file.name.toLowerCase().endsWith(rule.toLowerCase())
        && type === FILE_TYPES[rule.slice(1).toLowerCase()]
      if (rule.endsWith('/*')) return type?.startsWith(rule.slice(0, -1))
      return type === rule
    })
  }

  async function fileForUpload(file) {
    const declaredType = String(file.type || '').toLowerCase()
    if (!GENERIC_FILE_TYPES.has(declaredType) && declaredType !== 'image/jpg') return file
    const header = file.slice(0, 64)
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
    else if (ascii(0, 5) === '%PDF-') type = 'application/pdf'
    else if (ascii(4, 8) === 'ftyp') {
      const brand = ascii(8, 12)
      if (['heic', 'heix', 'hevc', 'hevx'].includes(brand)) type = 'image/heic'
      else if (['mif1', 'msf1'].includes(brand)) type = 'image/heif'
    }
    if (!type) throw new Error(text(
      'The file format could not be recognised. Please select a JPEG, PNG, HEIC or PDF file.',
      'ファイル形式を確認できませんでした。JPEG・PNG・HEIC・PDFを選択してください。',
    ))
    // Preserve the original bytes; only restore the missing browser MIME type.
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
      const invalid = !requiredCardComplete(card)
      setCardInvalid(card, invalid)
      if (invalid && !firstInvalid) firstInvalid = card
    }

    for (const input of document.querySelectorAll('.q input[type="file"]')) {
      if (!isConditionallyVisible(input)) continue
      const files = filesForInput(input)
      if (files.length > (input.multiple ? 3 : 1)) {
        firstInvalid ||= input.closest('.q')
        setCardInvalid(input.closest('.q'), true)
        fileError(input, text(
          `Please select no more than ${input.multiple ? 3 : 1} file(s).`,
          `ファイルは${input.multiple ? 3 : 1}件以内でお選びください。`,
        ))
        return false
      }
      const invalidFile = files.find((file) => file.size > 10 * 1024 * 1024 || !acceptedFile(input, file))
      if (invalidFile) {
        firstInvalid ||= input.closest('.q')
        setCardInvalid(input.closest('.q'), true)
        fileError(input, invalidFile.size > 10 * 1024 * 1024 ? text(
          `${invalidFile.name} is over 10MB. Please select a smaller file.`,
          `${invalidFile.name} は10MBを超えています。小さいファイルを選択してください。`,
        ) : text(
          `${invalidFile.name} is not a supported file format for this question.`,
          `${invalidFile.name} はこの項目で対応していないファイル形式です。`,
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

  async function uploadPrivateFile(file, fieldName) {
    const payload = new FormData()
    payload.append('file', await fileForUpload(file), file.name)
    payload.append('access', PRIVATE_UPLOAD_ACCESS)
    payload.append('formId', formId)
    payload.append('fieldName', fieldName)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 90_000)
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
      const key = input.dataset.privateUploadKey || fileInputKey(input)
      const files = filesForInput(input)
      const fingerprint = fileFingerprint(files)
      let uploaded = uploadedFileCache.get(key)
      if (!uploaded || uploaded.fingerprint !== fingerprint) {
        uploaded = {
          fingerprint,
          files: await Promise.all(files.map(async (file) => {
            try { return await uploadPrivateFile(file, `q${number}`) }
            catch (error) {
              throw new Error(fileError(input, `${file.name}: ${error.message}`))
            }
          })),
        }
        uploadedFileCache.set(key, uploaded)
      }
      const context = blockLabel(card)
      data[`q${number}`].push(...uploaded.files.map((file) => ({
        ...file,
        fileName: context ? `${context} — ${file.fileName}` : file.fileName,
      })))
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
    const originalLabel = button.textContent
    button.textContent = text('Uploading and sending…', 'アップロード・送信中…')
    try {
      const data = serializeAnswers()
      await appendFileAnswers(data)
      const params = new URLSearchParams(window.location.search)
      const response = await fetch(`/api/forms/${formId}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          issueId: params.get('issue') || undefined,
          sharedByFriendId: params.get('sharedBy') || undefined,
          slackChannelId: params.get('slackChannelId') || undefined,
          responderDisplayName: leadTravellerName(),
          data,
        }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok || !result.success) {
        throw new Error(result.error || text('Submission failed.', '送信に失敗しました。'))
      }
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
      button.textContent = originalLabel
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
