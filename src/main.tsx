import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@/ui/styles/app.css'
import { App } from '@/app/app'
import { startInstallCapture } from '@/app/install-capture'
import { startInputModality } from '@/app/input-modality'
import { startThemeSync } from '@/data/theme'

// Before the first render, so an early `beforeinstallprompt` is kept.
startInstallCapture()
// index.html already applied the stored theme; this keeps Auto following the phone live.
startThemeSync()
startInputModality()

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Root element #root not found')
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
