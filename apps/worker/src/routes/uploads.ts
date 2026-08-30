import { Hono } from 'hono';
import type { Env } from '../index.js';
import {
  getLineContentSigningSecret,
  normalizeLineContentFileName,
  normalizeLineContentType,
  verifyLineContentProxySignature,
} from '../services/line-content-proxy.js';
import {
  createFormFileAccessUrl,
  formFileExpiresAt,
  FORM_PRIVATE_FILE_RETENTION_SECONDS,
  FORM_PRIVATE_UPLOAD_ACCESS,
  verifyFormFileAccess,
} from '../services/form-file-access.js';

const IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/heic',
  'image/heif',
];
const FORM_PRIVATE_FILE_MAX_BYTES = 10 * 1024 * 1024;

type StoredUploadMetadata = {
  contentType: string;
  originalName?: string;
  size?: number;
  access?: string;
  formId?: string;
  fieldName?: string;
};

type FormUploadField = {
  name?: unknown;
  type?: unknown;
  accept?: unknown;
};

function inferContentTypeFromKey(key: string, fallback: string): string {
  if (fallback !== 'application/octet-stream') return fallback;

  const ext = key.split('.').pop()?.toLowerCase() || '';
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'mp4') return 'video/mp4';
  if (ext === '3gp') return 'video/3gpp';
  if (ext === 'aac') return 'audio/aac';
  if (ext === 'amr') return 'audio/amr';
  if (ext === 'mp3') return 'audio/mpeg';
  if (ext === 'm4a') return 'audio/mp4';
  if (ext === 'ogg') return 'audio/ogg';
  if (ext === 'wav') return 'audio/wav';
  if (ext === 'txt') return 'text/plain';
  if (ext === 'doc') return 'application/msword';
  if (ext === 'docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (ext === 'xls') return 'application/vnd.ms-excel';
  if (ext === 'xlsx') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (ext === 'ppt') return 'application/vnd.ms-powerpoint';
  if (ext === 'pptx') return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  return fallback;
}

function getExtension(fileName: string, mimeType: string): string {
  // Try from filename first
  const dotIdx = fileName.lastIndexOf('.');
  if (dotIdx !== -1) return fileName.slice(dotIdx + 1).toLowerCase();
  // Fallback from mime
  const sub = mimeType.split('/')[1];
  if (sub === 'jpeg') return 'jpg';
  if (sub === 'vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx';
  if (sub === 'vnd.openxmlformats-officedocument.presentationml.presentation') return 'pptx';
  if (sub === 'vnd.openxmlformats-officedocument.spreadsheetml.sheet') return 'xlsx';
  if (sub === 'msword') return 'doc';
  if (sub === 'vnd.ms-powerpoint') return 'ppt';
  if (sub === 'vnd.ms-excel') return 'xls';
  return sub || 'bin';
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function getFileIcon(ext: string): string {
  if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) return '\u{1F5BC}';
  if (ext === 'pdf') return '\u{1F4C4}';
  if (['doc', 'docx'].includes(ext)) return '\u{1F4DD}';
  if (['ppt', 'pptx'].includes(ext)) return '\u{1F4CA}';
  if (['xls', 'xlsx', 'csv'].includes(ext)) return '\u{1F4CA}';
  if (['mp4', 'mov', 'avi'].includes(ext)) return '\u{1F3AC}';
  if (['mp3', 'wav', 'm4a'].includes(ext)) return '\u{1F3B5}';
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return '\u{1F4E6}';
  return '\u{1F4CE}';
}

function buildContentDisposition(disposition: 'inline' | 'attachment', fileName: string): string {
  const fallback = fileName.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_') || 'file';
  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

const uploads = new Hono<Env>();

// POST /api/upload — upload a file to KV. Form-private uploads receive a
// signed, expiring URL; existing message uploads retain their public URL.
uploads.post('/api/upload', async (c) => {
  try {
    const formData = await c.req.formData();
    const entry = formData.get('file');
    if (!entry || typeof entry === 'string') {
      return c.json({ success: false, error: 'file is required' }, 400);
    }
    const file = entry as File;

    const requestedAccess = String(formData.get('access') || '').trim();
    if (requestedAccess && requestedAccess !== FORM_PRIVATE_UPLOAD_ACCESS) {
      return c.json({ success: false, error: 'Unsupported upload access mode' }, 400);
    }

    const privateFormUpload = requestedAccess === FORM_PRIVATE_UPLOAD_ACCESS;
    const formId = String(formData.get('formId') || '').trim();
    const fieldName = String(formData.get('fieldName') || '').trim();
    if (privateFormUpload) {
      if (!formId) {
        return c.json({ success: false, error: 'formId is required' }, 400);
      }
      if (!fieldName || !/^[a-z0-9_]{1,64}$/.test(fieldName)) {
        return c.json({ success: false, error: 'Invalid fieldName' }, 400);
      }
      const form = await c.env.DB
        .prepare('SELECT id, is_active, fields FROM forms WHERE id = ?')
        .bind(formId)
        .first<{ id: string; is_active: number; fields: string }>();
      if (!form || !form.is_active) {
        return c.json({ success: false, error: 'Active form not found' }, 404);
      }
      let uploadField: FormUploadField | undefined;
      try {
        const fields = JSON.parse(form.fields) as FormUploadField[];
        uploadField = fields.find((candidate) => (
          candidate?.name === fieldName && candidate?.type === 'file'
        ));
      } catch (_error) {
        return c.json({ success: false, error: 'Invalid form field definition' }, 500);
      }
      if (!uploadField) {
        return c.json({ success: false, error: 'Form file field not found' }, 404);
      }
      const acceptedTypes = String(uploadField.accept || '')
        .split(',')
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean);
      if (acceptedTypes.length && !acceptedTypes.includes(file.type.toLowerCase())) {
        return c.json({ success: false, error: 'File type is not allowed for this field' }, 400);
      }
    }

    // KV value limit is 25MB
    const maxBytes = privateFormUpload ? FORM_PRIVATE_FILE_MAX_BYTES : 25 * 1024 * 1024;
    if (file.size > maxBytes) {
      const maxMegabytes = maxBytes / (1024 * 1024);
      return c.json({ success: false, error: `File too large (max ${maxMegabytes}MB)` }, 400);
    }

    const id = crypto.randomUUID();
    const ext = getExtension(file.name, file.type);
    const key = `${id}.${ext}`;
    const isImage = IMAGE_TYPES.includes(file.type);

    const arrayBuffer = await file.arrayBuffer();
    await c.env.UPLOADS.put(key, arrayBuffer, {
      ...(privateFormUpload ? { expirationTtl: FORM_PRIVATE_FILE_RETENTION_SECONDS } : {}),
      metadata: {
        contentType: file.type,
        originalName: file.name,
        size: file.size,
        ...(privateFormUpload
          ? {
            access: FORM_PRIVATE_UPLOAD_ACCESS,
            formId,
            fieldName,
          }
          : {}),
      },
    });

    const workerUrl = c.env.WORKER_URL || `https://${c.req.header('host')}`;
    const expiresAt = privateFormUpload ? formFileExpiresAt() : undefined;
    const url = privateFormUpload
      ? await createFormFileAccessUrl({
        workerUrl,
        key,
        expiresAt: expiresAt!,
        secret: getLineContentSigningSecret(c.env.API_KEY, c.env.LINE_CHANNEL_SECRET),
      })
      : `${workerUrl}/api/files/${key}`;

    return c.json({
      success: true,
      data: {
        url,
        key,
        fileName: file.name,
        fileSize: file.size,
        fileSizeFormatted: formatFileSize(file.size),
        isImage,
        ext,
        icon: getFileIcon(ext),
        access: privateFormUpload ? FORM_PRIVATE_UPLOAD_ACCESS : 'public',
        expiresAt: expiresAt ? new Date(expiresAt * 1000).toISOString() : null,
      },
    });
  } catch (err) {
    console.error('POST /api/upload error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/form-files/:key — serve a form attachment only through its
// signed, expiring capability URL. Responses are never cached.
uploads.get('/api/form-files/:key', async (c) => {
  const key = c.req.param('key');
  const expiresAt = Number(c.req.query('expires'));
  const signature = c.req.query('sig') || '';
  const signingSecret = getLineContentSigningSecret(c.env.API_KEY, c.env.LINE_CHANNEL_SECRET);
  const valid = await verifyFormFileAccess({
    key,
    expiresAt,
    signature,
    secret: signingSecret,
  });
  if (!valid) {
    return c.json({ error: 'Invalid or expired file URL' }, 403);
  }

  const { value, metadata } = await c.env.UPLOADS.getWithMetadata<StoredUploadMetadata>(
    key,
    'arrayBuffer',
  );
  if (!value || metadata?.access !== FORM_PRIVATE_UPLOAD_ACCESS) {
    return c.json({ error: 'Not found' }, 404);
  }

  const contentType = inferContentTypeFromKey(
    key,
    metadata.contentType || 'application/octet-stream',
  );
  const inlineTypes = [...IMAGE_TYPES, 'application/pdf'];
  const disposition = inlineTypes.includes(contentType) ? 'inline' : 'attachment';
  const headers = new Headers({
    'Content-Type': contentType,
    'Cache-Control': 'private, no-store, max-age=0',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  });
  if (metadata.originalName) {
    headers.set('Content-Disposition', buildContentDisposition(disposition, metadata.originalName));
  }
  return new Response(value as ArrayBuffer, { headers });
});

// GET /api/files/line/:accountId/:messageId — proxy LINE-hosted content with a signed URL.
// This keeps large inbound files downloadable when they exceed Cloudflare KV's per-value limit.
uploads.get('/api/files/line/:accountId/:messageId', async (c) => {
  const accountId = c.req.param('accountId');
  const messageId = c.req.param('messageId');
  const fileName = normalizeLineContentFileName(c.req.query('name'));
  const contentType = normalizeLineContentType(c.req.query('type'));
  const signature = c.req.query('sig') || '';

  if (!accountId || !messageId || !signature) {
    return c.json({ error: 'Invalid file URL' }, 400);
  }

  const signingSecret = getLineContentSigningSecret(c.env.API_KEY, c.env.LINE_CHANNEL_SECRET);
  const valid = await verifyLineContentProxySignature({
    secret: signingSecret,
    accountId,
    messageId,
    fileName,
    contentType,
    signature,
  });
  if (!valid) {
    return c.json({ error: 'Invalid file URL' }, 403);
  }

  let accessToken = c.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (accountId !== 'default') {
    const account = await c.env.DB
      .prepare('SELECT channel_access_token FROM line_accounts WHERE id = ? AND is_active = 1')
      .bind(accountId)
      .first<{ channel_access_token: string | null }>();
    if (!account?.channel_access_token) {
      return c.json({ error: 'File account not found' }, 404);
    }
    accessToken = account.channel_access_token;
  }

  const lineRes = await fetch(
    `https://api-data.line.me/v2/bot/message/${encodeURIComponent(messageId)}/content`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!lineRes.ok) {
    const text = await lineRes.text().catch(() => '');
    console.error('LINE content proxy fetch failed:', lineRes.status, lineRes.statusText, text);
    return c.json({ error: 'File is no longer available from LINE' }, 502);
  }

  const headers = new Headers();
  headers.set('Content-Type', contentType);
  headers.set('Cache-Control', 'public, max-age=3600');

  const contentLength = lineRes.headers.get('content-length');
  if (contentLength) headers.set('Content-Length', contentLength);

  const inlineTypes = [...IMAGE_TYPES, 'application/pdf', 'video/mp4', 'audio/mp4', 'audio/mpeg'];
  const disposition = inlineTypes.includes(contentType) ? 'inline' : 'attachment';
  headers.set('Content-Disposition', buildContentDisposition(disposition, fileName));

  return new Response(lineRes.body, { headers });
});

// GET /api/files/:key — serve file from KV (public, no auth)
uploads.get('/api/files/:key', async (c) => {
  const key = c.req.param('key');
  const { value, metadata } = await c.env.UPLOADS.getWithMetadata<StoredUploadMetadata>(
    key,
    'arrayBuffer',
  );

  if (!value || metadata?.access === FORM_PRIVATE_UPLOAD_ACCESS) {
    return c.json({ error: 'Not found' }, 404);
  }

  const contentType = inferContentTypeFromKey(key, metadata?.contentType || 'application/octet-stream');
  const isImage = IMAGE_TYPES.includes(contentType);
  const headers: Record<string, string> = {
    'Content-Type': contentType,
    'Cache-Control': 'public, max-age=31536000, immutable',
  };

  // PDFs and images display inline; other files download
  const inlineTypes = [
    ...IMAGE_TYPES,
    'application/pdf',
    'video/mp4',
    'video/3gpp',
    'audio/aac',
    'audio/amr',
    'audio/mpeg',
    'audio/mp4',
    'audio/ogg',
  ];
  if (!inlineTypes.includes(contentType) && metadata?.originalName) {
    headers['Content-Disposition'] = buildContentDisposition('attachment', metadata.originalName);
  } else if (contentType === 'application/pdf') {
    headers['Content-Disposition'] = metadata?.originalName
      ? buildContentDisposition('inline', metadata.originalName)
      : 'inline';
  }

  return new Response(value as ArrayBuffer, { headers });
});

// Keep old /api/images/:key path working for backward compatibility
uploads.get('/api/images/:key', async (c) => {
  const key = c.req.param('key');
  const { value, metadata } = await c.env.UPLOADS.getWithMetadata<StoredUploadMetadata>(
    key,
    'arrayBuffer',
  );

  if (!value || metadata?.access === FORM_PRIVATE_UPLOAD_ACCESS) {
    return c.json({ error: 'Not found' }, 404);
  }

  return new Response(value as ArrayBuffer, {
    headers: {
      'Content-Type': metadata?.contentType || 'image/jpeg',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
});

export { uploads };
