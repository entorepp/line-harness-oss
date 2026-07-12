import type { LineAccount } from '@line-crm/db';
import type { Env } from '../index.js';

const KAKAO_API_BASE = 'https://kapi.kakao.com';

export type KakaoCustomerFileStatus = {
  empty_slot?: number;
  using_slot?: number;
  results?: Array<{
    file_id?: number;
    file_name?: string;
    status?: string;
    update_at?: string;
    schema?: string;
  }>;
};

export type KakaoStatus = {
  channelPublicId: string;
  customerFilesAvailable: boolean;
  emptySlot: number | null;
  usingSlot: number | null;
  files: NonNullable<KakaoCustomerFileStatus['results']>;
};

function buildKakaoAuthHeader(rawCredential: string): string {
  const trimmed = rawCredential.trim();
  if (!trimmed) {
    throw new Error('Kakao API key is not configured');
  }
  return trimmed.startsWith('KakaoAK ') ? trimmed : `KakaoAK ${trimmed}`;
}

async function kakaoRequest<T>(
  account: Pick<LineAccount, 'channel_access_token'>,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Authorization', buildKakaoAuthHeader(account.channel_access_token));

  const res = await fetch(`${KAKAO_API_BASE}${path}`, {
    ...init,
    headers,
  });

  const contentType = res.headers.get('content-type') || '';
  const body = contentType.includes('application/json')
    ? await res.json().catch(() => null)
    : await res.text().catch(() => '');

  if (!res.ok) {
    const detail =
      typeof body === 'string'
        ? body
        : body && typeof body === 'object'
          ? JSON.stringify(body)
          : '';
    throw new Error(`Kakao API error: ${res.status} ${detail}`);
  }

  return body as T;
}

export async function fetchKakaoStatus(account: LineAccount): Promise<KakaoStatus> {
  const params = new URLSearchParams({ channel_public_id: account.channel_id });
  const data = await kakaoRequest<KakaoCustomerFileStatus>(
    account,
    `/v1/talkchannel/target_user_file?${params.toString()}`,
    { method: 'GET' },
  );

  return {
    channelPublicId: account.channel_id,
    customerFilesAvailable: true,
    emptySlot: typeof data.empty_slot === 'number' ? data.empty_slot : null,
    usingSlot: typeof data.using_slot === 'number' ? data.using_slot : null,
    files: Array.isArray(data.results) ? data.results : [],
  };
}

export async function dispatchKakaoBizMessage(opts: {
  env: Env['Bindings'];
  account: Pick<LineAccount, 'id' | 'channel_id'>;
  to: string;
  text: string;
}): Promise<void> {
  const endpoint = opts.env.KAKAO_BIZMESSAGE_ENDPOINT?.trim();
  const apiKey = opts.env.KAKAO_BIZMESSAGE_API_KEY?.trim();
  if (!endpoint || !apiKey) {
    throw new Error(
      'Kakao outbound send is not configured. Set KAKAO_BIZMESSAGE_ENDPOINT and KAKAO_BIZMESSAGE_API_KEY after Kakao Business/Bizmessage access is approved.',
    );
  }

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: apiKey.startsWith('Bearer ') ? apiKey : `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      channelPublicId: opts.account.channel_id,
      accountId: opts.account.id,
      to: opts.to,
      type: 'text',
      text: opts.text,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Kakao outbound send failed: ${res.status} ${text}`);
  }
}
