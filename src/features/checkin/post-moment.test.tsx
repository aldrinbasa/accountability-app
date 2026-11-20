import { act, fireEvent, render, screen, within } from '@testing-library/react'
import type { TodayItem } from '@/domain/today'
import { getPostMoment, setPostMoment, type PostMoment as Moment } from '@/data/post-moment'
import {
  createFakeBackend,
  renderRoutes,
  TEST_GROUP,
  TEST_TODAY_SUMMARY,
} from '@/test/fake-backend'
import { installMatchMedia } from '@/test/setup'
import { PostMoment } from '@/features/checkin/post-moment'

const MOMENT: Moment = {
  checkinId: 'k1',
  groupId: TEST_GROUP.id,
  commitmentId: 'c-run',
  title: 'Run',
  doneCount: 3,
  target: 3,
  counted: true,
  isLate: false,
  photoUrl: null,
  caption: 'leg day',
  postedAt: Date.now(),
  played: false,
  announced: false,
}

const RUN: TodayItem = {
  commitmentId: 'c-run',
  kind: 'commitment',
  section: 'due_today',
  presetKey: 'run',
  customName: null,
  activityName: 'Run',
  name: null,
  scheduleType: 'times_per_week',
  days: null,
  target: 3,
  counted: 2,
  deadline: null,
  startsOn: null,
  canDelete: false,
  countedToday: false,
  targetMet: false,
}

describe('PostMoment', () => {
  it('drops the polaroid as a hidden fixed overlay, announces once and vibrates once (also after a remount)', () => {
    const vibrate = vi.fn(() => true)
    Object.defineProperty(navigator, 'vibrate', { configurable: true, value: vibrate })
    try {
      setPostMoment({ ...MOMENT })
      const first = render(<PostMoment groupId={TEST_GROUP.id} />)
      const drop = document.querySelector('[data-component="post-moment-drop"]') as HTMLElement
      expect(drop).toHaveAttribute('aria-hidden', 'true')
      expect(drop).toHaveClass('fixed', 'pointer-events-none', 'animate-polaroid-fade')
      expect(drop.querySelector('.animate-polaroid-drop')).not.toBeNull()
      expect(drop.querySelector('figure')).toHaveTextContent('leg day')
      expect(drop).toHaveTextContent('Run · 3/3')
      // The strip's mini carries the focus target, never the overlay.
      expect(document.querySelector('[data-component="post-moment"]')).toBeNull()
      expect(screen.getByRole('status')).toHaveTextContent('Posted. Run 3 of 3.')
      first.unmount()

      render(<PostMoment groupId={TEST_GROUP.id} />)
      expect(screen.getByRole('status')).toHaveTextContent('')
      expect(vibrate).toHaveBeenCalledTimes(1)
      expect(vibrate).toHaveBeenCalledWith(10)
    } finally {
      Reflect.deleteProperty(navigator, 'vibrate')
    }
  })

  it('a tap jumps to the end state: the overlay goes', () => {
    setPostMoment({ ...MOMENT })
    render(<PostMoment groupId={TEST_GROUP.id} />)
    expect(document.querySelector('[data-component="post-moment-drop"]')).not.toBeNull()
    act(() => {
      fireEvent.pointerDown(document.body)
    })
    expect(getPostMoment()?.played).toBe(true)
    expect(document.querySelector('[data-component="post-moment-drop"]')).toBeNull()
  })

  it('with reduced motion there is no overlay, and the announcement stays', () => {
    installMatchMedia(true)
    try {
      setPostMoment({ ...MOMENT })
      render(<PostMoment groupId={TEST_GROUP.id} />)
      expect(document.querySelector('[data-component="post-moment-drop"]')).toBeNull()
      expect(screen.getByRole('status')).toHaveTextContent('Posted. Run 3 of 3.')
    } finally {
      installMatchMedia(false)
    }
  })

  it('shows nothing for another group', () => {
    setPostMoment({ ...MOMENT, groupId: 'other' })
    const { container } = render(<PostMoment groupId={TEST_GROUP.id} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('Today under a post moment', () => {
  it("the row shows the moment's counts and bumps while the data is older than the post", async () => {
    // Posted after any fetch in this test, so the cached rows are older than the post.
    setPostMoment({ ...MOMENT, postedAt: Date.now() + 60_000 })
    renderRoutes(
      ['/today'],
      createFakeBackend(undefined, {
        today: {
          [TEST_GROUP.id]: { items: [RUN], summary: { ...TEST_TODAY_SUMMARY, planned: 3 } },
        },
      }),
    )
    const ring = await screen.findByRole('img', { name: 'Run, 3 of 3 this week' })
    expect(ring).toHaveClass('animate-count-bump')
    const row = ring.closest('li') as HTMLElement
    expect(within(row).getByText('3 times per week · target met')).toBeInTheDocument()
  })
})
