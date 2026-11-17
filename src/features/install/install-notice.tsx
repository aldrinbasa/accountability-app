import { useState } from 'react'
import { useNavigate } from 'react-router'
import { BellRinging, DeviceMobile } from '@phosphor-icons/react'
import { INSTALL_PATH, installNotice } from '@/domain/install'
import { dismissInstallHint, promptInstall, useInstallState } from '@/data/install-state'
import { Banner } from '@/ui/banner'
import { Hint } from '@/ui/hint'

const NOTICE_COPY = {
  banner: 'Reminders need Proofy on your home screen.',
  showMeHow: 'Show me how',
  hint: 'Proofy works best from your home screen. Full screen, one tap away.',
  install: 'Install',
  notNow: 'Not now',
} as const

/**
 * Today's install notice until the app is installed: in an iOS Safari tab a persistent Banner that
 * opens the guide; everywhere else a Hint with Install (the browser prompt, else the guide) and
 * Not now (back in a week).
 */
export function InstallNotice() {
  const state = useInstallState()
  const navigate = useNavigate()
  // Read once per visit to Today (render stays pure); Not now moves it to the dismissal time.
  const [now, setNow] = useState(() => new Date())
  const notice = installNotice(state, now)

  function openGuide() {
    void navigate(INSTALL_PATH)
  }

  async function install() {
    if (!state.canPrompt) return openGuide()
    const outcome = await promptInstall()
    if (outcome === 'unavailable') openGuide()
    // Accepted: `appinstalled` hides the Hint. Dismissed: it stays.
  }

  if (notice === 'banner') {
    return (
      <Banner icon={BellRinging} action={{ label: NOTICE_COPY.showMeHow, onClick: openGuide }}>
        {NOTICE_COPY.banner}
      </Banner>
    )
  }
  if (notice === 'hint') {
    return (
      <Hint
        icon={DeviceMobile}
        actions={[
          { label: NOTICE_COPY.install, onClick: () => void install() },
          {
            label: NOTICE_COPY.notNow,
            onClick: () => {
              const at = new Date()
              setNow(at)
              dismissInstallHint(at)
            },
          },
        ]}
      >
        {NOTICE_COPY.hint}
      </Hint>
    )
  }
  return null
}
