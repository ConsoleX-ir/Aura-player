// Aura 3.2.1 — micro-benchmark: old (O(N×M) Array.find) vs new (Set) addToLibrary core.
// Run: node scripts/v321_bench_addtolibrary.mjs
// This isolates the dedupe algorithm exactly as both implementations are
// written in playerStore.addToLibrary, on synthetic import batches.

function oldCore(library, songs) {
  return [...library, ...songs.filter((n) => !library.find((e) => e.id === n.id))]
}
function newCore(library, songs) {
  const seen = new Set(library.map((e) => e.id))
  const fresh = []
  for (const n of songs) {
    if (seen.has(n.id)) continue
    seen.add(n.id)
    fresh.push(n)
  }
  return [...library, ...fresh]
}

function bench(fn, library, batch) {
  const t0 = performance.now()
  const out = fn(library, batch)
  return { ms: performance.now() - t0, added: out.length - library.length }
}

for (const [libSize, batchSize] of [[5_000, 2_000], [10_000, 5_000], [20_000, 20_000]]) {
  const library = Array.from({ length: libSize }, (_, i) => ({ id: `lib${i}` }))
  // realistic re-import: 90% already known, 10% genuinely new, batch order kept
  const batch = Array.from({ length: batchSize }, (_, i) =>
    i % 10 === 9 ? { id: `new${i}` } : { id: `lib${i % libSize }` })

  // warmup + best of 3
  let oldBest = Infinity, newBest = Infinity
  for (let r = 0; r < 3; r++) {
    oldBest = Math.min(oldBest, bench(oldCore, library, batch).ms)
    newBest = Math.min(newBest, bench(newCore, library, batch).ms)
  }
  // sanity: same output
  const o = oldCore(library, batch), n = newCore(library, batch)
  const same = o.length === n.length && o.every((s, i) => s.id === n[i].id)
  console.log(`library=${libSize} batch=${batchSize}  old=${oldBest.toFixed(1)}ms  new=${newBest.toFixed(1)}ms  speedup=${(oldBest / newBest).toFixed(1)}x  identicalOutput=${same}`)
}
