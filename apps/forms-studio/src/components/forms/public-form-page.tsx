'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { getVisibleFormFields } from '@line-crm/shared'
import type { Form as HarnessForm, FormField, FormIssue } from '@line-crm/shared'

const configuredApiUrl = process.env.NEXT_PUBLIC_API_URL
const API_URL = configuredApiUrl !== undefined
  ? configuredApiUrl
  : process.env.NODE_ENV === 'development'
    ? 'http://localhost:8787'
    : ''
const OTHER_SENTINEL = '__other__'

type ApiResponse<T> = {
  success: boolean
  data?: T
  error?: string
}

type PublicIssue = FormIssue & {
  publicUrl: string
  liffUrl: string | null
}

type MissingField = {
  name: string
  label: string
  reason: string
}

type UploadedFormFile = {
  url: string
  key: string
  fileName: string
  fileSize: number
  fileSizeFormatted: string
  isImage: boolean
  ext: string
  icon: string
}

const localizedTextDefaults: Record<string, {
  submitButtonLabel: string
  submittingLabel: string
  successTitle: string
  successDescription: string
  helperNote: string
  missingGuideTitle: string
  missingGuideBody: string
  remainingLabel: string
  submitShortcutLabel: string
  approximateDateHelper: string
  approximateStartDatePlaceholder: string
  approximateEndDatePlaceholder: string
}> = {
  ja: {
    submitButtonLabel: '送信',
    submittingLabel: '送信中...',
    successTitle: '送信が完了しました',
    successDescription: 'ご回答ありがとうございます。内容を確認してご連絡します。',
    helperNote: '公開フォームとして回答できます。',
    missingGuideTitle: '未入力の必須項目があります',
    missingGuideBody: '先頭の未入力項目へ移動しました。下のボタンから各項目へ直接ジャンプできます。',
    remainingLabel: '残り',
    submitShortcutLabel: '必須入力は完了しています。送信エリアへ',
    approximateDateHelper: '日付が未定の場合は「2月頃」「2026年春」「2月中旬〜下旬」などでも構いません。',
    approximateStartDatePlaceholder: '例：2026/2/10、2月頃、2026年春',
    approximateEndDatePlaceholder: '例：2026/2/17、2月下旬、未定',
  },
  en: {
    submitButtonLabel: 'Submit',
    submittingLabel: 'Submitting...',
    successTitle: 'Your response has been submitted',
    successDescription: 'Thank you for your response. We will review it and get back to you.',
    helperNote: 'This form is ready for public responses.',
    missingGuideTitle: 'Some required fields are still missing',
    missingGuideBody: 'We moved you to the first missing field. You can jump directly using the buttons below.',
    remainingLabel: 'Remaining',
    submitShortcutLabel: 'Required fields are complete. Go to submit',
    approximateDateHelper: 'If exact dates are not decided yet, approximate timing such as "around February", "spring 2026", or "mid to late February" is fine.',
    approximateStartDatePlaceholder: 'e.g. Feb 10, 2026 / around February / spring 2026',
    approximateEndDatePlaceholder: 'e.g. Feb 17, 2026 / late February / undecided',
  },
  nl: {
    submitButtonLabel: 'Verzenden',
    submittingLabel: 'Verzenden...',
    successTitle: 'Uw antwoord is verzonden',
    successDescription: 'Dank u voor uw antwoord. We bekijken de informatie en nemen contact met u op.',
    helperNote: 'U kunt dit openbare formulier direct invullen.',
    missingGuideTitle: 'Er ontbreken nog verplichte velden',
    missingGuideBody: 'We hebben u naar het eerste ontbrekende veld gebracht. U kunt ook rechtstreeks springen met de knoppen hieronder.',
    remainingLabel: 'Resterend',
    submitShortcutLabel: 'Verplichte velden zijn ingevuld. Ga naar verzenden',
    approximateDateHelper: 'Als de exacte datum nog niet vaststaat, mag u ook iets invullen zoals "rond februari", "voorjaar 2026" of "midden tot eind februari".',
    approximateStartDatePlaceholder: 'bijv. 10 februari 2026 / rond februari / voorjaar 2026',
    approximateEndDatePlaceholder: 'bijv. 17 februari 2026 / eind februari / nog niet bekend',
  },
  ko: {
    submitButtonLabel: '제출',
    submittingLabel: '제출 중...',
    successTitle: '제출이 완료되었습니다',
    successDescription: '응답해 주셔서 감사합니다. 내용을 확인한 뒤 연락드리겠습니다.',
    helperNote: '공개 폼으로 바로 응답할 수 있습니다.',
    missingGuideTitle: '아직 입력이 필요한 필수 항목이 있습니다',
    missingGuideBody: '가장 위의 미입력 항목으로 이동했습니다. 아래 버튼으로 바로 이동할 수 있습니다.',
    remainingLabel: '남은 항목',
    submitShortcutLabel: '필수 입력이 완료되었습니다. 제출 영역으로 이동',
    approximateDateHelper: '정확한 날짜가 아직 정해지지 않았다면 “2월경”, “2026년 봄”, “2월 중순~하순”처럼 적어 주셔도 됩니다.',
    approximateStartDatePlaceholder: '예: 2026/2/10, 2월경, 2026년 봄',
    approximateEndDatePlaceholder: '예: 2026/2/17, 2월 하순, 미정',
  },
  'zh-TW': {
    submitButtonLabel: '送出',
    submittingLabel: '送出中...',
    successTitle: '表單已送出',
    successDescription: '感謝您的填寫，我們會確認內容後再與您聯繫。',
    helperNote: '這份表單可直接作為公開回覆表單使用。',
    missingGuideTitle: '還有必填項目尚未完成',
    missingGuideBody: '已移動到最上方未填寫的項目，也可以用下方按鈕直接跳轉。',
    remainingLabel: '剩餘',
    submitShortcutLabel: '必填項目已完成，前往送出區塊',
    approximateDateHelper: '若確切日期尚未決定，也可以填寫「2月左右」、「2026年春季」、「2月中下旬」等大約時期。',
    approximateStartDatePlaceholder: '例：2026/2/10、2月左右、2026年春季',
    approximateEndDatePlaceholder: '例：2026/2/17、2月下旬、尚未決定',
  },
  'zh-CN': {
    submitButtonLabel: '提交',
    submittingLabel: '提交中...',
    successTitle: '表单已提交',
    successDescription: '感谢您的填写，我们会确认内容后与您联系。',
    helperNote: '这份表单可直接作为公开回复表单使用。',
    missingGuideTitle: '还有必填项目尚未完成',
    missingGuideBody: '已移动到最上方未填写的项目，也可以使用下方按钮直接跳转。',
    remainingLabel: '剩余',
    submitShortcutLabel: '必填项目已完成，前往提交区域',
    approximateDateHelper: '若确切日期尚未决定，也可以填写“2月左右”“2026年春季”“2月中下旬”等大致时间。',
    approximateStartDatePlaceholder: '例：2026/2/10、2月左右、2026年春季',
    approximateEndDatePlaceholder: '例：2026/2/17、2月下旬、尚未决定',
  },
}

const PAGE_BACKGROUND_IMAGE = '/travel-background.jpg'
const HERO_BACKGROUND_IMAGE = '/travel-header.jpg'

function normalizeLocale(value: string | null | undefined): string {
  const locale = value?.trim() || ''
  if (!locale) return 'ja'

  const lowered = locale.toLowerCase()
  if (lowered === 'ja' || lowered === 'ja-jp') return 'ja'
  if (lowered === 'en' || lowered === 'en-us' || lowered === 'en-gb') return 'en'
  if (lowered === 'nl' || lowered === 'nl-nl') return 'nl'
  if (lowered === 'ko' || lowered === 'ko-kr') return 'ko'
  if (lowered === 'zh-tw' || lowered === 'zh_tw') return 'zh-TW'
  if (lowered === 'zh-cn' || lowered === 'zh_cn' || lowered === 'zh-hans') return 'zh-CN'
  return locale
}

function getLocalizedTexts(locale: string | null | undefined) {
  return localizedTextDefaults[normalizeLocale(locale)] || localizedTextDefaults.ja
}

function normalizeRedirectUrl(value: string | null | undefined): string {
  if (!value?.trim()) return ''

  try {
    const url = new URL(value.trim())
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : ''
  } catch {
    return ''
  }
}

function collectInitialValues(fields: FormField[]): Record<string, unknown> {
  return Object.fromEntries(
    fields.map((field) => [
      field.name,
      field.defaultValue !== undefined
        ? field.defaultValue
        : field.type === 'checkbox' || field.type === 'file'
          ? []
          : '',
    ]),
  )
}

function collectInitialOtherValues(fields: FormField[]): Record<string, string> {
  return Object.fromEntries(
    fields
      .filter((field) => field.allowOtherOption)
      .map((field) => [field.name, '']),
  )
}

function helperText(field: FormField) {
  return field.helperText?.trim() || null
}

function isFlexibleTravelDateField(field: FormField) {
  if (field.type !== 'date') return false
  return field.name === 'travel_start_date' || field.name === 'travel_end_date'
}

function getMissingReason(
  field: FormField,
  value: unknown,
  otherValue: string | undefined,
): string | null {
  const otherText = otherValue?.trim() || ''

  if (field.required) {
    if (field.type === 'checkbox' || field.type === 'file') {
      if (!Array.isArray(value) || value.length === 0) {
        return `${field.label} を入力してください`
      }
    } else if (value === undefined || value === null || String(value).trim() === '') {
      return `${field.label} を入力してください`
    }
  }

  if (field.allowOtherOption) {
    if (field.type === 'checkbox') {
      if (Array.isArray(value) && value.includes(OTHER_SENTINEL) && !otherText) {
        return `${field.otherOptionLabel || 'その他'}の内容を入力してください`
      }
    } else if (value === OTHER_SENTINEL && !otherText) {
      return `${field.otherOptionLabel || 'その他'}の内容を入力してください`
    }
  }

  return null
}

function focusFirstControl(container: HTMLElement | null) {
  const control = container?.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
    'input, textarea, select',
  )
  control?.focus({ preventScroll: true })
}

function fieldControlClass(isMissing: boolean) {
  return `w-full rounded-xl border px-4 py-3 text-sm text-slate-900 outline-none transition ${
    isMissing
      ? 'border-rose-300 bg-rose-50/70 focus:border-rose-400'
      : 'border-[#d7e5dc] bg-white focus:border-[#1d5c47]'
  }`
}

function choiceControlClass(isMissing: boolean) {
  return `rounded-xl border px-4 py-3 text-sm text-slate-700 transition ${
    isMissing
      ? 'border-rose-200 bg-rose-50/60'
      : 'border-[#dfe9e2] bg-white'
  }`
}

function fileControlClass(isMissing: boolean) {
  return `block w-full cursor-pointer rounded-xl border px-4 py-3 text-sm text-slate-700 file:mr-4 file:rounded-lg file:border-0 file:bg-[#1d5c47] file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white ${
    isMissing ? 'border-rose-300 bg-rose-50/70' : 'border-[#d7e5dc] bg-white'
  }`
}

function isAgencyAccessibleTravelForm(form: HarnessForm): boolean {
  const fieldNames = new Set(form.fields.map((field) => field.name))
  return fieldNames.has('agency_company_name') && fieldNames.has('client_special_support_required')
}

const agencyHearingCopyTexts: Record<string, {
  button: string
  copied: string
  helper: string
  error: string
}> = {
  ja: {
    button: 'お客様へのヒアリングメールをコピー',
    copied: 'コピーしました',
    helper: '押すだけで、メールやLINEにそのまま貼れる確認文がコピーされます。',
    error: 'お客様へのヒアリングメールのコピーに失敗しました',
  },
  en: {
    button: 'Copy customer hearing email',
    copied: 'Copied',
    helper: 'One click copies a message that can be pasted directly into email or LINE.',
    error: 'Failed to copy the customer hearing email.',
  },
  'zh-TW': {
    button: '複製給客戶的詢問郵件',
    copied: '已複製',
    helper: '點擊後即可複製可直接貼到 Email 或 LINE 的確認文字。',
    error: '複製給客戶的詢問郵件失敗。',
  },
  'zh-CN': {
    button: '复制给客户的询问邮件',
    copied: '已复制',
    helper: '点击后即可复制可直接粘贴到邮件或 LINE 的确认文字。',
    error: '复制给客户的询问邮件失败。',
  },
  ko: {
    button: '고객용 확인 메일 복사',
    copied: '복사했습니다',
    helper: '한 번 누르면 이메일이나 LINE에 그대로 붙여 보낼 확인 문구가 복사됩니다.',
    error: '고객용 확인 메일 복사에 실패했습니다.',
  },
}

function buildCustomerHearingMessage(form: HarnessForm): string {
  const locale = normalizeLocale(form.locale)
  const formNameJa = form.name ? `\n対象フォーム：${form.name}` : ''
  const formNameEn = form.name ? `\nTarget form: ${form.name}` : ''
  const formNameZhTw = form.name ? `\n適用表單：${form.name}` : ''
  const formNameZhCn = form.name ? `\n适用表单：${form.name}` : ''
  const formNameKo = form.name ? `\n대상 양식: ${form.name}` : ''

  if (locale === 'en') {
    return `
Hello,
For a safe and comfortable trip, we have summarized the items needed for travel proposal and arrangement consultation.
Please reply directly to this message with the information you can provide.
If an item is undecided, please write “undecided”. If it does not apply, please write “none”.${formNameEn}

[Traveler Information]
- Total number of customers:
- Main traveler full name:
- Main traveler passport name (Roman letters):
- Main traveler nationality, or “Not confirmed”:
- Main traveler passport number:
- Preferred language:
- If there are companions, please provide each person’s full name, passport name, nationality, passport number, and relationship to the main traveler:

[Accessibility Check For Each Traveler]
- First, does anyone need special accommodations or support? (Yes / No):
- If there are two or more travelers, please answer Yes / No for each traveler:
- If anyone answered Yes, name of the traveler:
- Gender of the traveler who needs support:
- Height of the traveler who needs support (cm):
- Weight of the traveler who needs support (kg):
- Is a licensed travel care worker or nurse required? (Required / Not required):
- Will a wheelchair be used during sightseeing? (Manual wheelchair / Power wheelchair / Mobility scooter / Local rental / Will not use):
- If using a wheelchair, vehicle boarding preference:
- Wheelchair manufacturer:
- Wheelchair model / product number:
- Wheelchair length, maximum value (cm):
- Wheelchair width, maximum value (cm):
- Wheelchair depth, maximum value (cm):
- Wheelchair height, maximum value (cm):
- Wheelchair weight (kg):
- Can the wheelchair be folded?:
- For power wheelchairs or mobility scooters, battery type, capacity, and whether the battery can be removed:
- Welfare / accessibility equipment rental needs during the stay:
- Care / assistance needed:
- Details of accommodations, care needs, and required support:
- Need for medical management by a licensed professional, such as a nurse, and details if needed:

[Trip Overview]
- Travel start date or approximate timing:
- Travel end date or approximate timing:
- Planned destination / stay area:
- Traveler composition, age range, and relationship:
- Total budget range, excluding flights:
- Budget assumptions, such as per person, per room, or care assistance as a separate budget:

[Accommodation, Transport, and Sightseeing]
- Breakfast and dinner preferences:
- Room requests, such as accessible room, shower, beds, and same-floor rooms:
- Airport/station to hotel transfer needs:
- Sightseeing taxi or chartered vehicle needs:
- Sightseeing guide needs:
- Main transportation modes planned during the stay:
- Expected number of suitcases:

[Flights and Other Notes]
- Flight ticket status:
- Arrival place and time / return departure place and time:
- Things you would like to do or places you would like to visit:
- Any other information to share about the trip:

We will use the information you provide to proceed with a travel proposal aligned with accessibility requirements and your preferences.
Thank you.
`.trim()
  }

  if (locale === 'zh-TW') {
    return `
您好。
為了安排安全舒適的旅行，我們整理了旅行提案與手配諮詢所需的確認事項。
請在可回答的範圍內，直接回覆本訊息。
未定項目請填寫「未定」，不適用項目請填寫「無」。${formNameZhTw}

【旅客資訊】
- 客戶總人數：
- 主要旅客姓名：
- 主要旅客護照記載姓名（羅馬字）：
- 主要旅客國籍（未確認時請填「未確認」）：
- 主要旅客護照號碼：
- 希望使用語言：
- 若有同行者，請提供每位同行者的姓名、護照記載姓名、國籍、護照號碼、與主要旅客的關係：

【每位旅客的無障礙確認】
- 首先，是否有人需要特別配慮或支援？（是 / 否）：
- 若有2名以上旅客，請分別回答每位旅客是否需要特別配慮或支援（是 / 否）：
- 若有回答「是」的旅客，對象姓名：
- 需要支援者的性別：
- 需要支援者的身高（cm）：
- 需要支援者的體重（kg）：
- 是否需要具國家資格的旅行照護人員或護理師？（需要 / 不需要）：
- 觀光中是否使用輪椅？（手動輪椅 / 電動輪椅 / 代步車 / 當地租借 / 不使用）：
- 若使用輪椅，車輛搭乘需求：
- 輪椅廠牌：
- 輪椅型號：
- 輪椅縱向長度/全長（最大值 cm）：
- 輪椅寬度（最大值 cm）：
- 輪椅深度（最大值 cm）：
- 輪椅高度（最大值 cm）：
- 輪椅重量（kg）：
- 輪椅是否可折疊：
- 若為電動輪椅或代步車，請提供電池種類、容量、是否可拆卸：
- 停留期間是否需要租借福祉輔具：
- 需要的照護內容：
- 需要配慮或照護的事項、所需支援內容詳情：
- 是否需要護理師等醫療資格者介入的醫療管理；若需要，請提供具體內容：

【旅行概要】
- 旅行開始日期或大約時期：
- 旅行結束日期或大約時期：
- 預計停留地點：
- 同行者構成（年齡/關係）：
- 整體總預算感（不含機票）：
- 預算前提（每人、每房、照護費另計等）：

【住宿・移動・觀光】
- 早餐・晚餐需求：
- 房間需求（無障礙房、淋浴、床、同樓層等）：
- 機場/車站與飯店之間接送需求：
- 觀光計程車或包車需求：
- 觀光導遊需求：
- 停留期間主要預計使用的交通方式：
- 預計行李箱數量：

【機票・其他】
- 機票狀況：
- 抵達地點與時間 / 回程出發地點與時間：
- 想做的事、想去的地方：
- 其他希望分享的旅行相關事項：

我們將根據您提供的內容，進行符合無障礙需求與希望條件的旅行提案。
謝謝。
`.trim()
  }

  if (locale === 'zh-CN') {
    return `
您好。
为了安排安全舒适的旅行，我们整理了旅行提案与手配咨询所需的确认事项。
请在可回答的范围内，直接回复本消息。
未定项目请填写“未定”，不适用项目请填写“无”。${formNameZhCn}

【旅行者信息】
- 客户总人数：
- 主要旅行者姓名：
- 主要旅行者护照记载姓名（罗马字）：
- 主要旅行者国籍（未确认时请填“未确认”）：
- 主要旅行者护照号码：
- 希望使用语言：
- 若有同行者，请提供每位同行者的姓名、护照记载姓名、国籍、护照号码、与主要旅行者的关系：

【每位旅行者的无障碍确认】
- 首先，是否有人需要特别照顾或支持？（是 / 否）：
- 若有2名以上旅行者，请分别回答每位旅行者是否需要特别照顾或支持（是 / 否）：
- 若有回答“是”的旅行者，对象姓名：
- 需要支持者的性别：
- 需要支持者的身高（cm）：
- 需要支持者的体重（kg）：
- 是否需要具备国家资格的旅行照护人员或护士？（需要 / 不需要）：
- 观光中是否使用轮椅？（手动轮椅 / 电动轮椅 / 代步车 / 当地租赁 / 不使用）：
- 若使用轮椅，车辆乘坐需求：
- 轮椅品牌：
- 轮椅型号：
- 轮椅纵向长度/全长（最大值 cm）：
- 轮椅宽度（最大值 cm）：
- 轮椅深度（最大值 cm）：
- 轮椅高度（最大值 cm）：
- 轮椅重量（kg）：
- 轮椅是否可折叠：
- 若为电动轮椅或代步车，请提供电池类型、容量、是否可拆卸：
- 停留期间是否需要租赁福利/无障碍辅具：
- 需要的照护内容：
- 需要照顾或照护的事项、所需支持内容详情：
- 是否需要护士等医疗资格者介入的医学管理；若需要，请提供具体内容：

【旅行概要】
- 旅行开始日期或大致时间：
- 旅行结束日期或大致时间：
- 预计停留地点：
- 同行者构成（年龄/关系）：
- 整体总预算范围（不含机票）：
- 预算前提（按人、按房、照护费另计等）：

【住宿・移动・观光】
- 早餐・晚餐需求：
- 房间需求（无障碍房、淋浴、床、同楼层等）：
- 机场/车站与酒店之间接送需求：
- 观光出租车或包车需求：
- 观光导游需求：
- 停留期间主要预计使用的交通方式：
- 预计行李箱数量：

【机票・其他】
- 机票情况：
- 到达地点与时间 / 回程出发地点与时间：
- 想做的事、想去的地方：
- 其他希望分享的旅行相关事项：

我们将根据您提供的内容，进行符合无障碍需求与希望条件的旅行提案。
谢谢。
`.trim()
  }

  if (locale === 'ko') {
    return `
안녕하세요.
안전하고 편안한 여행을 위해 여행 제안 및 준비 상담에 필요한 확인 사항을 정리했습니다.
가능한 범위에서 이 메시지에 그대로 답변해 주세요.
미정인 항목은 “미정”, 해당하지 않는 항목은 “없음”이라고 적어 주세요.${formNameKo}

【여행자 정보】
- 고객 총 인원:
- 대표 여행자 성명:
- 대표 여행자의 여권상 영문 이름:
- 대표 여행자의 국적(미확인인 경우 “미확인”):
- 대표 여행자의 여권 번호:
- 희망 언어:
- 동행자가 있는 경우, 각 동행자의 성명, 여권상 이름, 국적, 여권 번호, 대표 여행자와의 관계:

【여행자별 배리어프리 확인】
- 먼저, 특별한 배려나 지원이 필요합니까? (예 / 아니요):
- 2명 이상인 경우 각 여행자별로 특별한 배려나 지원이 필요한지 예 / 아니요로 알려 주세요:
- “예”인 여행자가 있는 경우 대상자 이름:
- 지원이 필요한 분의 성별:
- 지원이 필요한 분의 키(cm):
- 지원이 필요한 분의 체중(kg):
- 국가 자격을 보유한 여행 전문 돌봄 인력이나 간호사가 필요합니까? (필요 / 불필요):
- 관광 중 휠체어를 사용합니까? (수동 휠체어 / 전동 휠체어 / 시니어카·모빌리티 스쿠터 / 현지 렌탈 / 사용하지 않음):
- 휠체어를 사용하는 경우 차량 탑승 희망:
- 휠체어 제조사:
- 휠체어 모델・형번:
- 휠체어 세로 길이/전체 길이(최대값 cm):
- 휠체어 폭(최대값 cm):
- 휠체어 깊이(최대값 cm):
- 휠체어 높이(최대값 cm):
- 휠체어 무게(kg):
- 휠체어 접이 가능 여부:
- 전동 휠체어 또는 시니어카의 경우 배터리 종류, 용량, 분리 가능 여부:
- 체류 중 복지용구 렌탈 희망:
- 필요한 돌봄 내용:
- 배려나 돌봄이 필요한 사항, 필요한 지원 내용 상세:
- 간호사 등 의료 자격자의 개입이 필요한 의료적 관리 여부와 필요한 경우 구체적인 내용:

【여행 개요】
- 여행 시작일 또는 시기:
- 여행 종료일 또는 시기:
- 체류 예정 장소:
- 동행자 구성(나이/관계):
- 총예산 범위(항공권 제외):
- 예산 전제(1인 기준, 객실 기준, 돌봄 비용 별도 등):

【숙박・이동・관광】
- 조식・석식 희망 사항:
- 객실 희망 사항(배리어프리 객실, 샤워, 침대, 같은 층 등):
- 공항/역과 호텔 간 송영 희망:
- 관광 택시 또는 전세 차량 희망:
- 관광 가이드 희망:
- 체류 중 주로 이용 예정인 교통수단:
- 예상되는 여행가방 개수:

【항공권・기타】
- 항공권 상황:
- 도착 장소 및 시간 / 귀국편 출발 장소 및 시간:
- 하고 싶은 일, 가고 싶은 곳:
- 기타 여행 관련 공유 사항:

공유해 주신 내용을 바탕으로 배리어프리 요건과 희망 사항에 맞춘 여행 제안을 진행하겠습니다.
감사합니다.
`.trim()
  }

  return `
お世話になっております。
安全で快適なご旅行のため、旅行提案・手配相談に必要な確認事項を以下にまとめております。
ご回答いただける範囲で、このメッセージにそのままご返信いただけますでしょうか。
未定の項目は「未定」、該当しない項目は「なし」とご記入ください。${formNameJa}

【旅行者情報】
- お客様の合計人数：
- メインのお客様氏名：
- メインのお客様のパスポート記載名（ローマ字）：
- メインのお客様の国籍（未確認の場合は「未確認」）：
- メインのお客様のパスポート番号：
- 希望言語：
- 同行者がいる場合、人数分の氏名・パスポート記載名・国籍・パスポート番号・メインのお客様との続柄：

【旅行者ごとのバリアフリー確認】
- まず特別な配慮やサポートは必要ですか？（はい / いいえ）：
- 2名以上いらっしゃる場合、それぞれの旅行者について特別な配慮やサポートが必要か「はい / いいえ」で教えてください：
- 「はい」の方がいる場合、対象者名：
- サポートが必要な方の性別（男性 / 女性 / その他）：
- サポートが必要な方の身長（cm）：
- サポートが必要な方の体重（kg）：
- 国家資格保有の旅行専門介護士や看護師のご用意は必要ですか？（必要 / 不要）：
- 観光中に車椅子を使用しますか？（手動車椅子を使用 / 電動車椅子を使用 / シニアカー/モビリティスクーターを使用 / 現地レンタル希望 / 使用しない）：
- 車椅子を使用する場合、車両利用時のご希望（車椅子のまま乗車 / 車椅子を折りたたんで乗車 / 車両利用・車椅子利用の予定なし）：
- 車椅子メーカー：
- 車椅子モデル・型番：
- 車椅子の縦幅・全長（最大値 cm）：
- 車椅子の横幅（最大値 cm）：
- 車椅子の奥行き（最大値 cm）：
- 車椅子の高さ（最大値 cm）：
- 車椅子の重さ（kg）：
- 車椅子は折りたたみ可能ですか？（はい / いいえ / 不明）：
- 電動車椅子/シニアカーの場合、バッテリー種別（リチウムイオン / 乾電池 / 湿式 / 不明 / 該当なし）：
- 電動車椅子/シニアカーの場合、バッテリー容量（Wh / Ah / V）：
- 電動車椅子/シニアカーの場合、バッテリーは取り外せますか？（はい / いいえ / 不明 / 該当なし）：
- 滞在中に福祉用具レンタルの希望はありますか？（手動車椅子 / 電動車椅子 / リフト / シャワーチェア・バスボード / 介護用ベッド / 特になし / その他）：
- 必要な介助内容（移動介助 / 食事介助 / 入浴介助 / 排泄介助 / 見守り・声かけ / 特になし / その他）：
- 配慮や介護が必要なこと、必要なサポート内容の詳細：
- 医学的管理（看護師など医療資格者の介在）の必要性（有 / 無 / その他）：
- 医学的管理が必要な場合、具体的な内容（吸引 / 酸素 / 服薬管理 / 褥瘡ケア / 導尿・カテーテル管理 / 経管栄養 / 特になし / その他）：

【旅行概要】
- 旅行開始日または時期：
- 旅行終了日または時期：
- 滞在予定場所：
- 同行者構成（年齢・関係性）：
- 合計予算感（航空券を除く旅行全体）：
- 合計予算の前提（人数あたり、部屋単位、介助費別枠など）：

【宿泊・移動・観光】
- 朝食・夕食の希望：
- 部屋の希望（バリアフリールーム、シャワー、ベッド、同フロアなど）：
- 空港/駅とホテル間の送迎希望：
- 観光タクシーやチャーター車両の希望：
- 観光ガイドの希望：
- 主に利用予定の交通手段：
- スーツケース予定個数：

【航空券・その他】
- 航空券の状況：
- 到着地・到着時刻 / 帰路の出発地・出発時刻：
- やりたいこと、行きたい場所：
- その他、旅行に関して共有したいこと：

ご共有いただいた内容をもとに、バリアフリー要件とご希望に沿った旅行提案を進めます。
どうぞよろしくお願いいたします。
`.trim()
}

async function copyTextToClipboard(text: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await Promise.race([
        navigator.clipboard.writeText(text),
        new Promise((_, reject) => {
          window.setTimeout(() => reject(new Error('clipboard timeout')), 800)
        }),
      ])
      return
    }
  } catch {
    // Fall back for embedded browsers that block the Clipboard API.
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.top = '0'
  textarea.style.left = '0'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()

  const copied = document.execCommand('copy')
  document.body.removeChild(textarea)

  if (!copied) {
    throw new Error('copy failed')
  }
}

export default function PublicFormPage() {
  const searchParams = useSearchParams()
  const formId = searchParams.get('id')
  const issueId = searchParams.get('issue')
  const slackChannelId = searchParams.get('slackChannelId')?.trim() || ''
  const sharedByFriendId = searchParams.get('sharedBy')?.trim() || ''
  const successRedirectUrl = normalizeRedirectUrl(
    searchParams.get('successRedirect')
    || searchParams.get('redirectUrl')
    || searchParams.get('redirect'),
  )

  const fieldRefs = useRef<Record<string, HTMLElement | null>>({})
  const submitAreaRef = useRef<HTMLDivElement | null>(null)

  const [form, setForm] = useState<HarnessForm | null>(null)
  const [issue, setIssue] = useState<PublicIssue | null>(null)
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [otherValues, setOtherValues] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState('')
  const [hasTriedSubmit, setHasTriedSubmit] = useState(false)
  const [hearingTemplateCopied, setHearingTemplateCopied] = useState(false)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      setError('')
      setHasTriedSubmit(false)

      try {
        if (issueId) {
          const res = await fetch(`${API_URL}/api/form-issues/${issueId}`)
          const json = await res.json() as ApiResponse<{
            issue: PublicIssue
            form: HarnessForm
          }>

          if (!res.ok || !json.success || !json.data) {
            throw new Error(json.error || 'フォームの読み込みに失敗しました')
          }

          if (!json.data.form.isActive) {
            throw new Error('このフォームは現在受付を停止しています')
          }

          setIssue(json.data.issue)
          setForm(json.data.form)
          setValues(collectInitialValues(json.data.form.fields))
          setOtherValues(collectInitialOtherValues(json.data.form.fields))
          return
        }

        if (!formId) {
          throw new Error('フォームIDが指定されていません')
        }

        const res = await fetch(`${API_URL}/api/forms/${formId}`)
        const json = await res.json() as ApiResponse<HarnessForm>

        if (!res.ok || !json.success || !json.data) {
          throw new Error(json.error || 'フォームの読み込みに失敗しました')
        }

        if (!json.data.isActive) {
          throw new Error('このフォームは現在受付を停止しています')
        }

        setIssue(null)
        setForm(json.data)
        setValues(collectInitialValues(json.data.fields))
        setOtherValues(collectInitialOtherValues(json.data.fields))
      } catch (err) {
        setError(err instanceof Error ? err.message : 'フォームの読み込みに失敗しました')
      } finally {
        setLoading(false)
      }
    }

    void load()
  }, [formId, issueId])

  const visibleFields = useMemo(
    () => form ? getVisibleFormFields(form.fields, values) : [],
    [form, values],
  )

  const missingFields = useMemo<MissingField[]>(() => {
    if (!form) return []

    return visibleFields
      .map((field) => {
        const reason = getMissingReason(field, values[field.name], otherValues[field.name])
        if (!reason) return null
        return {
          name: field.name,
          label: field.label,
          reason,
        }
      })
      .filter((field): field is MissingField => field !== null)
  }, [form, otherValues, values, visibleFields])

  const missingReasonByName = useMemo(
    () => new Map(missingFields.map((field) => [field.name, field.reason])),
    [missingFields],
  )

  const requiredFieldCount = useMemo(
    () => visibleFields.filter((field) => field.required).length,
    [visibleFields],
  )

  const showMissingGuide = hasTriedSubmit && missingFields.length > 0
  const showSubmitShortcut = !loading && !submitted && requiredFieldCount > 0 && missingFields.length === 0
  const localizedTexts = useMemo(
    () => getLocalizedTexts(form?.locale || issue?.locale),
    [form?.locale, issue?.locale],
  )
  const agencyHearingCopyText = agencyHearingCopyTexts[normalizeLocale(form?.locale || issue?.locale)] || agencyHearingCopyTexts.ja
  const showCustomerHearingCopy = Boolean(form && isAgencyAccessibleTravelForm(form))

  const scrollToField = (fieldName: string) => {
    const target = fieldRefs.current[fieldName]
    if (!target) return

    target.scrollIntoView({ behavior: 'smooth', block: 'center' })
    window.setTimeout(() => focusFirstControl(target), 260)
  }

  const scrollToSubmit = () => {
    submitAreaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  const copyCustomerHearingMessage = async () => {
    if (!form) return

    try {
      await copyTextToClipboard(buildCustomerHearingMessage(form))
      setHearingTemplateCopied(true)
      window.setTimeout(() => setHearingTemplateCopied(false), 2200)
    } catch {
      setError(agencyHearingCopyText.error)
    }
  }

  const setFieldValue = (field: FormField, nextValue: unknown) => {
    setValues((current) => ({
      ...current,
      [field.name]: nextValue,
    }))
  }

  const setOtherFieldValue = (field: FormField, nextValue: string) => {
    setOtherValues((current) => ({
      ...current,
      [field.name]: nextValue,
    }))
  }

  const uploadFile = async (file: File): Promise<UploadedFormFile> => {
    const formData = new FormData()
    formData.append('file', file)

    const res = await fetch(`${API_URL}/api/upload`, {
      method: 'POST',
      body: formData,
    })
    const json = await res.json() as ApiResponse<UploadedFormFile>

    if (!res.ok || !json.success || !json.data) {
      throw new Error(json.error || `${file.name} のアップロードに失敗しました`)
    }

    return json.data
  }

  const uploadFileFieldValue = async (field: FormField, value: unknown): Promise<UploadedFormFile[]> => {
    if (!Array.isArray(value)) return []

    const files = value.filter((item): item is File => item instanceof File)
    if (field.maxFiles && files.length > field.maxFiles) {
      throw new Error(`${field.label} は最大 ${field.maxFiles} ファイルまでです`)
    }

    return Promise.all(files.map(uploadFile))
  }

  const buildSubmissionData = async (): Promise<Record<string, unknown>> => {
    if (!form) return {}

    const data: Record<string, unknown> = {}

    for (const field of visibleFields) {
      const value = values[field.name]
      const otherValue = otherValues[field.name]?.trim()
      const otherLabel = field.otherOptionLabel || 'その他'

      if (field.type === 'file') {
        data[field.name] = await uploadFileFieldValue(field, value)
        continue
      }

      if (field.type === 'checkbox') {
        const selected = Array.isArray(value) ? value.filter((item) => item !== OTHER_SENTINEL) : []
        if (Array.isArray(value) && value.includes(OTHER_SENTINEL) && otherValue) {
          data[field.name] = [...selected, `${otherLabel}: ${otherValue}`]
        } else {
          data[field.name] = selected
        }
        continue
      }

      if (value === OTHER_SENTINEL) {
        data[field.name] = otherValue ? `${otherLabel}: ${otherValue}` : ''
        continue
      }

      data[field.name] = value
    }

    return data
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!form) return

    setHasTriedSubmit(true)

    if (missingFields.length > 0) {
      setError('')
      scrollToField(missingFields[0].name)
      return
    }

    setSubmitting(true)
    setError('')

    try {
      const res = await fetch(`${API_URL}/api/forms/${form.id}/submit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          issueId: issue?.id || undefined,
          sharedByFriendId: sharedByFriendId || undefined,
          slackChannelId: slackChannelId || undefined,
          data: await buildSubmissionData(),
        }),
      })

      const json = await res.json() as ApiResponse<unknown>
      if (!res.ok || !json.success) {
        throw new Error(json.error || '送信に失敗しました')
      }

      if (successRedirectUrl) {
        window.location.assign(successRedirectUrl)
        return
      }

      setSubmitted(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : '送信に失敗しました')
    } finally {
      setSubmitting(false)
    }
  }

  const renderOtherInput = (field: FormField, visible: boolean, isMissing: boolean) => {
    if (!field.allowOtherOption || !visible) return null

    return (
      <input
        type="text"
        value={otherValues[field.name] ?? ''}
        onChange={(event) => setOtherFieldValue(field, event.target.value)}
        placeholder={`${field.otherOptionLabel || 'その他'}の内容`}
        aria-invalid={isMissing}
        className={`mt-3 ${fieldControlClass(isMissing)}`}
      />
    )
  }

  const renderField = (field: FormField, isMissing: boolean) => {
    const value = values[field.name]
    const flexibleTravelDate = isFlexibleTravelDateField(field)
    const inputType = flexibleTravelDate ? 'text' : field.type
    const datePlaceholder = field.name === 'travel_end_date'
      ? localizedTexts.approximateEndDatePlaceholder
      : localizedTexts.approximateStartDatePlaceholder

    if (field.type === 'textarea') {
      return (
        <textarea
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => setFieldValue(field, e.target.value)}
          placeholder={field.placeholder}
          rows={4}
          aria-invalid={isMissing}
          className={fieldControlClass(isMissing)}
        />
      )
    }

    if (field.type === 'select') {
      return (
        <>
          <select
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => setFieldValue(field, e.target.value)}
            aria-invalid={isMissing}
            className={fieldControlClass(isMissing)}
          >
            <option value="">選択してください</option>
            {(field.options ?? []).map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
            {field.allowOtherOption && (
              <option value={OTHER_SENTINEL}>{field.otherOptionLabel || 'その他'}</option>
            )}
          </select>
          {renderOtherInput(field, value === OTHER_SENTINEL, isMissing)}
        </>
      )
    }

    if (field.type === 'radio') {
      return (
        <div className="space-y-2">
          {(field.options ?? []).map((option) => (
            <label key={option} className={`flex items-center gap-3 ${choiceControlClass(isMissing)}`}>
              <input
                type="radio"
                name={field.name}
                checked={value === option}
                onChange={() => setFieldValue(field, option)}
                aria-invalid={isMissing}
                className="h-4 w-4 border-[#b7cebf] text-[#1d5c47] focus:ring-[#1d5c47]"
              />
              {option}
            </label>
          ))}
          {field.allowOtherOption && (
            <label className={`block ${choiceControlClass(isMissing)}`}>
              <div className="flex items-center gap-3">
                <input
                  type="radio"
                  name={field.name}
                  checked={value === OTHER_SENTINEL}
                  onChange={() => setFieldValue(field, OTHER_SENTINEL)}
                  aria-invalid={isMissing}
                  className="h-4 w-4 border-[#b7cebf] text-[#1d5c47] focus:ring-[#1d5c47]"
                />
                {field.otherOptionLabel || 'その他'}
              </div>
              {renderOtherInput(field, value === OTHER_SENTINEL, isMissing)}
            </label>
          )}
        </div>
      )
    }

    if (field.type === 'checkbox') {
      const selected = Array.isArray(value) ? value : []
      return (
        <div className="space-y-2">
          {(field.options ?? []).map((option) => {
            const checked = selected.includes(option)
            return (
              <label key={option} className={`flex items-center gap-3 ${choiceControlClass(isMissing)}`}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => {
                    const next = checked
                      ? selected.filter((item) => item !== option)
                      : [...selected, option]
                    setFieldValue(field, next)
                  }}
                  aria-invalid={isMissing}
                  className="h-4 w-4 rounded border-[#b7cebf] text-[#1d5c47] focus:ring-[#1d5c47]"
                />
                {option}
              </label>
            )
          })}
          {field.allowOtherOption && (
            <label className={`block ${choiceControlClass(isMissing)}`}>
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={selected.includes(OTHER_SENTINEL)}
                  onChange={() => {
                    const checked = selected.includes(OTHER_SENTINEL)
                    const next = checked
                      ? selected.filter((item) => item !== OTHER_SENTINEL)
                      : [...selected, OTHER_SENTINEL]
                    setFieldValue(field, next)
                  }}
                  aria-invalid={isMissing}
                  className="h-4 w-4 rounded border-[#b7cebf] text-[#1d5c47] focus:ring-[#1d5c47]"
                />
                {field.otherOptionLabel || 'その他'}
              </div>
              {renderOtherInput(field, selected.includes(OTHER_SENTINEL), isMissing)}
            </label>
          )}
        </div>
      )
    }

    if (field.type === 'file') {
      const selectedFiles = Array.isArray(value)
        ? value.filter((item): item is File => item instanceof File)
        : []

      return (
        <div className="space-y-3">
          <input
            type="file"
            accept={field.accept}
            multiple={field.multiple !== false}
            onChange={(e) => setFieldValue(field, Array.from(e.currentTarget.files ?? []))}
            aria-invalid={isMissing}
            className={fileControlClass(isMissing)}
          />
          {selectedFiles.length > 0 && (
            <ul className="space-y-1 text-sm text-slate-600">
              {selectedFiles.map((file) => (
                <li key={`${file.name}-${file.size}`} className="flex items-center justify-between gap-3 rounded-lg bg-[#f5faf7] px-3 py-2">
                  <span className="truncate">{file.name}</span>
                  <span className="shrink-0 text-xs text-slate-500">{Math.ceil(file.size / 1024)}KB</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )
    }

    return (
      <input
        type={inputType}
        value={typeof value === 'string' || typeof value === 'number' ? String(value) : ''}
        onChange={(e) => setFieldValue(field, e.target.value)}
        placeholder={field.placeholder || (flexibleTravelDate ? datePlaceholder : undefined)}
        aria-invalid={isMissing}
        className={fieldControlClass(isMissing)}
      />
    )
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#edf5ef] px-4 py-8 sm:px-6">
      <div className="pointer-events-none absolute inset-0">
        <div
          className="absolute inset-0 bg-cover bg-center opacity-[0.16]"
          style={{ backgroundImage: `url(${PAGE_BACKGROUND_IMAGE})` }}
        />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.78),rgba(237,245,239,0.94)_42%,rgba(237,245,239,0.98)_100%)]" />
        <div className="absolute inset-x-0 bottom-0 h-64 bg-[linear-gradient(180deg,rgba(237,245,239,0),rgba(237,245,239,0.96))]" />
      </div>

      <div className="relative mx-auto max-w-3xl">
        {loading ? (
          <div className="rounded-[24px] border border-[#d7e5dc] bg-white/[0.92] p-10 text-center text-sm text-slate-500 shadow-sm backdrop-blur-sm">
            フォームを読み込んでいます...
          </div>
        ) : error && !form ? (
          <div className="rounded-[24px] border border-red-200 bg-white/[0.92] p-10 text-center text-sm text-red-700 shadow-sm backdrop-blur-sm">
            {error}
          </div>
        ) : submitted ? (
          <div className="overflow-hidden rounded-[28px] border border-[#d7e5dc] bg-white/[0.92] shadow-sm backdrop-blur-sm">
            <div className="h-4 bg-[#1d5c47]" />
            <div className="px-8 py-10 text-center">
              <h1 className="text-2xl font-semibold text-slate-900">{form?.successTitle || localizedTexts.successTitle}</h1>
              <p className="mt-3 text-sm leading-6 text-slate-600">
                {form?.successDescription || localizedTexts.successDescription}
              </p>
            </div>
          </div>
        ) : form ? (
          <>
            <form onSubmit={handleSubmit} className="space-y-4">
              <section className="relative overflow-hidden rounded-[32px] border border-[#d7e5dc] shadow-[0_20px_60px_rgba(29,92,71,0.18)]">
                <div className="absolute inset-0 overflow-hidden">
                  <div
                    className="absolute inset-0 bg-cover bg-center"
                    style={{ backgroundImage: `url(${HERO_BACKGROUND_IMAGE})` }}
                  />
                  <div className="absolute inset-0 bg-[linear-gradient(120deg,rgba(10,40,31,0.88)_0%,rgba(24,87,67,0.76)_42%,rgba(52,127,98,0.32)_100%)]" />
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.28),transparent_32%),linear-gradient(180deg,rgba(17,60,46,0.08),rgba(17,60,46,0.38))]" />
                  <div className="absolute inset-x-0 bottom-0 h-28 bg-[linear-gradient(180deg,rgba(14,48,37,0),rgba(14,48,37,0.72))]" />
                </div>
                <div className="relative px-8 py-10 text-white sm:px-10 sm:py-12">
                  <h1 className="max-w-2xl text-[30px] font-normal tracking-tight text-white sm:text-[40px]">
                    {form.name}
                  </h1>
                  {form.description && (
                    <p className="mt-5 max-w-2xl text-sm leading-7 text-white/88 sm:text-[15px]">
                      {form.description}
                    </p>
                  )}
                  {showCustomerHearingCopy && (
                    <div className="mt-6 flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        onClick={() => void copyCustomerHearingMessage()}
                        className="rounded-full bg-white px-5 py-3 text-sm font-semibold text-[#174635] shadow-[0_12px_28px_rgba(0,0,0,0.18)] transition hover:bg-[#f4fbf7] focus:outline-none focus:ring-2 focus:ring-white/70"
                      >
                        {hearingTemplateCopied ? agencyHearingCopyText.copied : agencyHearingCopyText.button}
                      </button>
                      <span className="text-xs leading-5 text-white/78">
                        {agencyHearingCopyText.helper}
                      </span>
                    </div>
                  )}
                  {issue?.name && (
                    <p className="mt-6 text-sm font-medium tracking-[0.12em] text-white/72">
                      {issue.name}
                    </p>
                  )}
                </div>
              </section>

              {showMissingGuide && (
                <section className="rounded-[24px] border border-[#d7e5dc] bg-white/[0.92] px-6 py-5 shadow-sm backdrop-blur-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="text-sm font-semibold text-slate-900">{localizedTexts.missingGuideTitle}</h2>
                      <p className="mt-1 text-sm text-slate-600">
                        {localizedTexts.missingGuideBody}
                      </p>
                    </div>
                    <span className="rounded-full bg-[#e8f3ed] px-3 py-1 text-xs font-medium text-[#1d5c47]">
                      {localizedTexts.remainingLabel} {missingFields.length}
                    </span>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {missingFields.map((field, index) => (
                      <button
                        key={field.name}
                        type="button"
                        onClick={() => scrollToField(field.name)}
                        className="rounded-full border border-[#cfe1d5] bg-[#f5faf7] px-3 py-1.5 text-xs font-medium text-[#1d5c47] transition-colors hover:bg-[#ebf5ef]"
                      >
                        {index + 1}. {field.label}
                      </button>
                    ))}
                  </div>
                </section>
              )}

              {error && (
                <div className="rounded-2xl border border-red-200 bg-white/[0.92] px-4 py-3 text-sm text-red-700 backdrop-blur-sm">
                  {error}
                </div>
              )}

              {visibleFields.map((field) => {
                const missingReason = showMissingGuide ? missingReasonByName.get(field.name) : null
                const fieldHelper = helperText(field) || (isFlexibleTravelDateField(field)
                  ? localizedTexts.approximateDateHelper
                  : null)

                return (
                  <section
                    key={field.name}
                    id={`field-${field.name}`}
                    ref={(node) => {
                      fieldRefs.current[field.name] = node
                    }}
                    className={`scroll-mt-24 overflow-hidden rounded-[24px] border shadow-sm transition-colors ${
                      missingReason
                        ? 'border-rose-200 bg-white/[0.92]'
                        : 'border-[#d7e5dc] bg-white/[0.92]'
                    }`}
                  >
                    <div className="px-8 py-7 backdrop-blur-sm">
                      <div className="flex items-start gap-2">
                        <h2 className="text-base font-medium leading-7 text-slate-900">{field.label}</h2>
                        {field.required && <span className="text-[#d93025]">*</span>}
                      </div>
                      {fieldHelper && (
                        <p className="mt-1 text-sm leading-6 text-slate-500">{fieldHelper}</p>
                      )}
                      <div className="mt-4">
                        {renderField(field, Boolean(missingReason))}
                      </div>
                      {missingReason && (
                        <p className="mt-3 text-sm font-medium text-rose-700">
                          {missingReason}
                        </p>
                      )}
                    </div>
                  </section>
                )
              })}

              <div ref={submitAreaRef} className="flex flex-wrap items-center gap-3 pb-10">
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-lg bg-[#1d5c47] px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#174a39] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submitting ? localizedTexts.submittingLabel : (form.submitButtonLabel || localizedTexts.submitButtonLabel)}
                </button>
                <p className="text-xs text-slate-500">{localizedTexts.helperNote}</p>
              </div>
            </form>

            {showSubmitShortcut && (
              <div className="pointer-events-none fixed inset-x-0 bottom-4 z-20 flex justify-center px-4">
                <button
                  type="button"
                  onClick={scrollToSubmit}
                  className="pointer-events-auto rounded-full border border-[#cfe1d5] bg-white/95 px-4 py-2 text-sm font-medium text-[#1d5c47] shadow-sm backdrop-blur transition-colors hover:bg-[#f5faf7]"
                >
                  {localizedTexts.submitShortcutLabel}
                </button>
              </div>
            )}
          </>
        ) : null}
      </div>
    </main>
  )
}
