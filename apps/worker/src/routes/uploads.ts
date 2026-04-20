import { Hono } from 'hono';
import type { Env } from '../index.js';

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

function inferContentTypeFromKey(key: string, fallback: string): string {
  if (fallback !== 'application/octet-stream') return fallback;

  const ext = key.split('.').pop()?.toLowerCase() || '';
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'mp4') return 'video/mp4';
  if (ext === 'mp3') return 'audio/mpeg';
  if (ext === 'm4a') return 'audio/mp4';
  if (ext === 'wav') return 'audio/wav';
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

const uploads = new Hono<Env>();

// POST /api/upload — upload any file to KV, return public URL
uploads.post('/api/upload', async (c) => {
  try {
    const formData = await c.req.formData();
    const entry = formData.get('file');
    if (!entry || typeof entry === 'string') {
      return c.json({ success: false, error: 'file is required' }, 400);
    }
    const file = entry as File;

    // KV value limit is 25MB
    if (file.size > 25 * 1024 * 1024) {
      return c.json({ success: false, error: 'File too large (max 25MB)' }, 400);
    }

    const id = crypto.randomUUID();
    const ext = getExtension(file.name, file.type);
    const key = `${id}.${ext}`;
    const isImage = IMAGE_TYPES.includes(file.type);

    const arrayBuffer = await file.arrayBuffer();
    await c.env.UPLOADS.put(key, arrayBuffer, {
      metadata: {
        contentType: file.type,
        originalName: file.name,
        size: file.size,
      },
    });

    const workerUrl = c.env.WORKER_URL || `https://${c.req.header('host')}`;
    const url = `${workerUrl}/api/files/${key}`;

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
      },
    });
  } catch (err) {
    console.error('POST /api/upload error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/files/:key — serve file from KV (public, no auth)
uploads.get('/api/files/:key', async (c) => {
  const key = c.req.param('key');
  const { value, metadata } = await c.env.UPLOADS.getWithMetadata<{
    contentType: string;
    originalName?: string;
  }>(key, 'arrayBuffer');

  if (!value) {
    return c.json({ error: 'Not found' }, 404);
  }

  const contentType = inferContentTypeFromKey(key, metadata?.contentType || 'application/octet-stream');
  const isImage = IMAGE_TYPES.includes(contentType);
  const headers: Record<string, string> = {
    'Content-Type': contentType,
    'Cache-Control': 'public, max-age=31536000, immutable',
  };

  // PDFs and images display inline; other files download
  const inlineTypes = [...IMAGE_TYPES, 'application/pdf'];
  if (!inlineTypes.includes(contentType) && metadata?.originalName) {
    headers['Content-Disposition'] = `attachment; filename="${encodeURIComponent(metadata.originalName)}"`;
  } else if (contentType === 'application/pdf') {
    headers['Content-Disposition'] = metadata?.originalName
      ? `inline; filename="${encodeURIComponent(metadata.originalName)}"`
      : 'inline';
  }

  return new Response(value as ArrayBuffer, { headers });
});

// Keep old /api/images/:key path working for backward compatibility
uploads.get('/api/images/:key', async (c) => {
  const key = c.req.param('key');
  const { value, metadata } = await c.env.UPLOADS.getWithMetadata<{ contentType: string }>(key, 'arrayBuffer');

  if (!value) {
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
