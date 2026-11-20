import { screen } from '@testing-library/react'
import type { MyGroup } from '@/domain/groups'
import { FOCUSED_GROUP_KEY } from '@/data/focused-group'
import { createFakeBackend, renderRoutes } from '@/test/fake-backend'
import { searchWithGroup } from '@/features/group/use-focused-group'
import { waitForGroupInUrl } from '@/test/router'

function group(id: string, name: string, joinedAt: string, memberCount = 2): MyGroup {
  return {
    id,
    name,
    timeZone: 'UTC',
    pendingTimeZone: null,
    pendingWeekStart: null,
    role: 'member',
    joinedAt,
    memberCount,
  }
}

const A = group('a', 'Alpha', '2026-11-01T10:00:00Z')
const B = group('b', 'Bravo', '2026-11-05T10:00:00Z')

function renderWith(path: string, groups: MyGroup[]) {
  return renderRoutes([path], createFakeBackend(undefined, { groups }))
}

async function switcherFor(name: string) {
  return screen.findByRole('button', { name: `Group: ${name}, switch group` })
}

describe('focused group sync', () => {
  it('URL focus: ?g= of a current group wins over the stored one and is stored', async () => {
    localStorage.setItem(FOCUSED_GROUP_KEY, 'a')
    const { router } = renderWith('/today?g=b', [A, B])
    await switcherFor('Bravo')
    expect(router.state.location.search).toBe('?g=b')
    await vi.waitFor(() => expect(localStorage.getItem(FOCUSED_GROUP_KEY)).toBe('b'))
  })

  it('stale URL: falls back to the stored group and replaces ?g=', async () => {
    localStorage.setItem(FOCUSED_GROUP_KEY, 'a')
    const { router } = renderWith('/feed?g=x', [A, B])
    await switcherFor('Alpha')
    await waitForGroupInUrl(router, 'a')
    expect(router.state.location.pathname).toBe('/feed')
  })

  it('stored focus: no ?g= takes the stored group and writes it to the URL by replace', async () => {
    localStorage.setItem(FOCUSED_GROUP_KEY, 'b')
    const { router } = renderWith('/today', [A, B])
    await switcherFor('Bravo')
    await waitForGroupInUrl(router, 'b')
    expect(router.state.historyAction).toBe('REPLACE')
  })

  it('earliest joined: a stale stored id falls back to the group joined first', async () => {
    localStorage.setItem(FOCUSED_GROUP_KEY, 'gone')
    const { router } = renderWith('/today', [B, A])
    await switcherFor('Alpha')
    await waitForGroupInUrl(router, 'a')
    expect(localStorage.getItem(FOCUSED_GROUP_KEY)).toBe('a')
  })

  it('no groups: drops ?g= and shows no switcher', async () => {
    const { router } = renderWith('/today?g=a', [])
    await screen.findByRole('heading', { level: 1, name: 'Start a group' })
    await vi.waitFor(() => expect(router.state.location.search).toBe(''))
    expect(screen.queryByRole('button', { name: /switch group/ })).not.toBeInTheDocument()
  })

  it('keeps other query params when it sets or drops g', () => {
    expect(searchWithGroup('?x=1&g=a', 'b')).toBe('?x=1&g=b')
    expect(searchWithGroup('?x=1&g=a', null)).toBe('?x=1')
    expect(searchWithGroup('', null)).toBe('')
  })
})
