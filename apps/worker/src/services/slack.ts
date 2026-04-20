/**
 * Slack notification service
 *
 * Sends messages to Slack channels linked to LINE friends.
 * Used for both incoming LINE messages and outgoing operator messages.
 */

type SupportedLocale = 'ja' | 'zh-TW';

export interface SlackFormAnswer {
  label: string;
  value: string;
}

interface LocaleCopy {
  incomingLabel: string;
  outgoingLabel: string;
  translationLabel: string;
  formSubmittedLabel: string;
  formLabel: string;
  accountLabel: string;
  submittedAtLabel: string;
  noAnswersLabel: string;
}

const DEFAULT_NOTIFICATION_CHANNEL = 'C0AL6RG7V9Q';

const LOCALE_COPY: Record<SupportedLocale, LocaleCopy> = {
  ja: {
    incomingLabel: 'からのメッセージ',
    outgoingLabel: '担当者',
    translationLabel: '和訳',
    formSubmittedLabel: 'フォーム回答',
    formLabel: 'フォーム',
    accountLabel: 'アカウント',
    submittedAtLabel: '回答日時',
    noAnswersLabel: '回答内容はありません',
  },
  'zh-TW': {
    incomingLabel: '傳送的訊息',
    outgoingLabel: '客服',
    translationLabel: '翻譯',
    formSubmittedLabel: '表單回覆',
    formLabel: '表單',
    accountLabel: '帳號',
    submittedAtLabel: '回覆時間',
    noAnswersLabel: '沒有回覆內容',
  },
};

function normalizeLocale(locale?: string | null): SupportedLocale {
  return locale === 'zh-TW' ? 'zh-TW' : 'ja';
}

function getLocaleCopy(locale?: string | null): LocaleCopy {
  return LOCALE_COPY[normalizeLocale(locale)];
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function hasJapaneseKana(text: string): boolean {
  return /[\u3040-\u30FF]/.test(text);
}

function isMostlyHan(text: string): boolean {
  const cleaned = text.replace(/\s+/g, '');
  if (cleaned.length === 0) return true;
  const hanChars = cleaned.match(/[\u3400-\u4DBF\u4E00-\u9FFF]/g);
  const ratio = (hanChars?.length ?? 0) / cleaned.length;
  return ratio > 0.5;
}

/**
 * Detect if text is primarily Japanese (hiragana, katakana, kanji).
 * Returns true if >50% of non-whitespace characters are Japanese.
 */
function isJapanese(text: string): boolean {
  const cleaned = text.replace(/\s+/g, '');
  if (cleaned.length === 0) return true;
  // Match hiragana, katakana, CJK unified ideographs, and CJK punctuation
  const japaneseChars = cleaned.match(/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\u3000-\u303F\uFF00-\uFFEF]/g);
  const ratio = (japaneseChars?.length ?? 0) / cleaned.length;
  return ratio > 0.5;
}

/**
 * Translate texts using Google Cloud Translation API.
 */
async function translateTexts(
  texts: string[],
  apiKey: string,
  target: SupportedLocale,
): Promise<Array<string | null>> {
  if (texts.length === 0) return [];

  try {
    const res = await fetch(
      `https://translation.googleapis.com/language/translate/v2?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: texts, target, format: 'text' }),
      },
    );
    const data = await res.json() as {
      data?: { translations?: Array<{ translatedText: string }> };
    };
    const translated = data.data?.translations ?? [];
    return texts.map((_, index) => {
      const value = translated[index]?.translatedText;
      return value ? decodeHtmlEntities(value) : null;
    });
  } catch (err) {
    console.error('Google Translate API error:', err);
    return texts.map(() => null);
  }
}

async function translateText(
  text: string,
  apiKey: string,
  target: SupportedLocale,
): Promise<string | null> {
  const [translated] = await translateTexts([text], apiKey, target);
  return translated ?? null;
}

function shouldTranslate(text: string, target: SupportedLocale): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;

  if (target === 'ja') {
    return !isJapanese(trimmed);
  }

  return hasJapaneseKana(trimmed) || !isMostlyHan(trimmed);
}

function quoteForSlack(text: string): string {
  return text
    .split('\n')
    .map((line) => `>${line}`)
    .join('\n');
}

function trimSlackText(text: string, maxLength = 1200): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

function chunkMrkdwnLines(lines: string[], maxLength = 2800): string[] {
  const chunks: string[] = [];
  let current = '';

  for (const line of lines) {
    const next = current ? `${current}\n\n${line}` : line;
    if (next.length > maxLength && current) {
      chunks.push(current);
      current = line;
    } else {
      current = next;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

export function resolveSlackChannelId(
  primaryChannel?: string | null,
  fallbackChannel?: string | null,
): string {
  const primary = primaryChannel?.trim();
  if (primary) return primary;

  const fallback = fallbackChannel?.trim();
  if (fallback) return fallback;

  return DEFAULT_NOTIFICATION_CHANNEL;
}

interface SlackPostOptions {
  token: string;
  channel: string;
  text: string;
  username?: string;
  iconUrl?: string;
  blocks?: unknown[];
}

export async function postToSlack(opts: SlackPostOptions): Promise<boolean> {
  try {
    const body: Record<string, unknown> = {
      channel: opts.channel,
      text: opts.text,
      unfurl_links: false,
    };
    if (opts.username) body.username = opts.username;
    if (opts.iconUrl) body.icon_url = opts.iconUrl;
    if (opts.blocks) body.blocks = opts.blocks;

    const res = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${opts.token}`,
      },
      body: JSON.stringify(body),
    });

    const data = await res.json() as { ok: boolean; error?: string };
    if (!data.ok) {
      console.error('Slack API error:', data.error);
      return false;
    }
    return true;
  } catch (err) {
    console.error('Slack post error:', err);
    return false;
  }
}

/**
 * Notify Slack when a LINE message is received from a customer
 */
export async function notifySlackIncoming(opts: {
  slackToken: string;
  slackChannelId: string;
  friendName: string;
  friendPictureUrl?: string | null;
  messageText: string;
  messageType: string;
  accountName?: string;
  locale?: string | null;
  googleTranslateApiKey?: string;
  mediaUrl?: string;
  fileName?: string;
}): Promise<void> {
  const locale = normalizeLocale(opts.locale);
  const copy = getLocaleCopy(locale);
  const accountLabel = opts.accountName ? ` (${opts.accountName})` : '';
  const contentPreview = opts.messageType === 'text'
    ? opts.messageText
    : opts.messageText; // Already formatted (e.g. "📷 画像を送信")

  // Translate non-Japanese text messages
  let translationLine = '';
  if (opts.messageType === 'text' && opts.googleTranslateApiKey && shouldTranslate(opts.messageText, locale)) {
    const translated = await translateText(opts.messageText, opts.googleTranslateApiKey, locale);
    if (translated) {
      translationLine = `\n*${copy.translationLabel}:* ${translated}`;
    }
  }

  // Build blocks
  const blocks: unknown[] = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${opts.friendName}*${accountLabel} ${copy.incomingLabel}:\n>${contentPreview}${translationLine}`,
      },
      ...(opts.friendPictureUrl ? {
        accessory: {
          type: 'image',
          image_url: opts.friendPictureUrl,
          alt_text: opts.friendName,
        },
      } : {}),
    },
  ];

  // Add image block for image messages
  if (opts.mediaUrl && opts.messageType === 'image') {
    blocks.push({
      type: 'image',
      image_url: opts.mediaUrl,
      alt_text: `${opts.friendName} が送信した画像`,
    });
  }

  // Add file link for file/video/audio messages
  if (opts.mediaUrl && opts.messageType !== 'image') {
    const label = opts.fileName || opts.messageType;
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `<${opts.mediaUrl}|${label} を開く>`,
      },
    });
  }

  await postToSlack({
    token: opts.slackToken,
    channel: opts.slackChannelId,
    text: `💬 ${opts.friendName}${accountLabel}: ${contentPreview}${translationLine}`,
    username: opts.friendName,
    iconUrl: opts.friendPictureUrl || undefined,
    blocks,
  });
}

/**
 * Notify Slack when an operator sends a message to a customer
 */
export async function notifySlackOutgoing(opts: {
  slackToken: string;
  slackChannelId: string;
  friendName: string;
  messageText: string;
  accountName?: string;
  locale?: string | null;
}): Promise<void> {
  const copy = getLocaleCopy(opts.locale);
  const accountLabel = opts.accountName ? ` (${opts.accountName})` : '';

  await postToSlack({
    token: opts.slackToken,
    channel: opts.slackChannelId,
    text: `📤 ${copy.outgoingLabel} → ${opts.friendName}${accountLabel}: ${opts.messageText}`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${copy.outgoingLabel}* → *${opts.friendName}*${accountLabel}:\n>${opts.messageText}`,
        },
      },
    ],
  });
}

export async function notifySlackFormSubmission(opts: {
  slackToken: string;
  slackChannelId: string;
  friendName: string;
  friendPictureUrl?: string | null;
  formName: string;
  answers: SlackFormAnswer[];
  accountName?: string;
  locale?: string | null;
  submittedAt?: string;
  googleTranslateApiKey?: string;
}): Promise<void> {
  const locale = normalizeLocale(opts.locale);
  const copy = getLocaleCopy(locale);
  const accountLabel = opts.accountName ? ` (${opts.accountName})` : '';

  const translationIndexes = opts.answers
    .map((answer, index) => ({
      index,
      value: trimSlackText(answer.value),
    }))
    .filter((item) => opts.googleTranslateApiKey && shouldTranslate(item.value, locale));

  const translatedValues = opts.googleTranslateApiKey && translationIndexes.length > 0
    ? await translateTexts(
      translationIndexes.map((item) => item.value),
      opts.googleTranslateApiKey,
      locale,
    )
    : [];

  const translatedByIndex = new Map<number, string>();
  translationIndexes.forEach((item, index) => {
    const translated = translatedValues[index];
    if (translated && translated !== item.value) {
      translatedByIndex.set(item.index, trimSlackText(translated));
    }
  });

  const answerLines = opts.answers.length > 0
    ? opts.answers.map((answer, index) => {
      const base = `*${answer.label}*\n${quoteForSlack(trimSlackText(answer.value))}`;
      const translated = translatedByIndex.get(index);
      return translated
        ? `${base}\n_${copy.translationLabel}: ${translated}_`
        : base;
    })
    : [`_${copy.noAnswersLabel}_`];

  const blocks: unknown[] = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${opts.friendName}*${accountLabel} ${copy.formSubmittedLabel}`,
      },
      ...(opts.friendPictureUrl ? {
        accessory: {
          type: 'image',
          image_url: opts.friendPictureUrl,
          alt_text: opts.friendName,
        },
      } : {}),
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: [
          `*${copy.formLabel}:* ${opts.formName}`,
          opts.accountName ? `*${copy.accountLabel}:* ${opts.accountName}` : null,
          opts.submittedAt ? `*${copy.submittedAtLabel}:* ${opts.submittedAt}` : null,
        ].filter(Boolean).join('\n'),
      },
    },
    { type: 'divider' },
    ...chunkMrkdwnLines(answerLines).map((text) => ({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text,
      },
    })),
  ];

  await postToSlack({
    token: opts.slackToken,
    channel: opts.slackChannelId,
    text: `📝 ${opts.friendName}${accountLabel} ${copy.formSubmittedLabel}: ${opts.formName}`,
    username: opts.friendName,
    iconUrl: opts.friendPictureUrl || undefined,
    blocks,
  });
}
