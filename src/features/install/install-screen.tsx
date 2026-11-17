import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import {
  Compass,
  DeviceMobile,
  DotsThreeVertical,
  Export,
  House,
  PlusSquare,
  type Icon as PhosphorIcon,
} from '@phosphor-icons/react'
import { INSTALL_PATH, installGuideTarget } from '@/domain/install'
import { dismissInstallGuide, promptInstall, useInstallState } from '@/data/install-state'
import { clearPendingNext, peekPendingNext } from '@/data/pending-signin'
import { Button } from '@/ui/button'
import { Icon } from '@/ui/icon'
import { showToast } from '@/ui/toast'

interface Step {
  icon: PhosphorIcon
  title: string
  detail: string
}

const INSTALL_COPY = {
  heading: 'Put Proofy on your home screen',
  sub: 'It opens full screen, like a real app.',
  subPrompt: 'It opens full screen, like a real app, and you can find it in one tap.',
  why: 'Reminders need this.',
  install: 'Install Proofy',
  continue: 'Continue without installing',
  iosSteps: [
    { icon: Export, title: 'Tap Share', detail: "On newer iPhones it's inside the ••• menu." },
    {
      icon: PlusSquare,
      title: 'Tap Add to Home Screen',
      detail: "Scroll down the list if you don't see it.",
    },
    {
      icon: House,
      title: 'Open Proofy from your home screen',
      detail: "Sign in there once more. It's a separate app.",
    },
  ] satisfies readonly Step[],
  menuSteps: [
    {
      icon: DotsThreeVertical,
      title: 'Open your browser menu',
      detail: 'Usually ⋮ or ☰ next to the address bar.',
    },
    {
      icon: PlusSquare,
      title: 'Tap Install app or Add to Home screen',
      detail: 'The name depends on your browser.',
    },
    {
      icon: House,
      title: 'Open Proofy from your home screen',
      detail: "That's the full-screen app.",
    },
  ] satisfies readonly Step[],
  safariHeading: 'Open this in Safari to install',
  safariSub:
    'On iPhone, only Safari can put Proofy on your home screen. Copy the link, paste it in Safari, and the steps show there.',
  copyLink: 'Copy link',
  copied: 'Link copied.',
  copyFailed: (link: string) => `Couldn't copy. The link is ${link}.`,
} as const

type Variant = 'ios-safari' | 'ios-other' | 'prompt' | 'menu'

/** The "Reminders need this." line, hand-written on a tilted sticky label. */
function WhyLabel() {
  return (
    <p className="-rotate-2 self-start rounded-wob-xs bg-sticky px-[10px] py-[2px] type-hand-md text-obj-ink">
      {INSTALL_COPY.why}
    </p>
  )
}

/** Install step card (DESIGN.md `install-step-card`): card, `numeral-md` number, 32px icon. */
function StepCards({ steps }: { steps: readonly Step[] }) {
  return (
    <ol className="flex flex-col gap-[14px]">
      {steps.map((step, index) => (
        <li
          key={step.title}
          className="card grid grid-cols-[2.25rem_1fr_32px] items-center gap-[10px] shadow-ink"
          data-component="install-step-card"
        >
          <span aria-hidden="true" className="text-center type-numeral-md">
            {index + 1}
          </span>
          <span className="min-w-0">
            <span className="block type-body-strong">{step.title}</span>
            <span className="block type-body-sm text-muted">{step.detail}</span>
          </span>
          <Icon icon={step.icon} size={32} />
        </li>
      ))}
    </ol>
  )
}

function BigIcon({ icon }: { icon: PhosphorIcon }) {
  return (
    <div className="flex justify-center pt-[14px] pb-1">
      <Icon icon={icon} size={64} />
    </div>
  )
}

/**
 * Leaves the guide for the pending `next` path (cleared) or /today. A member without a profile is
 * then sent on to /setup by the profile gate, which saves that path as `next` again. Runs once.
 */
function useLeaveGuide(): () => void {
  const navigate = useNavigate()
  const left = useRef(false)
  return useCallback(() => {
    if (left.current) return
    left.current = true
    const target = installGuideTarget(peekPendingNext())
    clearPendingNext()
    void navigate(target, { replace: true })
  }, [navigate])
}

/**
 * `/install`: steps to put Proofy on the home screen that match the device. iOS Safari gets the
 * Share steps, other iOS browsers are sent to Safari, a browser with a kept install prompt gets one
 * Install button, and everything else gets the browser-menu steps. Already installed: forwards on.
 */
export function InstallScreen() {
  const state = useInstallState()
  const leave = useLeaveGuide()
  const [prompting, setPrompting] = useState(false)
  const [promptFailed, setPromptFailed] = useState(false)

  useEffect(() => {
    if (state.installed) leave()
  }, [state.installed, leave])

  const variant: Variant =
    state.platform === 'ios-safari'
      ? 'ios-safari'
      : state.platform === 'ios-other'
        ? 'ios-other'
        : (state.canPrompt || prompting) && !promptFailed
          ? 'prompt'
          : 'menu'

  async function install() {
    setPrompting(true)
    const outcome = await promptInstall()
    setPrompting(false)
    if (outcome === 'accepted') leave()
    else if (outcome === 'unavailable') setPromptFailed(true)
    // Dismissed: stay on the guide.
  }

  async function copyLink() {
    // The guide itself, so Safari opens on the steps even when it is already signed in.
    const link = `${window.location.origin}${INSTALL_PATH}`
    try {
      await navigator.clipboard.writeText(link)
      showToast(INSTALL_COPY.copied)
    } catch {
      showToast(INSTALL_COPY.copyFailed(link), { variant: 'error' })
    }
  }

  function continueWithoutInstalling() {
    dismissInstallGuide()
    leave()
  }

  if (state.installed) return null

  return (
    <div className="flex flex-1 flex-col gap-[14px] pt-8">
      <h1 tabIndex={-1} className="type-headline">
        {variant === 'ios-other' ? INSTALL_COPY.safariHeading : INSTALL_COPY.heading}
      </h1>
      <p className="-mt-1 type-body text-muted">
        {variant === 'ios-other'
          ? INSTALL_COPY.safariSub
          : variant === 'prompt'
            ? INSTALL_COPY.subPrompt
            : INSTALL_COPY.sub}
      </p>

      {variant === 'ios-safari' ? (
        <>
          <WhyLabel />
          <StepCards steps={INSTALL_COPY.iosSteps} />
        </>
      ) : null}

      {variant === 'ios-other' ? (
        <>
          <WhyLabel />
          <BigIcon icon={Compass} />
          <Button variant="secondary" fullWidth onClick={() => void copyLink()}>
            {INSTALL_COPY.copyLink}
          </Button>
        </>
      ) : null}

      {variant === 'prompt' ? (
        <>
          <BigIcon icon={DeviceMobile} />
          <Button variant="primary" fullWidth busy={prompting} onClick={() => void install()}>
            {INSTALL_COPY.install}
          </Button>
        </>
      ) : null}

      {variant === 'menu' ? <StepCards steps={INSTALL_COPY.menuSteps} /> : null}

      <div className="flex-1" />
      <Button variant="ghost" fullWidth onClick={continueWithoutInstalling}>
        {INSTALL_COPY.continue}
      </Button>
    </div>
  )
}
