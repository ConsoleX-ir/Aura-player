import type { FindMetadataQuery, OnlineMatch } from '@/types'
import { isTauriDesktop, tauriProviderRequest } from '@/services/tauriLibrary'

type SourceMatch = Omit<OnlineMatch, 'sources' | 'links' | 'score'> & {
  source: string
  link?: string | null
}

let requestSequence = 0

function normStr(value: string | null | undefined): string {
  return (value ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

function cleanTag(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+[A-Z0-9]{3,}\.[A-Z]{2,4}$/i, '')
    .replace(/\s*\(.*?\)\s*/g, ' ').replace(/\s*\[.*?\]\s*/g, ' ').replace(/\s+/g, ' ').trim()
}

function dice(a: string, b: string): number {
  if (a === b) return 1
  if (a.length < 2 || b.length < 2) return 0
  const grams = new Map<string, number>()
  for (let i = 0; i < a.length - 1; i++) grams.set(a.slice(i, i + 2), (grams.get(a.slice(i, i + 2)) ?? 0) + 1)
  let hits = 0
  for (let i = 0; i < b.length - 1; i++) {
    const gram = b.slice(i, i + 2)
    const count = grams.get(gram) ?? 0
    if (count > 0) { hits++; grams.set(gram, count - 1) }
  }
  return (2 * hits) / (a.length - 1 + b.length - 1)
}

function scoreCandidate(query: FindMetadataQuery, candidate: SourceMatch): number {
  const title = dice(normStr(cleanTag(query.title)), normStr(cleanTag(candidate.title)))
  const artist = dice(normStr(cleanTag(query.artist)), normStr(cleanTag(candidate.artist)))
  const album = query.album ? dice(normStr(cleanTag(query.album)), normStr(cleanTag(candidate.album))) : 0
  const duration = !query.duration || !candidate.durationSec ? 0.5 : Math.max(0, 1 - Math.abs(query.duration - candidate.durationSec) / 15)
  return title * 0.45 + artist * 0.30 + album * 0.10 + duration * 0.15
}

export function mergeFindInfoCandidates(query: FindMetadataQuery, sourceCandidates: SourceMatch[]): OnlineMatch[] {
  const scored = sourceCandidates.map((candidate) => ({ ...candidate, score: scoreCandidate(query, candidate) }))
    .sort((a, b) => b.score - a.score)
  const groups = new Map<string, OnlineMatch>()
  for (const candidate of scored) {
    const key = `${normStr(cleanTag(candidate.title))}|${normStr(cleanTag(candidate.artist?.split(',')[0]))}`
    const previous = groups.get(key)
    if (!previous) {
      groups.set(key, {
        title: candidate.title, artist: candidate.artist, album: candidate.album, year: candidate.year,
        genre: candidate.genre, durationSec: candidate.durationSec, artworkUrl: candidate.artworkUrl,
        sources: [candidate.source], links: candidate.link ? [candidate.link] : [], score: candidate.score,
      })
      continue
    }
    if (!previous.title && candidate.title) previous.title = candidate.title
    if (!previous.artist && candidate.artist) previous.artist = candidate.artist
    if (!previous.album && candidate.album) previous.album = candidate.album
    if (!previous.year && candidate.year) previous.year = candidate.year
    if (!previous.genre && candidate.genre) previous.genre = candidate.genre
    if (!previous.artworkUrl && candidate.artworkUrl) previous.artworkUrl = candidate.artworkUrl
    if (previous.durationSec == null && candidate.durationSec != null) previous.durationSec = candidate.durationSec
    if (!previous.sources.includes(candidate.source)) previous.sources.push(candidate.source)
    if (candidate.link && !previous.links.includes(candidate.link) && previous.links.length < 3) previous.links.push(candidate.link)
    previous.score = Math.max(previous.score, candidate.score)
  }
  return [...groups.values()].sort((a, b) => b.score - a.score).slice(0, 8)
}

function requestId(): string {
  requestSequence = (requestSequence + 1) >>> 0
  return `findinfo-${Date.now()}-${requestSequence}`
}

export async function tauriFindMetadata(query: FindMetadataQuery): Promise<{ ok: true; candidates: OnlineMatch[] } | { ok: false; error: string }> {
  if (!cleanTag(query.title) && !cleanTag(query.artist)) return { ok: false, error: 'empty_query' }
  const params = { title: query.title, artist: query.artist, album: query.album, duration: query.duration }
  const providers = ['deezer', 'itunes', 'musicbrainz'] as const
  const settled = await Promise.allSettled(providers.map((op) => tauriProviderRequest(requestId(), 'findinfo', op, params)))
  const candidates: SourceMatch[] = []
  let anyResolved = false
  for (const result of settled) {
    if (result.status !== 'fulfilled' || !result.value || typeof result.value !== 'object') continue
    const rows = (result.value as { candidates?: unknown }).candidates
    if (!Array.isArray(rows)) continue
    anyResolved = true
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue
      const candidate = row as SourceMatch
      if (typeof candidate.source === 'string') candidates.push(candidate)
    }
  }
  if (!anyResolved) return { ok: false, error: 'network_error' }
  return { ok: true, candidates: mergeFindInfoCandidates(query, candidates) }
}

export async function findMetadataForDesktop(query: FindMetadataQuery): Promise<{ ok: true; candidates: OnlineMatch[] } | { ok: false; error: string } | undefined> {
  if (isTauriDesktop()) return tauriFindMetadata(query)
  return undefined
}
