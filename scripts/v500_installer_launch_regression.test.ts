import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8')
const launch = source.match(/fn enqueue_launch_paths[\s\S]*?\n}\n/)?.[0] ?? ''
const shutdown = source.match(/fn shutdown_complete\([\s\S]*?\n}\n/)?.[0] ?? ''

test('relaunch restores the main window even when no audio path is forwarded', () => {
  const restore = launch.indexOf('main.show()')
  const noFilesReturn = launch.indexOf('if accepted.is_empty()')
  assert.ok(restore >= 0 && noFilesReturn > restore,
    'restore/focus must happen before the empty-arguments early return')
  assert.match(launch, /main\.set_focus\(\)/)
})

test('completed renderer shutdown exits the whole app, including its hidden mini window', () => {
  assert.match(shutdown, /app\.exit\(0\)/)
  assert.doesNotMatch(shutdown, /window\.close\(\)/)
})
