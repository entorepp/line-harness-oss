import type { LineAccount } from '@line-crm/db';

const GRAPH_API = 'https://graph.facebook.com/v25.0';
const MAX_TEMPLATE_PAGES = 4;
const MAX_TEMPLATE_PARAMETERS = 32;
const MAX_PARAMETER_LENGTH = 1024;

type TemplateComponentType = 'HEADER' | 'BODY' | 'FOOTER' | 'BUTTONS';

type RawTemplateButton = {
  type?: string;
  text?: string;
  url?: string;
};

type RawTemplateComponent = {
  type?: TemplateComponentType | string;
  format?: string;
  text?: string;
  buttons?: RawTemplateButton[];
};

type RawWhatsAppTemplate = {
  id?: string;
  name?: string;
  status?: string;
  category?: string;
  language?: string;
  parameter_format?: string;
  components?: RawTemplateComponent[];
};

type MetaTemplateListResponse = {
  data?: RawWhatsAppTemplate[];
  paging?: { next?: string };
  error?: { message?: string; code?: number; error_subcode?: number };
};

export type WhatsAppTemplateParameter = {
  key: string;
  component: 'header' | 'body';
  index: number;
  name: string | null;
  label: string;
};

export type WhatsAppInitiationTemplate = {
  id: string;
  name: string;
  language: string;
  status: string;
  category: string;
  parameterFormat: 'POSITIONAL' | 'NAMED';
  headerText: string | null;
  bodyText: string;
  footerText: string | null;
  buttonLabels: string[];
  parameters: WhatsAppTemplateParameter[];
  supportedForInitiation: boolean;
  unsupportedReason: string | null;
};

export type WhatsAppTemplateValues = Record<string, string>;

export class MetaWhatsAppHttpError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'MetaWhatsAppHttpError';
    this.code = code;
  }
}

export class MetaWhatsAppUnknownOutcomeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MetaWhatsAppUnknownOutcomeError';
  }
}

function safeMetaError(
  data: { error?: { message?: string; code?: number; error_subcode?: number } } | null,
  fallback: string,
): { message: string; code: string } {
  const message = data?.error?.message?.trim() || fallback;
  const codeParts = [data?.error?.code, data?.error?.error_subcode]
    .filter((value): value is number => typeof value === 'number');
  return {
    message: message.slice(0, 500),
    code: codeParts.length > 0 ? codeParts.join(':') : 'META_HTTP_ERROR',
  };
}

function validateNextPageUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'graph.facebook.com') return null;
    return url;
  } catch {
    return null;
  }
}

function uniqueMatches(text: string, pattern: RegExp): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(pattern)) {
    const value = match[1];
    if (value && !found.includes(value)) found.push(value);
  }
  return found;
}

function templateParameters(
  component: 'header' | 'body',
  text: string,
  parameterFormat: 'POSITIONAL' | 'NAMED',
): WhatsAppTemplateParameter[] {
  if (parameterFormat === 'NAMED') {
    return uniqueMatches(text, /{{\s*([A-Za-z][A-Za-z0-9_]*)\s*}}/g).map((name, offset) => ({
      key: `${component}:${name}`,
      component,
      index: offset + 1,
      name,
      label: `${component === 'header' ? '見出し' : '本文'} {{${name}}}`,
    }));
  }

  return uniqueMatches(text, /{{\s*(\d+)\s*}}/g)
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((left, right) => left - right)
    .map((index) => ({
      key: `${component}:${index}`,
      component,
      index,
      name: null,
      label: `${component === 'header' ? '見出し' : '本文'} {{${index}}}`,
    }));
}

export function normalizeWhatsAppTemplate(raw: RawWhatsAppTemplate): WhatsAppInitiationTemplate | null {
  const name = raw.name?.trim();
  const language = raw.language?.trim();
  if (!name || !language) return null;

  const parameterFormat = raw.parameter_format?.toUpperCase() === 'NAMED'
    ? 'NAMED'
    : 'POSITIONAL';
  const components = Array.isArray(raw.components) ? raw.components : [];
  const header = components.find((component) => component.type?.toUpperCase() === 'HEADER');
  const body = components.find((component) => component.type?.toUpperCase() === 'BODY');
  const footer = components.find((component) => component.type?.toUpperCase() === 'FOOTER');
  const buttons = components.find((component) => component.type?.toUpperCase() === 'BUTTONS');
  const headerText = header?.text?.trim() || null;
  const bodyText = body?.text?.trim() || '';
  const footerText = footer?.text?.trim() || null;
  const parameters = [
    ...(headerText ? templateParameters('header', headerText, parameterFormat) : []),
    ...templateParameters('body', bodyText, parameterFormat),
  ];

  let unsupportedReason: string | null = null;
  const headerFormat = header?.format?.toUpperCase();
  if (header && headerFormat && headerFormat !== 'TEXT') {
    unsupportedReason = '画像・動画・文書ヘッダー付きテンプレートは初回連絡v1では使用できません';
  } else if (!bodyText) {
    unsupportedReason = '本文がないテンプレートは使用できません';
  } else if (parameters.length > MAX_TEMPLATE_PARAMETERS) {
    unsupportedReason = `変数は${MAX_TEMPLATE_PARAMETERS}件までです`;
  } else if (buttons?.buttons?.some((button) => (
    button.type?.toUpperCase() === 'URL' && /{{\s*[^}]+\s*}}/.test(button.url || '')
  ))) {
    unsupportedReason = '動的URLボタン付きテンプレートは初回連絡v1では使用できません';
  }

  return {
    id: raw.id?.trim() || `${name}:${language}`,
    name,
    language,
    status: raw.status?.trim().toUpperCase() || 'UNKNOWN',
    category: raw.category?.trim().toUpperCase() || 'UNKNOWN',
    parameterFormat,
    headerText,
    bodyText,
    footerText,
    buttonLabels: (buttons?.buttons || [])
      .map((button) => button.text?.trim() || '')
      .filter(Boolean),
    parameters,
    supportedForInitiation: unsupportedReason === null,
    unsupportedReason,
  };
}

export async function fetchApprovedWhatsAppTemplates(account: LineAccount): Promise<WhatsAppInitiationTemplate[]> {
  const wabaId = account.whatsapp_business_account_id?.trim();
  if (!wabaId || !/^\d{5,30}$/.test(wabaId)) {
    throw new Error('WhatsApp Business Account ID is not configured');
  }

  const firstUrl = new URL(`${GRAPH_API}/${wabaId}/message_templates`);
  firstUrl.searchParams.set(
    'fields',
    'id,name,status,category,language,parameter_format,components',
  );
  firstUrl.searchParams.set('status', 'APPROVED');
  firstUrl.searchParams.set('limit', '100');

  const rawTemplates: RawWhatsAppTemplate[] = [];
  let nextUrl: URL | null = firstUrl;
  for (let page = 0; page < MAX_TEMPLATE_PAGES && nextUrl; page += 1) {
    let response: Response;
    try {
      response = await fetch(nextUrl, {
        headers: { Authorization: `Bearer ${account.channel_access_token}` },
      });
    } catch (error) {
      throw new Error(
        `Meta template lookup failed: ${error instanceof Error ? error.message : 'network error'}`,
      );
    }

    const data = await response.json().catch(() => null) as MetaTemplateListResponse | null;
    if (!response.ok) {
      const safe = safeMetaError(data, 'Failed to fetch approved WhatsApp templates');
      throw new Error(`${safe.message} (${safe.code})`);
    }
    rawTemplates.push(...(data?.data || []));
    nextUrl = data?.paging?.next ? validateNextPageUrl(data.paging.next) : null;
  }

  return rawTemplates
    .filter((template) => template.status?.toUpperCase() === 'APPROVED')
    .map(normalizeWhatsAppTemplate)
    .filter((template): template is WhatsAppInitiationTemplate => template !== null)
    .sort((left, right) => (
      left.name.localeCompare(right.name) || left.language.localeCompare(right.language)
    ));
}

export function validateTemplateValues(
  template: WhatsAppInitiationTemplate,
  values: WhatsAppTemplateValues,
): WhatsAppTemplateValues {
  if (!template.supportedForInitiation) {
    throw new Error(template.unsupportedReason || 'This template is not supported for initiation');
  }

  const expectedKeys = new Set(template.parameters.map((parameter) => parameter.key));
  const providedKeys = Object.keys(values);
  if (providedKeys.length > MAX_TEMPLATE_PARAMETERS) {
    throw new Error(`Template parameters are limited to ${MAX_TEMPLATE_PARAMETERS}`);
  }
  const unknownKey = providedKeys.find((key) => !expectedKeys.has(key));
  if (unknownKey) throw new Error(`Unexpected template parameter: ${unknownKey}`);

  const normalized: WhatsAppTemplateValues = {};
  for (const parameter of template.parameters) {
    const value = values[parameter.key]?.trim();
    if (!value) throw new Error(`${parameter.label} is required`);
    if (value.length > MAX_PARAMETER_LENGTH) {
      throw new Error(`${parameter.label} must be ${MAX_PARAMETER_LENGTH} characters or fewer`);
    }
    normalized[parameter.key] = value;
  }
  return normalized;
}

function providerParameters(
  template: WhatsAppInitiationTemplate,
  component: 'header' | 'body',
  values: WhatsAppTemplateValues,
): Array<Record<string, string>> {
  return template.parameters
    .filter((parameter) => parameter.component === component)
    .map((parameter) => ({
      type: 'text',
      text: values[parameter.key],
      ...(parameter.name ? { parameter_name: parameter.name } : {}),
    }));
}

export function buildWhatsAppTemplatePayload(
  recipientPhone: string,
  template: WhatsAppInitiationTemplate,
  values: WhatsAppTemplateValues,
): Record<string, unknown> {
  const normalized = validateTemplateValues(template, values);
  const components = (['header', 'body'] as const)
    .map((component) => ({
      type: component,
      parameters: providerParameters(template, component, normalized),
    }))
    .filter((component) => component.parameters.length > 0);

  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: recipientPhone,
    type: 'template',
    template: {
      name: template.name,
      language: { code: template.language },
      ...(components.length > 0 ? { components } : {}),
    },
  };
}

function replaceTemplateValues(
  text: string,
  component: 'header' | 'body',
  template: WhatsAppInitiationTemplate,
  values: WhatsAppTemplateValues,
): string {
  let output = text;
  for (const parameter of template.parameters.filter((item) => item.component === component)) {
    const placeholder = parameter.name || String(parameter.index);
    output = output.replace(
      new RegExp(`{{\\s*${placeholder.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\s*}}`, 'g'),
      values[parameter.key],
    );
  }
  return output;
}

export function renderWhatsAppTemplatePreview(
  template: WhatsAppInitiationTemplate,
  values: WhatsAppTemplateValues,
): string {
  const normalized = validateTemplateValues(template, values);
  return [
    template.headerText
      ? replaceTemplateValues(template.headerText, 'header', template, normalized)
      : null,
    replaceTemplateValues(template.bodyText, 'body', template, normalized),
    template.footerText,
    template.buttonLabels.length > 0 ? template.buttonLabels.map((label) => `[${label}]`).join(' ') : null,
  ].filter(Boolean).join('\n\n');
}

export function normalizeE164Phone(value: string): string {
  const normalized = value.trim().replace(/[\s().-]/g, '');
  const match = normalized.match(/^\+([1-9]\d{7,14})$/);
  if (!match) {
    throw new Error('電話番号は + と国番号を含むE.164形式で入力してください（例: +817012345678）');
  }
  return match[1];
}

export async function sendWhatsAppInitiationTemplate(opts: {
  account: LineAccount;
  recipientPhone: string;
  template: WhatsAppInitiationTemplate;
  values: WhatsAppTemplateValues;
}): Promise<{ providerMessageId: string; waId: string | null }> {
  const payload = buildWhatsAppTemplatePayload(
    opts.recipientPhone,
    opts.template,
    opts.values,
  );
  let response: Response;
  try {
    response = await fetch(`${GRAPH_API}/${opts.account.channel_id}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${opts.account.channel_access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    throw new MetaWhatsAppUnknownOutcomeError(
      `Metaへの送信結果を確認できませんでした: ${error instanceof Error ? error.message : 'network error'}`,
    );
  }

  const data = await response.json().catch(() => null) as {
    messages?: Array<{ id?: string }>;
    contacts?: Array<{ wa_id?: string }>;
    error?: { message?: string; code?: number; error_subcode?: number };
  } | null;
  if (!response.ok) {
    const safe = safeMetaError(data, 'WhatsApp template send failed');
    throw new MetaWhatsAppHttpError(safe.message, safe.code);
  }

  const providerMessageId = data?.messages?.[0]?.id?.trim();
  if (!providerMessageId) {
    throw new MetaWhatsAppUnknownOutcomeError(
      'Metaは成功応答を返しましたがメッセージIDがなく、送信結果を確定できませんでした',
    );
  }
  return {
    providerMessageId,
    waId: data?.contacts?.[0]?.wa_id?.trim() || null,
  };
}
