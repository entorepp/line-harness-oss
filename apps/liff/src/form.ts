/**
 * LIFF Form Page — Dynamic form renderer for LINE surveys / questionnaires
 *
 * Flow:
 * 1. Fetch form definition from API using form ID from query params
 * 2. Render form fields dynamically (text, email, select, radio, etc.)
 * 3. On submit: POST to /api/forms/:id/submit with form data
 * 4. Show success message (auto-close in LINE app)
 *
 * URL format: https://liff.line.me/{LIFF_ID}?page=form&id={FORM_ID}
 */

import { getCityDateEntriesIssue, getVisibleFormFields, normalizeCityDateEntries } from '@line-crm/shared';
import type { FormFieldVisibilityCondition } from '@line-crm/shared';

declare const liff: {
  init(config: { liffId: string }): Promise<void>;
  isLoggedIn(): boolean;
  login(opts?: { redirectUri?: string }): void;
  getProfile(): Promise<{ userId: string; displayName: string; pictureUrl?: string }>;
  getIDToken(): string | null;
  isInClient(): boolean;
  closeWindow(): void;
};

const API_URL = import.meta.env?.VITE_API_URL || 'http://localhost:8787';
const UUID_STORAGE_KEY = 'lh_uuid';
const OTHER_SENTINEL = '__other__';

interface FormField {
  name: string;
  label: string;
  type: 'text' | 'email' | 'tel' | 'number' | 'textarea' | 'select' | 'radio' | 'checkbox' | 'date' | 'time' | 'file' | 'city_dates';
  required?: boolean;
  options?: string[];
  placeholder?: string;
  helperText?: string;
  allowOtherOption?: boolean;
  otherOptionLabel?: string;
  accept?: string;
  multiple?: boolean;
  maxFiles?: number;
  digitsOnly?: boolean;
  cityPlaceholder?: string;
  cityOptions?: string[];
  datesPlaceholder?: string;
  startDateLabel?: string;
  endDateLabel?: string;
  calendarModal?: boolean;
  dateButtonLabel?: string;
  addItemLabel?: string;
  removeItemLabel?: string;
  maxItems?: number;
  visibleWhen?: FormFieldVisibilityCondition;
}

interface UploadedFormFile {
  url: string;
  key: string;
  fileName: string;
  fileSize: number;
  fileSizeFormatted: string;
  isImage: boolean;
  ext: string;
  icon: string;
}

interface FormDef {
  id: string;
  name: string;
  description: string | null;
  fields: FormField[];
  locale?: string | null;
  isActive: boolean;
  submitButtonLabel?: string | null;
  successTitle?: string | null;
  successDescription?: string | null;
}

interface FormState {
  formDef: FormDef | null;
  profile: { userId: string; displayName: string; pictureUrl?: string } | null;
  friendId: string | null;
  sharedByFriendId: string | null;
  slackChannelId: string | null;
  successRedirectUrl: string | null;
  submitting: boolean;
}

const state: FormState = {
  formDef: null,
  profile: null,
  friendId: null,
  sharedByFriendId: null,
  slackChannelId: null,
  successRedirectUrl: null,
  submitting: false,
};

const localizedTextDefaults: Record<string, {
  submitButtonLabel: string;
  submittingLabel: string;
  successTitle: string;
  successDescription: string;
  approximateDateHelper: string;
  approximateStartDatePlaceholder: string;
  approximateEndDatePlaceholder: string;
}> = {
  ja: {
    submitButtonLabel: '送信する',
    submittingLabel: '送信中...',
    successTitle: '送信完了！',
    successDescription: 'ご回答ありがとうございました。',
    approximateDateHelper: '日付が未定の場合は「2月頃」「2026年春」「2月中旬〜下旬」などでも構いません。',
    approximateStartDatePlaceholder: '例：2026/2/10、2月頃、2026年春',
    approximateEndDatePlaceholder: '例：2026/2/17、2月下旬、未定',
  },
  en: {
    submitButtonLabel: 'Submit',
    submittingLabel: 'Submitting...',
    successTitle: 'Your response has been submitted',
    successDescription: 'Thank you for your response.',
    approximateDateHelper: 'If exact dates are not decided yet, approximate timing such as "around February", "spring 2026", or "mid to late February" is fine.',
    approximateStartDatePlaceholder: 'e.g. Feb 10, 2026 / around February / spring 2026',
    approximateEndDatePlaceholder: 'e.g. Feb 17, 2026 / late February / undecided',
  },
  nl: {
    submitButtonLabel: 'Verzenden',
    submittingLabel: 'Verzenden...',
    successTitle: 'Uw antwoord is verzonden',
    successDescription: 'Dank u voor uw antwoord.',
    approximateDateHelper: 'Als de exacte datum nog niet vaststaat, mag u ook iets invullen zoals "rond februari", "voorjaar 2026" of "midden tot eind februari".',
    approximateStartDatePlaceholder: 'bijv. 10 februari 2026 / rond februari / voorjaar 2026',
    approximateEndDatePlaceholder: 'bijv. 17 februari 2026 / eind februari / nog niet bekend',
  },
  ko: {
    submitButtonLabel: '제출',
    submittingLabel: '제출 중...',
    successTitle: '제출이 완료되었습니다',
    successDescription: '응답해 주셔서 감사합니다.',
    approximateDateHelper: '정확한 날짜가 아직 정해지지 않았다면 “2월경”, “2026년 봄”, “2월 중순~하순”처럼 적어 주셔도 됩니다.',
    approximateStartDatePlaceholder: '예: 2026/2/10, 2월경, 2026년 봄',
    approximateEndDatePlaceholder: '예: 2026/2/17, 2월 하순, 미정',
  },
  'zh-TW': {
    submitButtonLabel: '送出',
    submittingLabel: '送出中...',
    successTitle: '表單已送出',
    successDescription: '感謝您的填寫。',
    approximateDateHelper: '若確切日期尚未決定，也可以填寫「2月左右」、「2026年春季」、「2月中下旬」等大約時期。',
    approximateStartDatePlaceholder: '例：2026/2/10、2月左右、2026年春季',
    approximateEndDatePlaceholder: '例：2026/2/17、2月下旬、尚未決定',
  },
};

function normalizeLocale(value: string | null | undefined): string {
  const locale = value?.trim() || '';
  if (!locale) return 'ja';

  const lowered = locale.toLowerCase();
  if (lowered === 'ja' || lowered === 'ja-jp') return 'ja';
  if (lowered === 'en' || lowered === 'en-us' || lowered === 'en-gb') return 'en';
  if (lowered === 'nl' || lowered === 'nl-nl') return 'nl';
  if (lowered === 'ko' || lowered === 'ko-kr') return 'ko';
  if (lowered === 'zh-tw' || lowered === 'zh_tw') return 'zh-TW';
  return locale;
}

function getLocalizedTexts(locale: string | null | undefined) {
  return localizedTextDefaults[normalizeLocale(locale)] || localizedTextDefaults.ja;
}

function getCurrentLocalizedTexts() {
  return getLocalizedTexts(state.formDef?.locale);
}

function normalizeRedirectUrl(value: string | null): string | null {
  if (!value?.trim()) return null;

  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function getSuccessRedirectUrl(): string | null {
  const params = new URLSearchParams(window.location.search);
  return normalizeRedirectUrl(
    params.get('successRedirect')
    || params.get('redirectUrl')
    || params.get('redirect'),
  );
}

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function apiCall(path: string, options?: RequestInit): Promise<Response> {
  return fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
}

async function uploadFile(file: File): Promise<UploadedFormFile> {
  const formData = new FormData();
  formData.append('file', file);

  const res = await fetch(`${API_URL}/api/upload`, {
    method: 'POST',
    body: formData,
  });
  const json = await res.json() as { success: boolean; data?: UploadedFormFile; error?: string };
  if (!res.ok || !json.success || !json.data) {
    throw new Error(json.error || `${file.name} のアップロードに失敗しました`);
  }
  return json.data;
}

function getApp(): HTMLElement {
  return document.getElementById('app')!;
}

// ========== Field Rendering ==========

function getOtherFieldName(field: FormField): string {
  return `${field.name}__other`;
}

function renderOtherInput(field: FormField, index: number): string {
  if (!field.allowOtherOption) return '';

  const otherLabel = field.otherOptionLabel || 'その他';
  return `<input
    type="text"
    name="${escapeAttr(getOtherFieldName(field))}"
    id="field-${index}-other"
    class="form-input other-input"
    placeholder="${escapeAttr(`${otherLabel}の内容`)}"
    data-other-for="${escapeAttr(field.name)}"
    hidden
  />`;
}

function isFlexibleTravelDateField(field: FormField): boolean {
  if (field.type !== 'date') return false;
  return field.name === 'travel_start_date' || field.name === 'travel_end_date';
}

function getFlexibleDatePlaceholder(field: FormField): string {
  const texts = getCurrentLocalizedTexts();
  return field.name === 'travel_end_date'
    ? texts.approximateEndDatePlaceholder
    : texts.approximateStartDatePlaceholder;
}

function renderCityDateRow(field: FormField, rowIndex: number): string {
  const fieldName = escapeAttr(field.name);
  const cityPlaceholder = escapeAttr(field.cityPlaceholder || 'City, e.g. Tokyo');
  const startDateLabel = escapeHtml(field.startDateLabel || 'Start date');
  const endDateLabel = escapeHtml(field.endDateLabel || 'End date');
  const removeLabel = escapeHtml(field.removeItemLabel || 'Remove');
  const cityControl = field.cityOptions && field.cityOptions.length > 0
    ? `<select
        class="form-select city-date-input"
        name="${fieldName}__city"
        data-city-date-role="city"
        aria-label="City ${rowIndex + 1}">
        <option value="">${escapeHtml(field.cityPlaceholder || 'Select a city')}</option>
        ${field.cityOptions.map((city) => `<option value="${escapeAttr(city)}">${escapeHtml(city)}</option>`).join('')}
      </select>`
    : `<input
        type="text"
        class="form-input city-date-input"
        name="${fieldName}__city"
        data-city-date-role="city"
        placeholder="${cityPlaceholder}"
        aria-label="City ${rowIndex + 1}" />`;
  const dateControl = field.calendarModal
    ? `<button
        type="button"
        class="form-input city-date-open"
        data-city-date-open
        aria-label="${escapeAttr(field.dateButtonLabel || 'Select dates')} for city ${rowIndex + 1}">
        <span data-city-date-summary>${escapeHtml(field.dateButtonLabel || 'Select dates')}</span>
      </button>
      <input type="hidden" name="${fieldName}__start_date" data-city-date-role="startDate" />
      <input type="hidden" name="${fieldName}__end_date" data-city-date-role="endDate" />`
    : `<label class="city-date-control">
        <span>${startDateLabel}</span>
        <input
          type="date"
          class="form-input city-date-input"
          name="${fieldName}__start_date"
          data-city-date-role="startDate"
          aria-label="${escapeAttr(field.startDateLabel || 'Start date')} for city ${rowIndex + 1}" />
      </label>
      <label class="city-date-control">
        <span>${endDateLabel}</span>
        <input
          type="date"
          class="form-input city-date-input"
          name="${fieldName}__end_date"
          data-city-date-role="endDate"
          aria-label="${escapeAttr(field.endDateLabel || 'End date')} for city ${rowIndex + 1}" />
      </label>`;

  return `<div class="city-date-row ${field.calendarModal ? 'city-date-row-modal' : 'city-date-row-inline'}" data-city-date-row>
    ${cityControl}
    ${dateControl}
    <button type="button" class="city-date-remove" data-city-date-remove>${removeLabel}</button>
  </div>`;
}

function renderField(field: FormField, index: number): string {
  const required = field.required ? ' required' : '';
  const flexibleTravelDate = isFlexibleTravelDateField(field);
  const effectivePlaceholder = field.placeholder || (flexibleTravelDate ? getFlexibleDatePlaceholder(field) : '');
  const placeholder = effectivePlaceholder ? ` placeholder="${escapeAttr(effectivePlaceholder)}"` : '';
  const requiredMark = field.required ? '<span class="required-mark">*</span>' : '';
  const fieldId = `field-${index}`;
  const fieldName = escapeAttr(field.name);
  const helperText = field.helperText?.trim() || (flexibleTravelDate ? getCurrentLocalizedTexts().approximateDateHelper : '');
  const helper = helperText
    ? `<p class="field-helper">${escapeHtml(helperText)}</p>`
    : '';

  let inputHtml = '';

  switch (field.type) {
    case 'city_dates': {
      const maxItems = Number.isFinite(field.maxItems) && Number(field.maxItems) > 0
        ? Number(field.maxItems)
        : 12;
      inputHtml = `<div
        class="city-dates"
        id="city-dates-${fieldName}"
        data-city-dates-field="${fieldName}"
        data-max-items="${maxItems}">
        <div class="city-date-list" data-city-date-list>
          ${renderCityDateRow(field, 0)}
        </div>
        <button type="button" class="city-date-add" data-city-date-add>
          <span aria-hidden="true">＋</span>${escapeHtml(field.addItemLabel || 'Add another city')}
        </button>
        ${field.calendarModal ? `<dialog class="city-date-dialog" data-city-date-dialog>
          <div class="city-date-dialog-header">
            <div>
              <p>TRAVEL DATES</p>
              <h3 data-city-date-dialog-title>Select dates</h3>
            </div>
            <button type="button" class="city-date-dialog-close" data-city-date-dialog-cancel>Close</button>
          </div>
          <div class="city-date-dialog-grid">
            <label class="city-date-control">
              <span>${escapeHtml(field.startDateLabel || 'Start date')}</span>
              <input type="date" class="form-input" data-city-date-modal-role="startDate" />
            </label>
            <label class="city-date-control">
              <span>${escapeHtml(field.endDateLabel || 'End date')}</span>
              <input type="date" class="form-input" data-city-date-modal-role="endDate" />
            </label>
          </div>
          <p class="city-date-dialog-error" data-city-date-dialog-error hidden>The end date must be on or after the start date.</p>
          <div class="city-date-dialog-actions">
            <button type="button" class="city-date-dialog-secondary" data-city-date-dialog-cancel>Cancel</button>
            <button type="button" class="city-date-dialog-primary" data-city-date-dialog-apply disabled>Apply dates</button>
          </div>
        </dialog>` : ''}
      </div>`;
      break;
    }

    case 'file': {
      const accept = field.accept ? ` accept="${escapeAttr(field.accept)}"` : '';
      const multiple = field.multiple === false ? '' : ' multiple';
      inputHtml = `<input
        type="file"
        name="${fieldName}"
        id="${fieldId}"
        class="form-file"
        ${accept}${multiple}${required} />
        <div class="file-list" id="${fieldId}-files"></div>`;
      break;
    }

    case 'textarea':
      inputHtml = `<textarea
        name="${fieldName}"
        id="${fieldId}"
        class="form-textarea"
        rows="4"
        ${placeholder}${required}></textarea>`;
      break;

    case 'select': {
      const opts = (field.options ?? [])
        .map((o) => `<option value="${escapeAttr(o)}">${escapeHtml(o)}</option>`)
        .join('');
      const otherOption = field.allowOtherOption
        ? `<option value="${OTHER_SENTINEL}">${escapeHtml(field.otherOptionLabel || 'その他')}</option>`
        : '';
      inputHtml = `<select
        name="${fieldName}"
        id="${fieldId}"
        class="form-select"${required}>
        <option value="">選択してください</option>
        ${opts}
        ${otherOption}
      </select>
      ${renderOtherInput(field, index)}`;
      break;
    }

    case 'radio': {
      const radios = (field.options ?? [])
        .map(
          (o) =>
            `<label class="radio-label">
              <input type="radio" name="${fieldName}" value="${escapeAttr(o)}"${required} />
              ${escapeHtml(o)}
            </label>`,
        )
        .join('');
      const otherRadio = field.allowOtherOption
        ? `<label class="radio-label">
            <input type="radio" name="${fieldName}" value="${OTHER_SENTINEL}"${required} />
            ${escapeHtml(field.otherOptionLabel || 'その他')}
          </label>
          ${renderOtherInput(field, index)}`
        : '';
      inputHtml = `<div class="radio-group">${radios}${otherRadio}</div>`;
      break;
    }

    case 'checkbox': {
      const boxes = (field.options ?? [])
        .map(
          (o) =>
            `<label class="checkbox-label">
              <input type="checkbox" name="${fieldName}" value="${escapeAttr(o)}" />
              ${escapeHtml(o)}
            </label>`,
        )
        .join('');
      const otherCheckbox = field.allowOtherOption
        ? `<label class="checkbox-label">
            <input type="checkbox" name="${fieldName}" value="${OTHER_SENTINEL}" />
            ${escapeHtml(field.otherOptionLabel || 'その他')}
          </label>
          ${renderOtherInput(field, index)}`
        : '';
      inputHtml = `<div class="checkbox-group">${boxes}${otherCheckbox}</div>`;
      break;
    }

    default: {
      const digitsOnly = Boolean(field.digitsOnly);
      const inputType = digitsOnly ? 'text' : (flexibleTravelDate ? 'text' : escapeHtml(field.type));
      const numericAttributes = digitsOnly
        ? ' inputmode="numeric" pattern="[0-9]*" autocomplete="off" data-digits-only'
        : '';
      inputHtml = `<input
        type="${inputType}"
        name="${fieldName}"
        id="${fieldId}"
        class="form-input"
        ${placeholder}${numericAttributes}${required} />`;
      break;
    }
  }

  return `
    <div class="form-field" id="field-wrap-${index}" data-field-name="${fieldName}">
      <label class="form-label" for="${fieldId}">
        ${escapeHtml(field.label)}${requiredMark}
      </label>
      ${helper}
      ${inputHtml}
    </div>
  `;
}

// ========== Styles ==========

function injectStyles(): void {
  if (document.getElementById('form-styles')) return;
  const style = document.createElement('style');
  style.id = 'form-styles';
  style.textContent = `
    .form-page { max-width: 480px; margin: 0 auto; padding: 16px; }
    .form-header { text-align: center; margin-bottom: 24px; }
    .form-header h1 { font-size: 20px; color: #333; margin-bottom: 8px; }
    .form-description { font-size: 14px; color: #999; }
    .form-profile { display: flex; align-items: center; justify-content: center; gap: 8px; margin-top: 12px; }
    .form-profile img { width: 36px; height: 36px; border-radius: 50%; }
    .form-profile span { font-size: 14px; font-weight: 600; }
    .form-body { background: #fff; border-radius: 12px; padding: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
    .form-field { margin-bottom: 20px; }
    .form-field[hidden], .other-input[hidden] { display: none !important; }
    .form-label { display: block; font-size: 14px; font-weight: 600; color: #333; margin-bottom: 6px; }
    .field-helper { margin: -2px 0 8px; color: #666; font-size: 13px; line-height: 1.5; }
    .required-mark { color: #e53e3e; margin-left: 2px; }
    .form-input, .form-textarea, .form-select, .form-file {
      width: 100%; padding: 12px; border: 1.5px solid #e0e0e0; border-radius: 8px;
      font-size: 16px; font-family: inherit; background: #fafafa;
      transition: border-color 0.15s; box-sizing: border-box;
      -webkit-appearance: none;
    }
    .form-input:focus, .form-textarea:focus, .form-select:focus, .form-file:focus {
      outline: none; border-color: #06C755; background: #fff;
    }
    .form-file { cursor: pointer; }
    .city-dates { display: flex; flex-direction: column; gap: 10px; }
    .city-date-list { display: flex; flex-direction: column; gap: 10px; }
    .city-date-row { display: grid; gap: 8px; align-items: end; padding: 10px; border: 1px solid #e1ece5; border-radius: 10px; background: #f7fbf8; }
    .city-date-row-modal { grid-template-columns: minmax(0, 1fr) minmax(0, 1.35fr) auto; }
    .city-date-row-inline { grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr) minmax(0, 1fr) auto; }
    .city-date-control { display: flex; min-width: 0; flex-direction: column; gap: 5px; color: #5e6b63; font-size: 12px; font-weight: 600; }
    .city-date-open { color: #26352c; text-align: left; cursor: pointer; }
    .city-date-row:only-child .city-date-remove { display: none; }
    .city-date-remove { border: 0; background: transparent; color: #68756d; font: inherit; font-size: 12px; font-weight: 600; cursor: pointer; padding: 9px 6px; }
    .city-date-add { align-self: flex-start; display: inline-flex; align-items: center; gap: 5px; border: 1px solid #b9d7c4; border-radius: 999px; background: #fff; color: #16723d; font: inherit; font-size: 14px; font-weight: 700; cursor: pointer; padding: 9px 14px; }
    .city-date-add:disabled { cursor: not-allowed; opacity: 0.45; }
    .city-date-dialog { width: min(92vw, 520px); border: 0; border-radius: 20px; padding: 24px; box-shadow: 0 24px 80px rgba(0,0,0,0.28); }
    .city-date-dialog::backdrop { background: rgba(15,23,42,0.58); backdrop-filter: blur(2px); }
    .city-date-dialog-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
    .city-date-dialog-header p { margin: 0; color: #16723d; font-size: 11px; font-weight: 700; letter-spacing: 0.14em; }
    .city-date-dialog-header h3 { margin: 5px 0 0; color: #1c2720; font-size: 21px; }
    .city-date-dialog-close { border: 0; border-radius: 999px; background: transparent; color: #68756d; font: inherit; font-size: 13px; font-weight: 600; padding: 8px 10px; cursor: pointer; }
    .city-date-dialog-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 22px; }
    .city-date-dialog-error { margin: 12px 0 0; color: #b42318; font-size: 13px; font-weight: 600; }
    .city-date-dialog-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 22px; }
    .city-date-dialog-secondary, .city-date-dialog-primary { border-radius: 999px; font: inherit; font-size: 14px; font-weight: 700; padding: 10px 16px; cursor: pointer; }
    .city-date-dialog-secondary { border: 1px solid #ced8d1; background: #fff; color: #405148; }
    .city-date-dialog-primary { border: 1px solid #16723d; background: #16723d; color: #fff; }
    .city-date-dialog-primary:disabled { cursor: not-allowed; opacity: 0.45; }
    @media (max-width: 520px) {
      .city-date-row { grid-template-columns: 1fr; }
      .city-date-remove { justify-self: start; padding-left: 2px; }
      .city-date-dialog-grid { grid-template-columns: 1fr; }
    }
    .file-list { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; }
    .file-item { display: flex; justify-content: space-between; gap: 8px; padding: 8px 10px; background: #f4fbf7; border-radius: 8px; font-size: 13px; color: #333; }
    .file-size { color: #777; white-space: nowrap; }
    .form-textarea { resize: vertical; min-height: 80px; }
    .form-select { background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23666' d='M6 8L1 3h10z'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 12px center; }
    .radio-group, .checkbox-group { display: flex; flex-direction: column; gap: 10px; }
    .radio-label, .checkbox-label {
      display: flex; align-items: center; gap: 8px; font-size: 15px; color: #333;
      padding: 10px 12px; background: #fafafa; border-radius: 8px; border: 1.5px solid #e0e0e0;
      cursor: pointer; transition: border-color 0.15s;
    }
    .radio-label:has(input:checked), .checkbox-label:has(input:checked) {
      border-color: #06C755; background: #e8faf0;
    }
    .radio-label input, .checkbox-label input { accent-color: #06C755; width: 18px; height: 18px; }
    .radio-label input[type="radio"] { appearance: none; -webkit-appearance: none; width: 18px; height: 18px; border: 2px solid #ccc; border-radius: 4px; background: #fff; cursor: pointer; }
    .radio-label input[type="radio"]:checked { background: #06C755; border-color: #06C755; background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 16 16' fill='white' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M12.207 4.793a1 1 0 010 1.414l-5 5a1 1 0 01-1.414 0l-2-2a1 1 0 011.414-1.414L6.5 9.086l4.293-4.293a1 1 0 011.414 0z'/%3E%3C/svg%3E"); background-size: 14px; background-position: center; background-repeat: no-repeat; }
    .submit-btn {
      width: 100%; padding: 14px; border: none; border-radius: 8px;
      background: #06C755; color: #fff; font-size: 16px; font-weight: 700;
      cursor: pointer; font-family: inherit; margin-top: 8px; transition: opacity 0.15s;
    }
    .submit-btn:active { opacity: 0.85; }
    .submit-btn:disabled { background: #bbb; cursor: not-allowed; }
    .form-error { color: #e53e3e; font-size: 12px; margin-top: 4px; }
    .form-success { text-align: center; padding: 40px 20px; }
    .form-success .check { width: 64px; height: 64px; border-radius: 50%; background: #06C755; color: #fff; font-size: 32px; line-height: 64px; margin: 0 auto 16px; }
    .form-success h2 { font-size: 20px; color: #06C755; margin-bottom: 12px; }
    .form-success p { font-size: 14px; color: #666; line-height: 1.6; }
  `;
  document.head.appendChild(style);
}

// ========== Main Render ==========

function render(): void {
  const { formDef, profile } = state;
  if (!formDef) return;
  const localizedTexts = getCurrentLocalizedTexts();

  injectStyles();
  const app = getApp();
  const profileHtml = profile?.pictureUrl
    ? `<div class="form-profile">
        <img src="${profile.pictureUrl}" alt="" />
        <span>${escapeHtml(profile.displayName)} さん</span>
      </div>`
    : '';

  const fieldsHtml = formDef.fields.map((field, index) => renderField(field, index)).join('');

  app.innerHTML = `
    <div class="form-page">
      <div class="form-header">
        <h1>${escapeHtml(formDef.name)}</h1>
        ${formDef.description ? `<p class="form-description">${escapeHtml(formDef.description)}</p>` : ''}
        ${profileHtml}
      </div>
      <form id="liff-form" class="form-body" novalidate>
        ${fieldsHtml}
        <button type="submit" class="submit-btn" id="submitBtn">${escapeHtml(formDef.submitButtonLabel || localizedTexts.submitButtonLabel)}</button>
      </form>
    </div>
  `;

  attachFormEvents();
  updateFieldVisibility();
}

function renderSuccess(): void {
  const app = getApp();
  const localizedTexts = getCurrentLocalizedTexts();
  const title = state.formDef?.successTitle || localizedTexts.successTitle;
  const description = state.formDef?.successDescription || localizedTexts.successDescription;
  app.innerHTML = `
    <div class="form-page">
      <div class="success-card">
        <div class="success-icon">✓</div>
        <h2>${escapeHtml(title)}</h2>
        <p class="success-message">${escapeHtml(description)}</p>
        <button class="close-btn" id="closeBtn">閉じる</button>
      </div>
    </div>
  `;

  document.getElementById('closeBtn')?.addEventListener('click', () => {
    if (liff.isInClient()) {
      liff.closeWindow();
    } else {
      window.close();
    }
  });

  // Auto-close after 3s inside LINE
  if (liff.isInClient()) {
    setTimeout(() => {
      try { liff.closeWindow(); } catch { /* ignore */ }
    }, 3000);
  }
}

function renderFormError(message: string): void {
  const app = getApp();
  app.innerHTML = `
    <div class="form-page">
      <div class="card">
        <h2 style="color: #e53e3e;">エラー</h2>
        <p class="error">${escapeHtml(message)}</p>
      </div>
    </div>
  `;
}

function renderLoading(): void {
  const app = getApp();
  app.innerHTML = `
    <div class="form-page">
      <div class="card" style="text-align:center;padding:40px 20px;">
        <div class="loading-spinner"></div>
        <p style="margin-top:12px;color:#718096;">読み込み中...</p>
      </div>
    </div>
  `;
}

// ========== Form Submission ==========

type NamedFormControl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

function getNamedControls(name: string): NamedFormControl[] {
  return Array.from(document.getElementsByName(name))
    .filter((el): el is NamedFormControl => (
      el instanceof HTMLInputElement
      || el instanceof HTMLSelectElement
      || el instanceof HTMLTextAreaElement
    ));
}

function getRawFieldValue(field: FormField): unknown {
  if (field.type === 'city_dates') {
    const container = document.getElementById(`city-dates-${field.name}`);
    if (!container) return [];
    return Array.from(container.querySelectorAll<HTMLElement>('[data-city-date-row]')).map((row) => ({
      city: row.querySelector<HTMLInputElement>('[data-city-date-role="city"]')?.value ?? '',
      dates: row.querySelector<HTMLInputElement>('[data-city-date-role="dates"]')?.value ?? '',
      startDate: row.querySelector<HTMLInputElement>('[data-city-date-role="startDate"]')?.value ?? '',
      endDate: row.querySelector<HTMLInputElement>('[data-city-date-role="endDate"]')?.value ?? '',
    }));
  }

  const controls = getNamedControls(field.name);

  if (field.type === 'file') {
    const input = controls.find((control): control is HTMLInputElement => control instanceof HTMLInputElement);
    return Array.from(input?.files ?? []);
  }

  if (field.type === 'checkbox') {
    return controls
      .filter((control): control is HTMLInputElement => control instanceof HTMLInputElement)
      .filter((control) => control.checked)
      .map((control) => control.value);
  }

  if (field.type === 'radio') {
    const checked = controls
      .filter((control): control is HTMLInputElement => control instanceof HTMLInputElement)
      .find((control) => control.checked);
    return checked?.value ?? '';
  }

  return controls[0]?.value ?? '';
}

function getOtherInputValue(field: FormField): string {
  return String(getNamedControls(getOtherFieldName(field))[0]?.value ?? '').trim();
}

function isOtherSelected(field: FormField, value: unknown): boolean {
  if (!field.allowOtherOption) return false;
  if (Array.isArray(value)) return value.includes(OTHER_SENTINEL);
  return value === OTHER_SENTINEL;
}

function collectRawFormData(fields: FormField[]): Record<string, unknown> {
  return Object.fromEntries(fields.map((field) => [field.name, getRawFieldValue(field)]));
}

function getCurrentVisibleFields(rawData = state.formDef ? collectRawFormData(state.formDef.fields) : {}): FormField[] {
  if (!state.formDef) return [];
  return getVisibleFormFields(state.formDef.fields, rawData);
}

function buildSubmissionData(
  visibleFields: FormField[],
  rawData: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const result: Record<string, unknown> = {};

  return (async () => {
    for (const field of visibleFields) {
      const value = rawData[field.name];
      const otherValue = getOtherInputValue(field);
      const otherLabel = field.otherOptionLabel || 'その他';

      if (field.type === 'file') {
        const files = Array.isArray(value)
          ? value.filter((item): item is File => item instanceof File)
          : [];
        if (field.maxFiles && files.length > field.maxFiles) {
          throw new Error(`${field.label} は最大 ${field.maxFiles} ファイルまでです`);
        }
        result[field.name] = await Promise.all(files.map(uploadFile));
        continue;
      }

      if (field.type === 'city_dates') {
        result[field.name] = normalizeCityDateEntries(value)
          .map((entry) => (
            entry.startDate || entry.endDate
              ? `${entry.city}: ${entry.startDate || entry.dates} to ${entry.endDate || entry.dates}`
              : `${entry.city}: ${entry.dates}`
          ));
        continue;
      }

      if (field.type === 'checkbox') {
        const selected = Array.isArray(value)
          ? value.filter((item) => item !== OTHER_SENTINEL)
          : [];
        result[field.name] = isOtherSelected(field, value) && otherValue
          ? [...selected, `${otherLabel}: ${otherValue}`]
          : selected;
        continue;
      }

      result[field.name] = value === OTHER_SENTINEL
        ? (otherValue ? `${otherLabel}: ${otherValue}` : '')
        : (value ?? '');
    }

    return result;
  })();
}

function updateFileList(input: HTMLInputElement): void {
  const list = document.getElementById(`${input.id}-files`);
  if (!list) return;

  const files = Array.from(input.files ?? []);
  list.innerHTML = files.map((file) => (
    `<div class="file-item">
      <span>${escapeHtml(file.name)}</span>
      <span class="file-size">${Math.ceil(file.size / 1024)}KB</span>
    </div>`
  )).join('');
}

function updateFieldVisibility(): void {
  const { formDef } = state;
  if (!formDef) return;

  const rawData = collectRawFormData(formDef.fields);
  const visibleNames = new Set(getCurrentVisibleFields(rawData).map((field) => field.name));

  formDef.fields.forEach((field, index) => {
    const visible = visibleNames.has(field.name);
    const wrapper = document.getElementById(`field-wrap-${index}`);
    if (wrapper) wrapper.hidden = !visible;

    const fieldControls = getNamedControls(field.name);
    const otherControls = getNamedControls(getOtherFieldName(field));
    const otherVisible = visible && isOtherSelected(field, rawData[field.name]);

    if (field.type === 'city_dates') {
      wrapper?.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>('.city-date-input, .city-date-open, .city-date-add, .city-date-remove')
        .forEach((control) => {
          control.disabled = !visible;
        });
      return;
    }

    for (const control of [...fieldControls, ...otherControls]) {
      control.disabled = !visible;
      control.required = false;
    }

    for (const control of fieldControls) {
      control.required = visible && Boolean(field.required) && field.type !== 'checkbox';
    }

    for (const control of otherControls) {
      control.hidden = !otherVisible;
      control.disabled = !otherVisible;
      control.required = otherVisible;
    }
  });
}

function validateForm(): string | null {
  const { formDef } = state;
  if (!formDef) return null;

  const rawData = collectRawFormData(formDef.fields);
  const visibleFields = getCurrentVisibleFields(rawData);

  for (const field of visibleFields) {
    const value = rawData[field.name];

    if (field.type === 'city_dates') {
      const issue = getCityDateEntriesIssue(value);
      if (issue === 'invalid_range') {
        return normalizeLocale(formDef.locale) === 'en'
          ? 'The end date must be on or after the start date'
          : '終了日は開始日以降を選択してください';
      }
      if (issue === 'incomplete') {
        return normalizeLocale(formDef.locale) === 'en'
          ? 'Enter a city, start date and end date for each row'
          : '各行の都市・開始日・終了日を入力してください';
      }
      if (field.required && issue === 'empty') {
        return normalizeLocale(formDef.locale) === 'en'
          ? `${field.label} is required`
          : `${field.label} は必須項目です`;
      }
      continue;
    }

    if (field.digitsOnly && value !== undefined && value !== null && String(value).trim()) {
      if (!/^\d+$/.test(String(value).trim())) {
        return normalizeLocale(formDef.locale) === 'en'
          ? `${field.label} must contain digits only`
          : `${field.label} は数字のみで入力してください`;
      }
    }

    if (field.required) {
      if (field.type === 'checkbox' || field.type === 'file') {
        if (!Array.isArray(value) || value.length === 0) return `${field.label} は必須項目です`;
      } else if (value === undefined || value === null || String(value).trim() === '') {
        return `${field.label} は必須項目です`;
      }
    }

    if (isOtherSelected(field, value) && !getOtherInputValue(field)) {
      return `${field.otherOptionLabel || 'その他'}の内容を入力してください`;
    }
  }

  return null;
}

async function submitForm(): Promise<void> {
  if (state.submitting || !state.formDef) return;

  const validationError = validateForm();
  if (validationError) {
    const existing = getApp().querySelector('.form-error-msg');
    if (existing) existing.remove();
    const errEl = document.createElement('p');
    errEl.className = 'form-error-msg';
    errEl.style.cssText = 'color:#e53e3e;font-size:14px;margin:8px 0;text-align:center;';
    errEl.textContent = validationError;
    const submitBtn = document.getElementById('submitBtn');
    submitBtn?.parentElement?.insertBefore(errEl, submitBtn);
    return;
  }

  state.submitting = true;
  const submitBtn = document.getElementById('submitBtn') as HTMLButtonElement | null;
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = getCurrentLocalizedTexts().submittingLabel;
  }

  try {
    const rawData = collectRawFormData(state.formDef.fields);
    const visibleFields = getCurrentVisibleFields(rawData);
    const data = await buildSubmissionData(visibleFields, rawData);
    console.log('Form data collected:', JSON.stringify(data));
    const body: Record<string, unknown> = { data };
    if (state.profile?.displayName) body.responderDisplayName = state.profile.displayName;
    if (state.profile?.pictureUrl) body.responderPictureUrl = state.profile.pictureUrl;
    if (state.slackChannelId) body.slackChannelId = state.slackChannelId;
    console.log('Submitting to:', `${API_URL}/api/forms/${state.formDef.id}/submit`);

    const res = await apiCall(`/api/forms/${state.formDef.id}/submit`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    console.log('Response status:', res.status);

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      let errMsg = '送信に失敗しました';
      try { const errData = JSON.parse(errText); errMsg = errData.error || errMsg; } catch { errMsg = errText || errMsg; }
      throw new Error(`${res.status}: ${errMsg}`);
    }

    if (state.successRedirectUrl) {
      window.location.assign(state.successRedirectUrl);
      return;
    }

    renderSuccess();
  } catch (err) {
    state.submitting = false;
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = state.formDef.submitButtonLabel || getCurrentLocalizedTexts().submitButtonLabel;
    }
    const existing = getApp().querySelector('.form-error-msg');
    if (existing) existing.remove();
    const errEl = document.createElement('p');
    errEl.className = 'form-error-msg';
    errEl.style.cssText = 'color:#e53e3e;font-size:14px;margin:8px 0;text-align:center;';
    errEl.textContent = err instanceof Error ? err.message : '送信に失敗しました';
    const btn = document.getElementById('submitBtn');
    btn?.parentElement?.insertBefore(errEl, btn);
  }
}

function attachFormEvents(): void {
  const form = document.getElementById('liff-form');
  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    void submitForm();
  });
  form?.addEventListener('input', (event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement && target.matches('[data-digits-only]')) {
      target.value = target.value.replace(/\D/g, '');
    }

    if (target instanceof HTMLInputElement && target.matches('[data-city-date-role="startDate"], [data-city-date-role="endDate"]')) {
      const row = target.closest<HTMLElement>('[data-city-date-row]');
      const startDate = row?.querySelector<HTMLInputElement>('[data-city-date-role="startDate"]');
      const endDate = row?.querySelector<HTMLInputElement>('[data-city-date-role="endDate"]');
      if (startDate && endDate) {
        endDate.min = startDate.value;
        startDate.max = endDate.value;
      }
    }

    if (target instanceof HTMLInputElement && target.matches('[data-city-date-modal-role="startDate"], [data-city-date-modal-role="endDate"]')) {
      const dialog = target.closest<HTMLDialogElement>('[data-city-date-dialog]');
      const startDate = dialog?.querySelector<HTMLInputElement>('[data-city-date-modal-role="startDate"]');
      const endDate = dialog?.querySelector<HTMLInputElement>('[data-city-date-modal-role="endDate"]');
      const applyButton = dialog?.querySelector<HTMLButtonElement>('[data-city-date-dialog-apply]');
      const error = dialog?.querySelector<HTMLElement>('[data-city-date-dialog-error]');
      if (startDate && endDate && applyButton && error) {
        endDate.min = startDate.value;
        startDate.max = endDate.value;
        const invalidRange = Boolean(startDate.value && endDate.value && endDate.value < startDate.value);
        error.hidden = !invalidRange;
        applyButton.disabled = !startDate.value || !endDate.value || invalidRange;
      }
    }

    updateFieldVisibility();
  });
  form?.addEventListener('change', (event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement && target.type === 'file') {
      updateFileList(target);
    }
    updateFieldVisibility();
  });
  form?.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const openDateButton = target.closest<HTMLButtonElement>('[data-city-date-open]');
    if (openDateButton) {
      const row = openDateButton.closest<HTMLElement>('[data-city-date-row]');
      const container = openDateButton.closest<HTMLElement>('[data-city-dates-field]');
      const dialog = container?.querySelector<HTMLDialogElement>('[data-city-date-dialog]');
      const list = container?.querySelector<HTMLElement>('[data-city-date-list]');
      const startValue = row?.querySelector<HTMLInputElement>('[data-city-date-role="startDate"]')?.value || '';
      const endValue = row?.querySelector<HTMLInputElement>('[data-city-date-role="endDate"]')?.value || '';
      const cityValue = row?.querySelector<HTMLInputElement | HTMLSelectElement>('[data-city-date-role="city"]')?.value || 'Select dates';
      const startInput = dialog?.querySelector<HTMLInputElement>('[data-city-date-modal-role="startDate"]');
      const endInput = dialog?.querySelector<HTMLInputElement>('[data-city-date-modal-role="endDate"]');
      const title = dialog?.querySelector<HTMLElement>('[data-city-date-dialog-title]');
      const error = dialog?.querySelector<HTMLElement>('[data-city-date-dialog-error]');
      const applyButton = dialog?.querySelector<HTMLButtonElement>('[data-city-date-dialog-apply]');
      if (!row || !dialog || !list || !startInput || !endInput || !title || !error || !applyButton) return;

      dialog.dataset.activeRowIndex = String(Array.from(list.children).indexOf(row));
      startInput.value = startValue;
      endInput.value = endValue;
      endInput.min = startValue;
      startInput.max = endValue;
      title.textContent = cityValue || 'Select dates';
      error.hidden = true;
      applyButton.disabled = !startValue || !endValue || endValue < startValue;
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
      startInput.focus();
      return;
    }

    const cancelDateButton = target.closest<HTMLButtonElement>('[data-city-date-dialog-cancel]');
    if (cancelDateButton) {
      const dialog = cancelDateButton.closest<HTMLDialogElement>('[data-city-date-dialog]');
      if (dialog && typeof dialog.close === 'function') dialog.close();
      else dialog?.removeAttribute('open');
      return;
    }

    const applyDateButton = target.closest<HTMLButtonElement>('[data-city-date-dialog-apply]');
    if (applyDateButton) {
      const dialog = applyDateButton.closest<HTMLDialogElement>('[data-city-date-dialog]');
      const container = dialog?.closest<HTMLElement>('[data-city-dates-field]');
      const list = container?.querySelector<HTMLElement>('[data-city-date-list]');
      const rowIndex = Number(dialog?.dataset.activeRowIndex ?? -1);
      const row = list?.querySelectorAll<HTMLElement>('[data-city-date-row]')[rowIndex];
      const startInput = dialog?.querySelector<HTMLInputElement>('[data-city-date-modal-role="startDate"]');
      const endInput = dialog?.querySelector<HTMLInputElement>('[data-city-date-modal-role="endDate"]');
      const storedStart = row?.querySelector<HTMLInputElement>('[data-city-date-role="startDate"]');
      const storedEnd = row?.querySelector<HTMLInputElement>('[data-city-date-role="endDate"]');
      const summary = row?.querySelector<HTMLElement>('[data-city-date-summary]');
      if (!dialog || !row || !startInput || !endInput || !storedStart || !storedEnd || !summary) return;
      if (!startInput.value || !endInput.value || endInput.value < startInput.value) return;

      storedStart.value = startInput.value;
      storedEnd.value = endInput.value;
      summary.textContent = `${startInput.value} – ${endInput.value}`;
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
      updateFieldVisibility();
      return;
    }

    const addButton = target.closest<HTMLButtonElement>('[data-city-date-add]');
    if (addButton) {
      const container = addButton.closest<HTMLElement>('[data-city-dates-field]');
      const fieldName = container?.dataset.cityDatesField;
      const field = state.formDef?.fields.find((candidate) => candidate.name === fieldName);
      const list = container?.querySelector<HTMLElement>('[data-city-date-list]');
      if (!container || !field || !list) return;

      const rowCount = list.querySelectorAll('[data-city-date-row]').length;
      const maxItems = Number(container.dataset.maxItems || 12);
      if (rowCount >= maxItems) return;
      list.insertAdjacentHTML('beforeend', renderCityDateRow(field, rowCount));
      addButton.disabled = rowCount + 1 >= maxItems;
      list.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-city-date-role="city"]')[rowCount]?.focus();
      updateFieldVisibility();
      return;
    }

    const removeButton = target.closest<HTMLButtonElement>('[data-city-date-remove]');
    if (removeButton) {
      const container = removeButton.closest<HTMLElement>('[data-city-dates-field]');
      const list = container?.querySelector<HTMLElement>('[data-city-date-list]');
      const row = removeButton.closest<HTMLElement>('[data-city-date-row]');
      if (!container || !list || !row || list.children.length <= 1) return;
      row.remove();
      const addButtonForList = container.querySelector<HTMLButtonElement>('[data-city-date-add]');
      if (addButtonForList) addButtonForList.disabled = false;
      updateFieldVisibility();
    }
  });
}

// ========== Init ==========

export async function initForm(formId: string | null): Promise<void> {
  if (!formId) {
    renderFormError('フォームIDが指定されていません');
    return;
  }

  renderLoading();

  try {
    const params = new URLSearchParams(window.location.search);
    state.sharedByFriendId = params.get('sharedBy');
    state.slackChannelId = params.get('slackChannelId');
    state.successRedirectUrl = getSuccessRedirectUrl();

    // Fetch profile and form definition in parallel
    const [profile, res] = await Promise.all([
      liff.getProfile(),
      apiCall(`/api/forms/${formId}`),
    ]);

    state.profile = profile;

    // Try to get friendId from local storage (set by main UUID linking flow)
    try {
      state.friendId = localStorage.getItem(UUID_STORAGE_KEY);
    } catch {
      // silent
    }

    // Silent UUID linking (best-effort, so friend metadata saves correctly)
    const rawIdToken = liff.getIDToken();
    if (rawIdToken) {
      apiCall('/api/liff/link', {
        method: 'POST',
        body: JSON.stringify({
          idToken: rawIdToken,
          displayName: profile.displayName,
          existingUuid: state.friendId,
        }),
      }).then(async (linkRes) => {
        if (linkRes.ok) {
          const data = await linkRes.json() as { success: boolean; data?: { userId?: string } };
          if (data?.data?.userId) {
            try {
              localStorage.setItem(UUID_STORAGE_KEY, data.data.userId);
              state.friendId = data.data.userId;
            } catch { /* silent */ }
          }
        }
      }).catch(() => { /* silent */ });
    }

    if (!res.ok) {
      if (res.status === 404) {
        renderFormError('フォームが見つかりません');
      } else {
        renderFormError('フォームの読み込みに失敗しました');
      }
      return;
    }

    const json = await res.json() as { success: boolean; data?: FormDef };
    if (!json.success || !json.data) {
      renderFormError('フォームの読み込みに失敗しました');
      return;
    }

    if (!json.data.isActive) {
      renderFormError('このフォームは現在受付を停止しています');
      return;
    }

    state.formDef = json.data;
    render();
  } catch (err) {
    renderFormError(err instanceof Error ? err.message : 'エラーが発生しました');
  }
}
