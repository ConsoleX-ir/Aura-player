// Local media URLs.
//
// Electron served local files through a custom `aura://local?path=…` protocol.
// Wails v2 only routes same-origin http(s) requests to its asset server, so the
// desktop build serves them from `/aura/local?path=…` (see internal/media).

const PREFIX = '/aura/local'
const LEGACY = /^aura:\/\/local\?/i

/** URL the webview can load for an absolute local file path. */
export function localMediaUrl(path: string): string {
  return `${PREFIX}?${new URLSearchParams({ path }).toString()}`
}

/**
 * Maps a legacy `aura://local?…` URL (found in libraries exported from the
 * Electron build) to the current form. Everything else passes through.
 */
export function normalizeMediaUrl<T extends string | null | undefined>(url: T): T {
  if (typeof url === 'string' && LEGACY.test(url)) {
    return (PREFIX + '?' + url.replace(LEGACY, '')) as T
  }
  return url
}
