// ── Aura 3.0 · image tools (Wave 11 — custom track artwork) ─────────────────
// Efficient image handling for user-chosen artwork (spec §15): the selected
// file is downscaled ONCE in the renderer to a bounded square JPEG before it
// ever reaches the artwork store — no multi-megabyte originals persisted,
// no memory spike, no provider metadata touched.
//
// createImageBitmap + canvas is dependency-free and off the main decode
// hot path (one-shot per user action, not per render).

export const ARTWORK_MAX_DIM = 512
export const ARTWORK_JPEG_QUALITY = 0.85

/** Read a File/Blob as a downscaled square-cover JPEG data URL. */
export async function downscaleToCoverDataUrl(
  file: File | Blob,
  maxDim = ARTWORK_MAX_DIM,
  quality = ARTWORK_JPEG_QUALITY,
): Promise<string> {
  if (typeof createImageBitmap !== 'function') {
    throw new Error('Image decoding is not supported in this environment')
  }
  const bitmap = await createImageBitmap(file)
  try {
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height))
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas is unavailable')
    ctx.drawImage(bitmap, 0, 0, w, h)
    return canvas.toDataURL('image/jpeg', quality)
  } finally {
    bitmap.close()
  }
}

/** Quick guard for the file input's accept list — images only. */
export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/')
}
