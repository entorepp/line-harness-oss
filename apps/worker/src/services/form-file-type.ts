// Browser MIME/filename values vary between mobile document and photo pickers.
// Identify supported private attachments from bytes; never trust a renamed file.
export function detectFormFileType(bytes: Uint8Array): string {
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end));
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v)) return 'image/png';
  if (['GIF87a', 'GIF89a'].includes(ascii(0, 6))) return 'image/gif';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (ascii(0, 2) === 'BM') return 'image/bmp';
  if ([0x49, 0x49, 0x2a, 0].every((v, i) => bytes[i] === v)
    || [0x4d, 0x4d, 0, 0x2a].every((v, i) => bytes[i] === v)) return 'image/tiff';
  if (ascii(4, 8) === 'ftyp') {
    const brands = [ascii(8, 12)];
    const boxSize = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
    for (let i = 16; i + 4 <= Math.min(boxSize, bytes.length); i += 4) brands.push(ascii(i, i + 4));
    if (brands.some(b => ['avif', 'avis'].includes(b))) return 'image/avif';
    if (brands.some(b => ['heic', 'heix', 'hevc', 'hevx'].includes(b))) return 'image/heic';
    if (brands.some(b => ['mif1', 'msf1'].includes(b))) return 'image/heif';
  }
  // Some PDF writers prepend a BOM or a short transport header.
  if (/%PDF-\d\.\d/.test(ascii(0, 1024))) return 'application/pdf';
  return '';
}

export const FORM_FILE_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/heic': 'heic', 'image/heif': 'heif',
  'image/webp': 'webp', 'image/gif': 'gif', 'image/tiff': 'tiff', 'image/bmp': 'bmp',
  'image/avif': 'avif', 'application/pdf': 'pdf',
};
