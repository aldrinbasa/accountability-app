import { act, fireEvent, render, screen, within } from '@testing-library/react'
import type { TodayItem } from '@/domain/today'
import { getPostMoment, setPostMoment, type PostMoment as Moment } from '@/data/post-moment'
import {
  createFakeBackend,
  renderRoutes,
  TEST_GROUP,
  TEST_TODAY_SUMMARY,
} from '@/test/fake-backend'
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
  it('shows the polaroid with the caption, announces once and vibrates once (also after a remount)', () => {
    const vibrate = vi.fn(() => true)
    Object.defineProperty(navigator, 'vibrate', { configurable: true, value: vibrate })
    try {
      setPostMoment({ ...MOMENT })
      const first = render(<PostMoment groupId={TEST_GROUP.id} />)
      const moment = document.querySelector('[data-component="post-moment"]') as HTMLElement
      expect(within(moment).getByRole('figure')).toHaveTextContent('leg day')
      expect(within(moment).getByText('Run · 3/3')).toBeInTheDocument()
      expect(
        within(moment).getByRole('img', { name: 'Your Run check-in, caption: leg day' }),
      ).toBeInTheDocument()
      expect(screen.getByRole('status')).toHaveTextContent('Posted. Run 3 of 3.')
      expect(moment).toHaveClass('animate-polaroid-drop')
      first.unmount()

      render(<PostMoment groupId={TEST_GROUP.id} />)
      expect(screen.getByRole('status')).toHaveTextContent('')
      expect(screen.getByText('leg day')).toBeInTheDocument()
      expect(vibrate).toHaveBeenCalledTimes(1)
      expect(vibrate).toHaveBeenCalledWith(10)
    } finally {
      Reflect.deleteProperty(navigator, 'vibrate')
    }
  })

  it('a tap jumps to the end state', () => {
    setPostMoment({ ...MOMENT })
    render(<PostMoment groupId={TEST_GROUP.id} />)
    const moment = document.querySelector('[data-component="post-moment"]') as HTMLElement
    expect(moment).toHaveAttribute('data-playing')
    act(() => {
      fireEvent.pointerDown(document.body)
    })
    expect(getPostMoment()?.played).toBe(true)
    expect(moment).not.toHaveAttribute('data-playing')
    expect(moment).not.toHaveClass('animate-polaroid-drop')
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
