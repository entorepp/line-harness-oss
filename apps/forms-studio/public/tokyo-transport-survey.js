(() => {
  'use strict'

  const FORM_ID = '96ff4bc9-40df-4b10-a3db-486f82374b30'
  const API_URL = ''

  const clean = (value) => String(value ?? '').trim()
  const questionContainer = (number) => Array.from(document.querySelectorAll('.q')).find(
    (container) => clean(container.querySelector('.qn')?.textContent) === `Q${number}`,
  )
  const controlValue = (control) => clean(control?.value)
  const checkedLabels = (container) => Array.from(
    container?.querySelectorAll('label.opt:has(input:checked)') ?? [],
  ).map((label) => clean(label.querySelector('span')?.textContent)).filter(Boolean)

  function serializeSimple(number) {
    const container = questionContainer(number)
    return controlValue(container?.querySelector('input[type="text"], input[type="email"], input[type="tel"], textarea'))
  }

  function serializeVehicleRows() {
    return Array.from(document.querySelectorAll('#veh-rows .veh-row')).map((row) => {
      const [vehicle, passengers, capacity] = Array.from(row.querySelectorAll('input')).map(controlValue)
      if (!vehicle && !passengers && !capacity) return ''
      return [
        vehicle ? `車種: ${vehicle}` : '',
        passengers ? `同乗可能人数: ${passengers}` : '',
        capacity ? `リフト・スロープの耐荷重: ${capacity}` : '',
      ].filter(Boolean).join(' / ')
    }).filter(Boolean).join('\n')
  }

  function serializeFixedMatrix(number, columns) {
    const container = questionContainer(number)
    if (!container) return ''
    const lines = []
    for (const row of container.querySelectorAll('tbody tr')) {
      const origin = clean(row.querySelector('th')?.textContent)
      Array.from(row.querySelectorAll('input')).forEach((input, index) => {
        const value = controlValue(input)
        if (value) lines.push(`${origin} → ${columns[index]}: ${value}円`)
      })
    }
    return lines.join('\n')
  }

  function serializeCustomAreaMatrix() {
    const container = questionContainer(11)
    if (!container) return ''
    const areaNames = Array.from(container.querySelectorAll('thead input')).map(controlValue)
    const lines = []
    if (areaNames.some(Boolean)) {
      lines.push(`エリア名: ${areaNames.map((name, index) => name || `エリア${index + 1}`).join(' / ')}`)
    }
    for (const row of container.querySelectorAll('tbody tr')) {
      const origin = clean(row.querySelector('th')?.textContent)
      Array.from(row.querySelectorAll('input')).forEach((input, index) => {
        const value = controlValue(input)
        if (value) lines.push(`${origin} → ${areaNames[index] || `エリア${index + 1}`}: ${value}円`)
      })
    }
    return lines.join('\n')
  }

  function serializeMeetAndGreet() {
    const container = questionContainer(12)
    return Array.from(container?.querySelectorAll('.meet-row') ?? []).map((row) => {
      const value = controlValue(row.querySelector('input'))
      if (!value) return ''
      const place = clean(row.querySelector('.meet-pl')?.textContent)
      const service = clean(row.querySelector('.meet-sv')?.textContent)
      return `${place}（${service}）: ${value}円 / 回`
    }).filter(Boolean).join('\n')
  }

  function serializeCourseCost(number) {
    const container = questionContainer(number)
    if (!container) return ''
    const [vehicle, toll, parking] = Array.from(container.querySelectorAll('input')).map(controlValue)
    return [
      vehicle ? `車両代金: ${vehicle}円` : '',
      toll ? `高速代金: ${toll}円` : '',
      parking ? `駐車場代金: ${parking}円` : '',
    ].filter(Boolean).join('\n')
  }

  function serializeRadioWithDetail(number, detailSelector, detailLabel) {
    const container = questionContainer(number)
    if (!container) return ''
    const selected = checkedLabels(container)[0] || ''
    const detail = controlValue(container.querySelector(detailSelector))
    return [selected, detail ? `${detailLabel}: ${detail}` : ''].filter(Boolean).join('\n')
  }

  function serializeAdditionalFees() {
    return Array.from(document.querySelectorAll('#add-rows .add-row')).map((row) => {
      const [item, amount] = Array.from(row.querySelectorAll('input')).map(controlValue)
      if (!item && !amount) return ''
      return [item ? `項目: ${item}` : '', amount ? `金額: ${amount}` : ''].filter(Boolean).join(' / ')
    }).filter(Boolean).join('\n')
  }

  function serializeAnswers() {
    const hotelColumns = [
      'グルーブ新宿', '京王プラザホテル', 'ホテルサンルート新宿',
      'ザ・プリンスパークタワー', 'ホテルオークラ東京', 'グランドニッコー東京台場',
      '丸の内ホテル', 'キャピタルホテル東急', '三井ガーデンホテル東京',
      '渋谷ストリームホテル', 'MIMARU錦糸町', 'MIMARU池袋',
    ]
    const wardColumns = ['新宿区', '港区', '千代田区', '中央区', '渋谷区', '墨田区', '豊島区']
    const answers = {}

    for (let number = 1; number <= 44; number += 1) {
      answers[`q${number}`] = ''
    }

    for (const number of [1, 2, 3, 4, 5, 6, 13, 15, 17, 19, 21, 23, 25, 27, 29, 32, 35, 39, 42, 43, 44]) {
      answers[`q${number}`] = serializeSimple(number)
    }

    answers.q7 = checkedLabels(questionContainer(7))
    answers.q8 = serializeVehicleRows()
    answers.q9 = serializeFixedMatrix(9, hotelColumns)
    answers.q10 = serializeFixedMatrix(10, wardColumns)
    answers.q11 = serializeCustomAreaMatrix()
    answers.q12 = serializeMeetAndGreet()

    for (const number of [14, 16, 18, 20, 22, 24, 26, 28, 30, 33]) {
      answers[`q${number}`] = serializeCourseCost(number)
    }

    answers.q31 = serializeRadioWithDetail(31, '.amt', '別途必要な場合の金額（円）')
    answers.q34 = serializeRadioWithDetail(34, '.amt', '別途必要な場合の金額（円）')
    answers.q36 = serializeRadioWithDetail(36, 'textarea', '発生する場合')
    answers.q37 = serializeRadioWithDetail(37, 'textarea', '条件')
    answers.q38 = serializeAdditionalFees()
    answers.q40 = checkedLabels(questionContainer(40))

    const q41 = questionContainer(41)
    const q41Values = checkedLabels(q41)
    const q41Other = controlValue(q41?.querySelector('input.line'))
    if (q41Other) q41Values.push(`その他: ${q41Other}`)
    answers.q41 = q41Values

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

  async function submitSurvey() {
    const button = document.querySelector('button.submit')
    if (!button || button.dataset.submitting === 'true') return

    button.dataset.submitting = 'true'
    button.disabled = true
    const originalLabel = button.textContent
    button.textContent = '送信中…'
    document.querySelector('.submit-error')?.remove()

    try {
      const data = serializeAnswers()
      const response = await fetch(`${API_URL}/api/forms/${FORM_ID}/submit`, {
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

  document.querySelector('button.submit')?.addEventListener('click', submitSurvey)
})()
