'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Form as HarnessForm, Scenario, Tag } from '@line-crm/shared'
import PageHeader from '@/components/page-header'
import { api } from '@/lib/api'

type FormSubmissionRecord = {
  id: string
  formId: string
  formIssueId: string | null
  friendId: string | null
  slackChannelId: string | null
  data: Record<string, unknown>
  createdAt: string
}

function fieldTypeLabel(type: HarnessForm['fields'][number]['type']): string {
  switch (type) {
    case 'text':
      return 'テキスト'
    case 'email':
      return 'メール'
    case 'tel':
      return '電話番号'
    case 'number':
      return '数値'
    case 'textarea':
      return '長文'
    case 'select':
      return 'プルダウン'
    case 'radio':
      return '単一選択'
    case 'checkbox':
      return '複数選択'
    case 'date':
      return '日付'
    case 'time':
      return '時刻'
    default:
      return type
  }
}

function formatSubmissionValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value
      .map((item) => formatSubmissionValue(item))
      .filter(Boolean)
      .join(' / ')
  }

  if (value === undefined || value === null) return ''
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value).trim()
}

function hasSubmissionValue(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0
  if (value === undefined || value === null) return false
  return String(value).trim().length > 0
}

function formatDateTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('ja-JP', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function isAgencyAccessibleTravelForm(form: HarnessForm | null): boolean {
  if (!form) return false
  const fieldNames = new Set(form.fields.map((field) => field.name))
  return fieldNames.has('agency_company_name') && fieldNames.has('client_special_support_required')
}

function hasFormField(form: HarnessForm | null, fieldName: string): boolean {
  return Boolean(form?.fields.some((field) => field.name === fieldName))
}

function isDomesticTravelHearingForm(form: HarnessForm | null): boolean {
  if (!form) return false
  const hasDomesticTripFields = hasFormField(form, 'trip.purpose')
    && hasFormField(form, 'trip.transportModes')
    && hasFormField(form, 'support.required')
  const hasPassportFields = form.fields.some((field) => /passport|パスポート|旅券/i.test(`${field.name} ${field.label}`))
  return hasDomesticTripFields && !hasPassportFields
}

function normalizeLocale(value: string | null | undefined): string {
  const lowered = value?.trim().toLowerCase() || ''
  if (lowered === 'en' || lowered === 'en-us' || lowered === 'en-gb') return 'en'
  if (lowered === 'zh-tw' || lowered === 'zh_tw') return 'zh-TW'
  if (lowered === 'zh-cn' || lowered === 'zh_cn' || lowered === 'zh-hans') return 'zh-CN'
  if (lowered === 'ko' || lowered === 'ko-kr') return 'ko'
  return 'ja'
}

function buildDomesticTravelCustomerQuestionTemplate(form: HarnessForm | null): string {
  const formNameJa = form?.name ? `（${form.name}用）` : ''

  return `
国内旅行に関する確認事項${formNameJa}

お世話になっております。
国内旅行の手配相談に必要な確認事項を以下にまとめております。
ご回答いただける範囲で、このメッセージにそのままご返信いただけますでしょうか。
未定の項目は「未定」、該当しない項目は「なし」とご記入ください。

【お客様情報】
- お名前：
- フリガナ：
- 生年月日：
- 当日連絡がつく電話番号：
- メールアドレス：
- 緊急連絡先（氏名・続柄・電話番号）：

【国内旅行の概要】
- 旅行目的：
- 旅行開始日または時期：
- 旅行終了日または時期：
- 行き先・宿泊予定エリア：
- 出発地：
- 合計人数：
- 参加者構成（年齢・関係性）：
- ご予算感：
- 優先したいこと：

【宿泊・移動】
- 宿泊希望エリア・施設名：
- 宿泊数・部屋数：
- 部屋タイプの希望：
- 宿泊施設に必要な条件：
- 利用予定の国内移動手段：
- 送迎・移動サポートの希望：
- 国内線を利用する場合の航空会社・便・サポート希望：

【車椅子・介助・医療的配慮】
- 特別な配慮やサポートの必要有無：
- 障害区分・要介護度・配慮が必要な内容：
- 車椅子利用の有無と種類：
- 車椅子サイズ・重量・折りたたみ可否：
- 車両利用時の希望：
- 移乗・歩行・階段・トイレ介助に関する状況：
- レンタルしたい福祉用具：
- 既往症・服薬・医療機器・アレルギー：
- 看護師など医療資格者の同行・確認の必要有無：

【食事・同伴者・その他】
- 食事形態・アレルギー・避けたいもの：
- 同伴者情報（氏名・続柄・介助者かどうか）：
- 補助犬の同伴有無：
- その他、不安点や事前に共有したいこと：

ご共有いただいた内容をもとに、国内旅行の移動・宿泊・介助条件を確認しながら提案を進めます。
どうぞよろしくお願いいたします。
`.trim()
}

function buildCustomerQuestionTemplate(form: HarnessForm | null): string {
  const locale = normalizeLocale(form?.locale)
  const formNameJa = form?.name ? `（${form.name}用）` : ''
  const formNameEn = form?.name ? ` for ${form.name}` : ''
  const formNameZhTw = form?.name ? `（${form.name}用）` : ''
  const formNameZhCn = form?.name ? `（${form.name}用）` : ''
  const formNameKo = form?.name ? ` (${form.name}용)` : ''

  if (locale === 'ja' && isDomesticTravelHearingForm(form)) {
    return buildDomesticTravelCustomerQuestionTemplate(form)
  }

  if (locale === 'en') {
    return `
Travel confirmation items${formNameEn}

Hello,
For a safe and comfortable trip, we have summarized the items needed for travel proposal and arrangement consultation.
Please reply directly to this message with the information you can provide.
If an item is undecided, please write “undecided”. If it does not apply, please write “none”.

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
- Gender, height, and weight of the traveler who needs support:
- Is a licensed travel care worker or nurse required?
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
- Welfare / accessibility equipment rental needs:
- Care / assistance needed:
- Details of accommodations, care needs, and medical management if any:

[Trip Overview]
- Travel start date or approximate timing:
- Travel end date or approximate timing:
- Planned destination / stay area:
- Traveler composition, age range, and relationship:
- Total budget range, excluding flights:
- Budget assumptions:

[Accommodation, Transport, and Sightseeing]
- Breakfast and dinner preferences:
- Room requests:
- Airport/station to hotel transfer needs:
- Sightseeing taxi or chartered vehicle needs:
- Sightseeing guide needs:
- Main transportation modes:
- Expected number of suitcases:

[Flights and Other Notes]
- Flight ticket status:
- Arrival place and time / return departure place and time:
- Things you would like to do or places you would like to visit:
- Any other information to share about the trip:

Agency-only items such as company name, contact person, and agency contact details do not need to be confirmed with the customer.
We will use the information you provide to proceed with a travel proposal aligned with accessibility requirements and your preferences.
Thank you.
`.trim()
  }

  if (locale === 'zh-TW') {
    return `
旅行確認事項${formNameZhTw}

您好。
為了安排安全舒適的旅行，我們整理了旅行提案與手配諮詢所需的確認事項。
請在可回答的範圍內，直接回覆本訊息。未定項目請填寫「未定」，不適用項目請填寫「無」。

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
- 若有回答「是」的旅客，請提供姓名、性別、身高、體重：
- 是否需要具國家資格的旅行照護人員或護理師：
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
- 若為電動輪椅或代步車，電池種類、容量、是否可拆卸：
- 福祉輔具租借需求：
- 需要的照護內容：
- 需要配慮或照護的事項、醫療管理需求：

【旅行概要】
- 旅行開始日期或大約時期：
- 旅行結束日期或大約時期：
- 預計停留地點：
- 同行者構成（年齡/關係）：
- 整體總預算感（不含機票）：
- 預算前提：

【住宿・移動・觀光】
- 早餐・晚餐需求：
- 房間需求：
- 機場/車站與飯店之間接送需求：
- 觀光計程車或包車需求：
- 觀光導遊需求：
- 主要交通方式：
- 預計行李箱數量：

【機票・其他】
- 機票狀況：
- 抵達地點與時間 / 回程出發地點與時間：
- 想做的事、想去的地方：
- 其他希望分享的旅行相關事項：

代理店側填寫的公司名稱、負責人姓名與聯絡方式，不需要向客戶確認。
我們將根據您提供的內容，進行符合無障礙需求與希望條件的旅行提案。
謝謝。
`.trim()
  }

  if (locale === 'zh-CN') {
    return `
旅行确认事项${formNameZhCn}

您好。
为了安排安全舒适的旅行，我们整理了旅行提案与手配咨询所需的确认事项。
请在可回答的范围内，直接回复本消息。未定项目请填写“未定”，不适用项目请填写“无”。

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
- 若有回答“是”的旅行者，请提供姓名、性别、身高、体重：
- 是否需要具备国家资格的旅行照护人员或护士：
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
- 若为电动轮椅或代步车，电池类型、容量、是否可拆卸：
- 福利/无障碍辅具租赁需求：
- 需要的照护内容：
- 需要照顾或照护的事项、医学管理需求：

【旅行概要】
- 旅行开始日期或大致时间：
- 旅行结束日期或大致时间：
- 预计停留地点：
- 同行者构成（年龄/关系）：
- 整体总预算范围（不含机票）：
- 预算前提：

【住宿・移动・观光】
- 早餐・晚餐需求：
- 房间需求：
- 机场/车站与酒店之间接送需求：
- 观光出租车或包车需求：
- 观光导游需求：
- 主要交通方式：
- 预计行李箱数量：

【机票・其他】
- 机票情况：
- 到达地点与时间 / 回程出发地点与时间：
- 想做的事、想去的地方：
- 其他希望分享的旅行相关事项：

代理店侧填写的公司名称、负责人姓名与联系方式，不需要向客户确认。
我们将根据您提供的内容，进行符合无障碍需求与希望条件的旅行提案。
谢谢。
`.trim()
  }

  if (locale === 'ko') {
    return `
여행 확인 사항${formNameKo}

안녕하세요.
안전하고 편안한 여행을 위해 여행 제안 및 준비 상담에 필요한 확인 사항을 정리했습니다.
가능한 범위에서 이 메시지에 그대로 답변해 주세요. 미정인 항목은 “미정”, 해당하지 않는 항목은 “없음”이라고 적어 주세요.

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
- “예”인 여행자가 있는 경우 이름, 성별, 키, 체중:
- 국가 자격을 보유한 여행 전문 돌봄 인력이나 간호사 필요 여부:
- 관광 중 휠체어를 사용합니까? (수동 휠체어 / 전동 휠체어 / 시니어카・모빌리티 스쿠터 / 현지 렌탈 / 사용하지 않음):
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
- 복지용구 렌탈 희망:
- 필요한 돌봄 내용:
- 배려나 돌봄이 필요한 사항, 의료적 관리 필요 여부:

【여행 개요】
- 여행 시작일 또는 시기:
- 여행 종료일 또는 시기:
- 체류 예정 장소:
- 동행자 구성(나이/관계):
- 총예산 범위(항공권 제외):
- 예산 전제:

【숙박・이동・관광】
- 조식・석식 희망 사항:
- 객실 희망 사항:
- 공항/역과 호텔 간 송영 희망:
- 관광 택시 또는 전세 차량 희망:
- 관광 가이드 희망:
- 주요 교통수단:
- 예상되는 여행가방 개수:

【항공권・기타】
- 항공권 상황:
- 도착 장소 및 시간 / 귀국편 출발 장소 및 시간:
- 하고 싶은 일, 가고 싶은 곳:
- 기타 여행 관련 공유 사항:

여행사 측에서 입력하는 회사명, 담당자명, 연락처는 고객에게 확인하지 않아도 됩니다.
공유해 주신 내용을 바탕으로 배리어프리 요건과 희망 사항에 맞춘 여행 제안을 진행하겠습니다.
감사합니다.
`.trim()
  }

  return `
ご旅行に関する確認事項${formNameJa}

お世話になっております。
安全で快適なご旅行のため、旅行提案・手配相談に必要な確認事項を以下にまとめております。
ご回答いただける範囲で、このメッセージにそのままご返信いただけますでしょうか。
未定の項目は「未定」、該当しない項目は「なし」とご記入ください。

【お客様情報】
- お客様の合計人数：
- メインのお客様氏名：
- メインのお客様のパスポート記載名（ローマ字）：
- メインのお客様の国籍（未確認の場合は「未確認」）：
- メインのお客様のパスポート番号：
- 希望言語：
- 同行者がいる場合、人数分の氏名・パスポート記載名・国籍・パスポート番号・メインのお客様との続柄：

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

【車椅子・介助・医療的配慮】
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

【航空券・その他】
- 航空券の状況：
- 到着地・到着時刻 / 帰路の出発地・出発時刻：
- やりたいこと、行きたい場所：
- その他、旅行に関して共有したいこと：

代理店側で入力する項目（御社名・担当者名・御社連絡先）は、お客様への確認不要です。
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

function buildSubmissionEntries(form: HarnessForm, submission: FormSubmissionRecord) {
  const knownFieldNames = new Set(form.fields.map((field) => field.name))

  const orderedEntries = form.fields
    .filter((field) => hasSubmissionValue(submission.data[field.name]))
    .map((field) => ({
      key: field.name,
      label: field.label,
      value: formatSubmissionValue(submission.data[field.name]),
      type: field.type,
    }))

  const extraEntries = Object.entries(submission.data)
    .filter(([key, value]) => !knownFieldNames.has(key) && hasSubmissionValue(value))
    .map(([key, value]) => ({
      key,
      label: key,
      value: formatSubmissionValue(value),
      type: 'text',
    }))

  return [...orderedEntries, ...extraEntries]
}

function findSubmissionDisplay(form: HarnessForm, submission: FormSubmissionRecord) {
  const candidateFields = [
    (field: HarnessForm['fields'][number]) => /client.*name|customer.*name/i.test(field.name),
    (field: HarnessForm['fields'][number]) => /お客様.*(氏名|名前)|client.*name|customer.*name/i.test(field.label),
    (field: HarnessForm['fields'][number]) => /representative|name/i.test(field.name),
    (field: HarnessForm['fields'][number]) => /氏名|名前|姓名|성함|이름|name/i.test(field.label),
    (field: HarnessForm['fields'][number]) => /email|mail/i.test(field.name),
    (field: HarnessForm['fields'][number]) => /メール|郵件|이메일|email/i.test(field.label),
  ]

  for (const matcher of candidateFields) {
    const matchedField = form.fields.find((field) => matcher(field) && hasSubmissionValue(submission.data[field.name]))
    if (matchedField) {
      return {
        title: formatSubmissionValue(submission.data[matchedField.name]),
        subtitle: matchedField.label,
      }
    }
  }

  const firstAnsweredField = form.fields.find((field) => hasSubmissionValue(submission.data[field.name]))
  if (firstAnsweredField) {
    return {
      title: formatSubmissionValue(submission.data[firstAnsweredField.name]),
      subtitle: firstAnsweredField.label,
    }
  }

  return {
    title: '回答内容',
    subtitle: '値なし',
  }
}

export default function FormsDashboardPage() {
  const submissionsPerPage = 10
  const [forms, setForms] = useState<HarnessForm[]>([])
  const [selectedFormId, setSelectedFormId] = useState<string | null>(null)
  const [tags, setTags] = useState<Tag[]>([])
  const [scenarios, setScenarios] = useState<Scenario[]>([])
  const [publicOrigin, setPublicOrigin] = useState('')
  const [shareRouteFriendId, setShareRouteFriendId] = useState('')
  const [shareSlackChannelId, setShareSlackChannelId] = useState('')
  const [submissions, setSubmissions] = useState<FormSubmissionRecord[]>([])
  const [selectedSubmissionId, setSelectedSubmissionId] = useState<string | null>(null)
  const [showSubmissionDetails, setShowSubmissionDetails] = useState(false)
  const [showSubmissionModal, setShowSubmissionModal] = useState(false)
  const [submissionPage, setSubmissionPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [submissionsLoading, setSubmissionsLoading] = useState(false)
  const [submissionSlackDraft, setSubmissionSlackDraft] = useState('')
  const [submissionSaving, setSubmissionSaving] = useState(false)
  const [deletingFormId, setDeletingFormId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [templateCopied, setTemplateCopied] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    setPublicOrigin(window.location.origin)
  }, [])

  useEffect(() => {
    if (typeof document === 'undefined') return

    if (showSubmissionModal) {
      const previousOverflow = document.body.style.overflow
      document.body.style.overflow = 'hidden'

      return () => {
        document.body.style.overflow = previousOverflow
      }
    }
  }, [showSubmissionModal])

  useEffect(() => {
    if (!showSubmissionModal || typeof window === 'undefined') return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowSubmissionModal(false)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [showSubmissionModal])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')

    try {
      const formsRes = await api.forms.list()

      if (formsRes.success) {
        setForms(formsRes.data)
        setSelectedFormId((current) => {
          if (current && formsRes.data.some((form) => form.id === current)) return current
          return formsRes.data[0]?.id ?? null
        })
      } else {
        throw new Error(formsRes.error)
      }

      const [tagsResult, scenariosResult] = await Promise.allSettled([
        api.tags.list(),
        api.scenarios.list(),
      ])
      let optionLoadFailed = false

      if (tagsResult.status === 'fulfilled' && tagsResult.value.success) {
        setTags(tagsResult.value.data)
      } else {
        optionLoadFailed = true
      }

      if (scenariosResult.status === 'fulfilled' && scenariosResult.value.success) {
        setScenarios(scenariosResult.value.data)
      } else {
        optionLoadFailed = true
      }

      if (optionLoadFailed) {
        setError('タグまたはシナリオの読み込みに失敗しました')
      }
    } catch {
      setError('フォーム情報の読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const loadSubmissions = useCallback(async (
    formId: string,
    options: { showLoading?: boolean; clearOnError?: boolean } = {},
  ) => {
    const showLoading = options.showLoading ?? true
    const clearOnError = options.clearOnError ?? true

    if (showLoading) setSubmissionsLoading(true)

    try {
      const res = await api.forms.submissions(formId)
      if (!res.success) {
        throw new Error('回答一覧の読み込みに失敗しました')
      }

      setSubmissions(res.data)
      setSelectedSubmissionId((current) => {
        if (current && res.data.some((submission) => submission.id === current)) {
          return current
        }
        return res.data[0]?.id ?? null
      })
      setForms((current) => current.map((form) => (
        form.id === formId ? { ...form, submitCount: res.data.length } : form
      )))
    } catch {
      if (showLoading || clearOnError) {
        setError('回答一覧の読み込みに失敗しました')
      }
      if (clearOnError) {
        setSubmissions([])
        setSelectedSubmissionId(null)
      }
    } finally {
      if (showLoading) setSubmissionsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!selectedFormId) {
      setSubmissions([])
      setSelectedSubmissionId(null)
      setShowSubmissionDetails(false)
      setShowSubmissionModal(false)
      setSubmissionPage(1)
      return
    }

    setSubmissionsLoading(true)
    setShowSubmissionDetails(false)
    setShowSubmissionModal(false)
    setSubmissionPage(1)

    void loadSubmissions(selectedFormId, { showLoading: true, clearOnError: true })
  }, [loadSubmissions, selectedFormId])

  useEffect(() => {
    if (!selectedFormId || (!showSubmissionDetails && !showSubmissionModal)) return

    const intervalId = window.setInterval(() => {
      void loadSubmissions(selectedFormId, { showLoading: false, clearOnError: false })
    }, 15000)

    return () => window.clearInterval(intervalId)
  }, [loadSubmissions, selectedFormId, showSubmissionDetails, showSubmissionModal])

  const selectedForm = useMemo(
    () => forms.find((form) => form.id === selectedFormId) ?? null,
    [forms, selectedFormId],
  )

  const selectedTagName = useMemo(
    () => tags.find((tag) => tag.id === selectedForm?.onSubmitTagId)?.name ?? null,
    [selectedForm?.onSubmitTagId, tags],
  )

  const selectedScenarioName = useMemo(
    () => scenarios.find((scenario) => scenario.id === selectedForm?.onSubmitScenarioId)?.name ?? null,
    [selectedForm?.onSubmitScenarioId, scenarios],
  )

  const selectedSubmission = useMemo(
    () => submissions.find((submission) => submission.id === selectedSubmissionId) ?? submissions[0] ?? null,
    [selectedSubmissionId, submissions],
  )

  const selectedSubmissionEntries = useMemo(
    () => (selectedForm && selectedSubmission ? buildSubmissionEntries(selectedForm, selectedSubmission) : []),
    [selectedForm, selectedSubmission],
  )

  const totalSubmissionPages = Math.max(1, Math.ceil(submissions.length / submissionsPerPage))

  const paginatedSubmissions = useMemo(() => {
    const startIndex = (submissionPage - 1) * submissionsPerPage
    return submissions.slice(startIndex, startIndex + submissionsPerPage)
  }, [submissionPage, submissions, submissionsPerPage])

  useEffect(() => {
    setSubmissionSlackDraft(selectedSubmission?.slackChannelId ?? '')
  }, [selectedSubmission])

  const publicShareUrl = useMemo(() => {
    if (!selectedFormId || !publicOrigin) return ''

    const url = new URL('/public-form', publicOrigin)
    url.searchParams.set('id', selectedFormId)
    if (shareSlackChannelId.trim()) {
      url.searchParams.set('slackChannelId', shareSlackChannelId.trim())
    }
    if (shareRouteFriendId.trim()) {
      url.searchParams.set('sharedBy', shareRouteFriendId.trim())
    }
    return url.toString()
  }, [publicOrigin, selectedFormId, shareRouteFriendId, shareSlackChannelId])

  const selectedFormIsAgencyAccessibleTravel = useMemo(
    () => isAgencyAccessibleTravelForm(selectedForm),
    [selectedForm],
  )

  const customerQuestionTemplate = useMemo(
    () => buildCustomerQuestionTemplate(selectedForm),
    [selectedForm],
  )

  const copyTarget = async () => {
    if (!publicShareUrl) return
    try {
      await copyTextToClipboard(publicShareUrl)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('URLのコピーに失敗しました')
    }
  }

  const copyCustomerQuestionTemplate = async () => {
    try {
      await copyTextToClipboard(customerQuestionTemplate)
      setTemplateCopied(true)
      window.setTimeout(() => setTemplateCopied(false), 2000)
    } catch {
      setError('質問文テンプレートのコピーに失敗しました')
    }
  }

  const openSubmissionDetails = () => {
    setError('')
    setShowSubmissionDetails(true)
    setShowSubmissionModal(false)
    if (selectedFormId) {
      void loadSubmissions(selectedFormId, { showLoading: true, clearOnError: false })
    }
    window.setTimeout(() => {
      document.getElementById('submission-list')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 0)
  }

  const openSubmissionModal = (submissionId: string) => {
    setSelectedSubmissionId(submissionId)
    setError('')
    setShowSubmissionModal(true)
  }

  const saveSubmissionSlackChannel = async () => {
    if (!selectedSubmission) return

    setSubmissionSaving(true)
    setError('')

    try {
      const res = await api.forms.updateSubmission(selectedSubmission.id, {
        slackChannelId: submissionSlackDraft.trim() || null,
      })

      if (!res.success) {
        throw new Error('Slack ID の保存に失敗しました')
      }

      setSubmissions((current) => current.map((submission) => (
        submission.id === res.data.id ? res.data : submission
      )))
      setSelectedSubmissionId(res.data.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Slack ID の保存に失敗しました')
    } finally {
      setSubmissionSaving(false)
    }
  }

  const handleDeleteForm = async (form: HarnessForm) => {
    if (typeof window !== 'undefined' && !window.confirm(`「${form.name}」を削除しますか？`)) {
      return
    }

    setDeletingFormId(form.id)
    setError('')

    try {
      const res = await api.forms.delete(form.id)
      if (!res.success) {
        throw new Error('フォームの削除に失敗しました')
      }

      const nextForms = forms.filter((item) => item.id !== form.id)
      setForms(nextForms)
      setSelectedFormId((current) => current === form.id ? nextForms[0]?.id ?? null : current)

      if (selectedFormId === form.id) {
        setSubmissions([])
        setSelectedSubmissionId(null)
        setShowSubmissionDetails(false)
        setShowSubmissionModal(false)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'フォームの削除に失敗しました')
    } finally {
      setDeletingFormId(null)
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Standalone Forms"
        title="LIFFForm Studio"
        description="Harness と完全に分けて、フォーム作成・公開URL共有・回答確認だけを扱う管理画面です。"
      />

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600">
          公開フォーム URL に `Slack channel ID` と `sharedBy` を焼き込めます。
        </p>
        <Link
          href="/forms/new"
          className="rounded-full bg-emerald-800 px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
        >
          新規フォームを作成
        </Link>
      </div>

      {error && (
        <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="rounded-3xl border border-slate-200 bg-white/90 p-10 text-center text-sm text-slate-400 shadow-sm">
          読み込み中...
        </div>
      ) : forms.length === 0 ? (
        <div className="rounded-3xl border border-slate-200 bg-white/90 p-10 text-center shadow-sm">
          <p className="text-sm text-slate-400">フォームがありません</p>
          <Link
            href="/forms/new"
            className="mt-4 inline-flex rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
          >
            最初のフォームを作る
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
          <div className="rounded-3xl border border-slate-200 bg-white/90 p-3 shadow-sm">
            <p className="px-2 pb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              Forms
            </p>
            <div className="space-y-2">
              {forms.map((form) => (
                <button
                  key={form.id}
                  onClick={() => setSelectedFormId(form.id)}
                  className={`w-full rounded-2xl border px-4 py-3 text-left transition-colors ${
                    selectedFormId === form.id
                      ? 'border-emerald-200 bg-emerald-50'
                      : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">{form.name}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {form.fields.length}項目 / 回答 {form.submitCount} 件
                      </p>
                    </div>
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${
                        form.isActive
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {form.isActive ? '受付中' : '停止中'}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {selectedForm && (
            <div className="space-y-6">
              <section className="rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-xl font-bold text-slate-950">{selectedForm.name}</h2>
                      <span
                        className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
                          selectedForm.isActive
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-slate-100 text-slate-500'
                        }`}
                      >
                        {selectedForm.isActive ? '受付中' : '停止中'}
                      </span>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-slate-600">
                      {selectedForm.description || '説明文はありません'}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={openSubmissionDetails}
                      className="rounded-2xl bg-slate-50 px-4 py-3 text-right transition-colors hover:bg-slate-100"
                    >
                      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">
                        Submissions
                      </p>
                      <p className="mt-1 text-2xl font-bold text-slate-900">{selectedForm.submitCount}</p>
                      <p className="mt-1 text-xs text-slate-500">一覧を開く</p>
                    </button>
                    <Link
                      href={`/forms/edit?id=${selectedForm.id}`}
                      className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
                    >
                      フォームを編集
                    </Link>
                    <button
                      type="button"
                      onClick={() => void handleDeleteForm(selectedForm)}
                      disabled={deletingFormId === selectedForm.id}
                      className="rounded-full border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {deletingFormId === selectedForm.id ? '削除中...' : 'フォームを削除'}
                    </button>
                  </div>
                </div>

                <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                      保存設定
                    </p>
                    <p className="mt-2 text-sm font-medium text-slate-900">
                      {selectedForm.saveToMetadata ? 'metadata に保存' : '保存しない'}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                      送信時タグ
                    </p>
                    <p className="mt-2 text-sm font-medium text-slate-900">
                      {selectedTagName || selectedForm.onSubmitTagId || 'なし'}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                      送信時シナリオ
                    </p>
                    <p className="mt-2 text-sm font-medium text-slate-900">
                      {selectedScenarioName || selectedForm.onSubmitScenarioId || 'なし'}
                    </p>
                  </div>
                </div>
              </section>

              <section className="rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">共有URL</h3>
                    <p className="mt-1 text-xs text-slate-500">
                      代理店様が入力するフォームURLと、お客様への確認文をまとめて扱えます。
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    {selectedFormIsAgencyAccessibleTravel && (
                      <button
                        onClick={copyCustomerQuestionTemplate}
                        disabled={!selectedForm}
                        className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800 transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
                      >
                        {templateCopied ? '送信文コピー済み' : 'お客様への送信文をコピー'}
                      </button>
                    )}
                    <button
                      onClick={copyTarget}
                      disabled={!publicShareUrl}
                      className="rounded-full bg-emerald-800 px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-slate-300"
                    >
                      {copied ? 'URLコピー済み' : 'URLをコピー'}
                    </button>
                  </div>
                </div>

                <div className="mt-4 space-y-3">
                  {selectedFormIsAgencyAccessibleTravel && (
                    <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-xs leading-5 text-emerald-900">
                      お客様へご確認の際は「お客様への送信文をコピー」ボタンを押してください。宛名の差し替えが不要な送信用テンプレートがコピーされるため、メールやLINEに貼り付けてそのまま送れます。回収した内容をこのフォームに転記してください。
                    </div>
                  )}

                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600">
                      共有者 Friend ID を付ける場合
                    </label>
                    <input
                      value={shareRouteFriendId}
                      onChange={(event) => setShareRouteFriendId(event.target.value)}
                      placeholder="未入力なら回答者本人のSlack連携で通知"
                      className="w-full rounded-2xl border border-slate-300 px-3 py-2 text-sm"
                    />
                    <p className="mt-1 text-xs text-slate-400">
                      指定すると、回答通知の Slack ルーティングはその Friend ID を優先します。
                    </p>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600">
                      Slack チャンネル ID を固定する場合
                    </label>
                    <input
                      value={shareSlackChannelId}
                      onChange={(event) => setShareSlackChannelId(event.target.value)}
                      placeholder="例: C08ABCDEF12 / 未入力なら C0AL6RG7V9Q"
                      className="w-full rounded-2xl border border-slate-300 px-3 py-2 text-sm"
                    />
                    <p className="mt-1 text-xs text-slate-400">
                      URLごとに通知先チャンネルを固定できます。未入力なら C0AL6RG7V9Q に送ります。
                    </p>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600">
                      公開フォームURL
                    </label>
                    <input
                      readOnly
                      value={publicShareUrl || '生成中...'}
                      className="w-full rounded-2xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-700"
                    />
                    <p className="mt-1 text-xs text-slate-400">
                      この URL は公開フォームです。チャンネルや配布媒体を問わず使えます。
                    </p>
                  </div>
                </div>
              </section>

              <section className="rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-sm">
                <h3 className="text-sm font-semibold text-slate-900">設問内容</h3>
                <div className="mt-4 space-y-4">
                  {selectedForm.fields.map((field, index) => (
                    <div key={`${field.name}-${index}`} className="rounded-2xl border border-slate-200 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-slate-900 px-2 text-xs font-semibold text-white">
                              {index + 1}
                            </span>
                            <p className="text-sm font-semibold text-slate-900">{field.label}</p>
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                              {fieldTypeLabel(field.type)}
                            </span>
                            {field.required && (
                              <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-600">
                                必須
                              </span>
                            )}
                          </div>
                          <p className="mt-2 text-xs text-slate-500">キー: {field.name}</p>
                        </div>
                      </div>

                      {(field.helperText || field.placeholder || field.options?.length) && (
                        <div className="mt-4 space-y-3">
                          {field.helperText && (
                            <div className="rounded-2xl bg-slate-50 p-3">
                              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">
                                Helper
                              </p>
                              <p className="mt-1 text-sm text-slate-700">{field.helperText}</p>
                            </div>
                          )}
                          {field.placeholder && (
                            <div className="rounded-2xl bg-slate-50 p-3">
                              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">
                                Placeholder
                              </p>
                              <p className="mt-1 text-sm text-slate-700">{field.placeholder}</p>
                            </div>
                          )}
                          {field.options && field.options.length > 0 && (
                            <div className="rounded-2xl bg-slate-50 p-3">
                              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">
                                Options
                              </p>
                              <div className="mt-2 flex flex-wrap gap-2">
                                {field.options.map((option) => (
                                  <span
                                    key={option}
                                    className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700"
                                  >
                                    {option}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            </div>
          )}
        </div>
      )}

      {showSubmissionDetails && selectedForm && (
        <section id="submission-list" className="mt-6 rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">回答一覧</h3>
              <p className="mt-1 text-xs text-slate-500">
                回答者一覧はページ内で確認し、詳細はモーダルで開きます。
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                {submissions.length} 件
              </span>
              {totalSubmissionPages > 1 && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSubmissionPage((current) => Math.max(1, current - 1))}
                    disabled={submissionPage === 1}
                    className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    前へ
                  </button>
                  <span className="text-xs text-slate-500">
                    {submissionPage} / {totalSubmissionPages}
                  </span>
                  <button
                    type="button"
                    onClick={() => setSubmissionPage((current) => Math.min(totalSubmissionPages, current + 1))}
                    disabled={submissionPage === totalSubmissionPages}
                    className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    次へ
                  </button>
                </div>
              )}
            </div>
          </div>

          {submissionsLoading ? (
            <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-400">
              回答を読み込み中...
            </div>
          ) : submissions.length === 0 ? (
            <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-400">
              まだ回答はありません。
            </div>
          ) : (
            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {paginatedSubmissions.map((submission) => {
                const display = findSubmissionDisplay(selectedForm, submission)

                return (
                  <button
                    key={submission.id}
                    type="button"
                    onClick={() => openSubmissionModal(submission.id)}
                    className="rounded-2xl border border-slate-200 bg-white px-4 py-4 text-left transition-colors hover:border-emerald-200 hover:bg-emerald-50/40"
                  >
                    <p className="truncate text-sm font-semibold text-slate-900">
                      {display.title}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {display.subtitle}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-slate-400">
                      <span>{formatDateTime(submission.createdAt)}</span>
                      {submission.slackChannelId && (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-500">
                          Slack: {submission.slackChannelId}
                        </span>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </section>
      )}

      {showSubmissionModal && selectedForm && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/45 p-4">
          <div
            className="absolute inset-0"
            onClick={() => setShowSubmissionModal(false)}
            aria-hidden="true"
          />
          <section className="relative z-10 flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-5">
              <div>
                <h3 className="text-lg font-semibold text-slate-950">回答詳細</h3>
                <p className="mt-1 text-sm text-slate-500">
                  {selectedForm.name} の回答を回答者ごとに確認できます。
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                  {selectedForm.submitCount} 件
                </span>
                <button
                  type="button"
                  onClick={() => setShowSubmissionModal(false)}
                  className="rounded-full border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50"
                >
                  閉じる
                </button>
              </div>
            </div>

            {error && (
              <div className="border-b border-red-100 bg-red-50 px-6 py-3 text-sm text-red-700">
                {error}
              </div>
            )}

            {submissionsLoading ? (
              <div className="p-8 text-center text-sm text-slate-400">
                回答を読み込み中...
              </div>
            ) : submissions.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-400">
                まだ回答はありません。
              </div>
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto p-5">
                  {selectedSubmission && (
                    <div className="rounded-3xl border border-slate-200 bg-slate-50/70 p-5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <h4 className="text-lg font-semibold text-slate-900">
                            {findSubmissionDisplay(selectedForm, selectedSubmission).title}
                          </h4>
                          <p className="mt-1 text-sm text-slate-500">
                            {formatDateTime(selectedSubmission.createdAt)}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              const currentIndex = submissions.findIndex((submission) => submission.id === selectedSubmission.id)
                              if (currentIndex > 0) {
                                setSelectedSubmissionId(submissions[currentIndex - 1].id)
                              }
                            }}
                            disabled={submissions.findIndex((submission) => submission.id === selectedSubmission.id) <= 0}
                            className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            前の回答
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const currentIndex = submissions.findIndex((submission) => submission.id === selectedSubmission.id)
                              if (currentIndex >= 0 && currentIndex < submissions.length - 1) {
                                setSelectedSubmissionId(submissions[currentIndex + 1].id)
                              }
                            }}
                            disabled={submissions.findIndex((submission) => submission.id === selectedSubmission.id) >= submissions.length - 1}
                            className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            次の回答
                          </button>
                          {selectedSubmission.formIssueId && (
                            <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-600 ring-1 ring-slate-200">
                              issue: {selectedSubmission.formIssueId}
                            </span>
                          )}
                          {selectedSubmission.slackChannelId && (
                            <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-600 ring-1 ring-slate-200">
                              slack: {selectedSubmission.slackChannelId}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="mt-5 space-y-3">
                        <div className="rounded-2xl border border-slate-200 bg-white p-4">
                          <div className="flex flex-wrap items-end gap-3">
                            <div className="min-w-[240px] flex-1">
                              <label className="text-sm font-semibold text-slate-900">
                                回答に紐づく Slack Channel ID
                              </label>
                              <input
                                value={submissionSlackDraft}
                                onChange={(event) => setSubmissionSlackDraft(event.target.value)}
                                placeholder="例: C08ABCDEF12"
                                className="mt-2 w-full rounded-2xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
                              />
                              <p className="mt-1 text-xs text-slate-400">
                                この回答に対して通知先チャンネルを明示的に紐づけます。
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={saveSubmissionSlackChannel}
                              disabled={submissionSaving}
                              className="rounded-full bg-emerald-800 px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {submissionSaving ? '保存中...' : 'Slack ID を保存'}
                            </button>
                          </div>
                        </div>

                        {selectedSubmissionEntries.map((entry) => (
                          <div key={entry.key} className="rounded-2xl border border-slate-200 bg-white p-4">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-sm font-semibold text-slate-900">{entry.label}</p>
                              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
                                {fieldTypeLabel(entry.type as HarnessForm['fields'][number]['type'])}
                              </span>
                            </div>
                            <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">
                              {entry.value}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
