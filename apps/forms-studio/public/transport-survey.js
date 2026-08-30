(() => {
  'use strict'

  const script = document.currentScript
  const formId = script?.dataset.formId
  const questionCount = Number(script?.dataset.questionCount || 0)
  const apiUrl = ''

  if (!formId || !questionCount) return

  const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim()
  const questionNumber = (container) => {
    const match = clean(container.querySelector('.qn')?.textContent).match(/^Q(\d+)$/)
    return match ? Number(match[1]) : null
  }
  const valueOf = (control) => clean(control?.value)
  const markHandled = (handled, controls) => {
    for (const control of controls) handled.add(control)
  }

  function serializeVehicleRows(container, lines, handled) {
    const rows = Array.from(container.querySelectorAll('#veh-rows .veh-row'))
    if (!rows.length) return
    const labels = Array.from(container.querySelectorAll('.veh-row .veh-lb'))
      .map((label) => clean(label.textContent))
    for (const row of rows) {
      const controls = Array.from(row.querySelectorAll('input'))
      const parts = controls.map((control, index) => {
        const value = valueOf(control)
        return value ? `${labels[index] || `項目${index + 1}`}: ${value}` : ''
      }).filter(Boolean)
      if (parts.length) lines.push(parts.join(' / '))
      markHandled(handled, controls)
    }
  }

  function serializeTable(container, lines, handled) {
    const table = container.querySelector('table')
    if (!table) return

    const headerRows = Array.from(table.querySelectorAll('thead tr'))
    const lastHeader = headerRows.at(-1)
    const rawHeaders = Array.from(lastHeader?.querySelectorAll('th,td') ?? [])
    const headerLabels = rawHeaders
      .filter((cell, index) => index > 0 || !cell.matches('.rh,.sub-rh'))
      .map((cell) => valueOf(cell.querySelector('input')) || clean(cell.textContent))

    for (const row of table.querySelectorAll('tbody tr')) {
      const rowLabel = clean(row.querySelector('th')?.textContent)
      const controls = Array.from(row.querySelectorAll('input,textarea,select'))
      controls.forEach((control, index) => {
        const value = valueOf(control)
        if (!value) return
        const columnLabel = headerLabels[index] || `項目${index + 1}`
        lines.push([rowLabel, columnLabel].filter(Boolean).join(' → ') + `: ${value}`)
      })
      markHandled(handled, controls)
    }
  }

  function serializeMeetRows(container, lines, handled) {
    for (const row of container.querySelectorAll('.meet-row')) {
      const controls = Array.from(row.querySelectorAll('input,textarea,select'))
      const place = clean(row.querySelector('.meet-pl')?.textContent)
      const service = clean(row.querySelector('.meet-sv')?.textContent)
      for (const control of controls) {
        const value = valueOf(control)
        if (value) lines.push(`${place}${service ? `（${service}）` : ''}: ${value}`)
      }
      markHandled(handled, controls)
    }
  }

  function serializeCostRows(container, lines, handled) {
    for (const costs of container.querySelectorAll('.costs')) {
      for (const control of costs.querySelectorAll('input,textarea,select')) {
        const value = valueOf(control)
        const labelledBlock = control.closest('.pair-item,.cost-lead')
        const label = clean(labelledBlock?.querySelector('.cost-n')?.textContent)
        if (value) lines.push(`${label || '金額'}: ${value}`)
        handled.add(control)
      }
    }

    for (const block of container.querySelectorAll('.cost-main,.cost-item')) {
      const control = block.querySelector('input,textarea,select')
      if (!control) continue
      const value = valueOf(control)
      const label = clean(
        block.querySelector('.cost-lb-main,.cost-lb')?.textContent,
      )
      if (value) lines.push(`${label || '金額'}: ${value}`)
      handled.add(control)
    }
  }

  function serializeAdditionalRows(container, lines, handled) {
    for (const row of container.querySelectorAll('#add-rows .add-row')) {
      const controls = Array.from(row.querySelectorAll('input'))
      const [item, amount] = controls.map(valueOf)
      if (item || amount) {
        lines.push([
          item ? `項目: ${item}` : '',
          amount ? `金額: ${amount}` : '',
        ].filter(Boolean).join(' / '))
      }
      markHandled(handled, controls)
    }
  }

  function serializeQuestion(container) {
    const lines = []
    const handled = new Set()

    serializeVehicleRows(container, lines, handled)
    serializeTable(container, lines, handled)
    serializeMeetRows(container, lines, handled)
    serializeCostRows(container, lines, handled)
    serializeAdditionalRows(container, lines, handled)

    const controls = Array.from(container.querySelectorAll('input,textarea,select'))
    let plainIndex = 0

    for (const control of controls) {
      if (handled.has(control)) continue

      if (control.matches('input[type="checkbox"],input[type="radio"]')) {
        if (!control.checked) continue
        const label = control.closest('label')
        const selected = clean(
          control.value || label?.querySelector('span')?.textContent || label?.textContent,
        )
        if (selected) lines.push(selected)
        continue
      }

      const value = valueOf(control)
      if (!value) continue
      plainIndex += 1

      const row = control.closest('.add-row,.veh-row,.meet-row')
      const nearbyLabel = clean(
        row?.querySelector('.add-lb,.add-lb2,.veh-lb,.meet-pl')?.textContent,
      )
      const prefix = controls.length > 1
        ? (nearbyLabel || `入力${plainIndex}`)
        : ''
      lines.push(prefix ? `${prefix}: ${value}` : value)
    }

    return lines.join('\n')
  }

  function serializeAnswers() {
    const answers = {}
    for (let number = 1; number <= questionCount; number += 1) {
      answers[`q${number}`] = ''
    }

    for (const container of document.querySelectorAll('.q')) {
      const number = questionNumber(container)
      if (!number || number > questionCount) continue
      answers[`q${number}`] = serializeQuestion(container)
    }
    return answers
  }

  function showSubmitError(message) {
    let error = document.querySelector('.submit-error')
    if (!error) {
      error = document.createElement('p')
      error.className = 'submit-error'
      error.style.cssText = 'margin:10px 0 0;color:#b42318;font-size:14px;text-align:center;'
      document.querySelector('.submit-wrap')?.appendChild(error)
    }
    error.textContent = message
  }

  const amountPattern = /^[¥￥]?\s*(?:\d{1,3}(?:,\d{3})*|\d+)\s*(?:円)?\s*$/

  function isValidAmount(control) {
    return amountPattern.test(valueOf(control))
  }

  function setInvalid(control, invalid) {
    if (invalid) {
      control.setAttribute('aria-invalid', 'true')
      control.style.outline = '2px solid #b42318'
      control.style.outlineOffset = '2px'
      return
    }
    control.removeAttribute('aria-invalid')
    control.style.removeProperty('outline')
    control.style.removeProperty('outline-offset')
  }

  function validateRequiredAnswers() {
    const invalidControls = []

    for (const costs of document.querySelectorAll('.costs')) {
      const vehicle = costs.querySelector('.cost-lead input.amt')
      const relatedCosts = Array.from(costs.querySelectorAll('input.must-in'))
      const controls = [vehicle, ...relatedCosts].filter(Boolean)
      const hasAnyAmount = controls.some((control) => valueOf(control))

      for (const control of controls) {
        control.setAttribute('aria-required', String(hasAnyAmount))
        const invalid = hasAnyAmount && !isValidAmount(control)
        setInvalid(control, invalid)
        if (invalid) invalidControls.push(control)
      }
    }

    if (!invalidControls.length) return true

    showSubmitError(
      '料金を入力する行程は、車両代金・高速代金・駐車場代金をすべて数字でご記入ください（かからない場合は0）。',
    )
    invalidControls[0]?.focus()
    return false
  }

  async function submitSurvey() {
    const button = document.querySelector('button.submit')
    if (!button || button.dataset.submitting === 'true') return

    document.querySelector('.submit-error')?.remove()
    if (!validateRequiredAnswers()) return

    button.dataset.submitting = 'true'
    button.disabled = true
    const originalLabel = button.textContent
    button.textContent = '送信中…'
    try {
      const data = serializeAnswers()
      const response = await fetch(`${apiUrl}/api/forms/${formId}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          responderDisplayName: clean(data.q2),
          data,
        }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok || !result.success) {
        throw new Error(result.error || '送信に失敗しました')
      }
      button.textContent = '送信しました'
      button.dataset.submitted = 'true'
    } catch (error) {
      button.dataset.submitting = 'false'
      button.disabled = false
      button.textContent = originalLabel
      showSubmitError(error instanceof Error ? error.message : '送信に失敗しました')
    }
  }

  document.addEventListener('input', (event) => {
    if (event.target instanceof HTMLInputElement) setInvalid(event.target, false)
  })
  document.addEventListener('change', (event) => {
    if (!(event.target instanceof HTMLInputElement)) return
    setInvalid(event.target, false)
  })
  document.querySelector('button.submit')?.addEventListener('click', submitSurvey)
})()
