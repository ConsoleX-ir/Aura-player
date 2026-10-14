import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { usePlayerStore } from '@/store/playerStore'
import { useUiStore } from '@/store/uiStore'

// Test/QA hook: lets functional suites read the live store directly
// (harmless in production — a single window property).
;(window as unknown as { __auraStore?: unknown }).__auraStore = usePlayerStore
;(window as unknown as { __auraUi?: unknown }).__auraUi = useUiStore

// Theme switch wiring point (Wave 5): the design system's semantic tokens
// resolve under [data-theme='dark'|'light'] on <html>. Dark is Aura's true
// form and the default; light values already exist in tokens.css.
document.documentElement.dataset.theme = 'dark'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
