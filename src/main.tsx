import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@/ui/styles/app.css'
import { App } from '@/app/app'
import { startInstallCapture } from '@/app/install-capture'

// Before the first render, so an early `beforeinstallprompt` is kept.
startInstallCapture()

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Root element #root not found')
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
