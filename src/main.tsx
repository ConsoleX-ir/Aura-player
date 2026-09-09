import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

// Theme switch wiring point (Wave 5): the design system's semantic tokens
// resolve under [data-theme='dark'|'light'] on <html>. Dark is Aura's true
// form and the default; light values already exist in tokens.css.
document.documentElement.dataset.theme = 'dark'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
