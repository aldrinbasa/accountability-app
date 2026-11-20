import { useEffect, useState, type ReactNode } from 'react'
import { IsRestoringProvider, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from 'react-router/dom'
import { OFFLINE_COPY } from '@/domain/offline'
import { CameraPortContext } from '@/app/camera-port-context'
import { adapters } from '@/app/composition'
import { createAppRouter } from '@/app/router'
import { UpdatePrompt } from '@/app/update-prompt'
import { clearAccountDeviceState } from '@/data/account-device-state'
import { useAuthSession } from '@/data/auth-session'
import { BackendProvider } from '@/data/backend-context'
import { ImageEncoderContext } from '@/data/image-encoder-context'
import { clearPhotoCache } from '@/data/photo-url'
import { clearPostMoment } from '@/data/post-moment'
import { createAppQueryClient } from '@/data/query-client'
import {
  createQueryPersistence,
  useRestoringQueryCache,
  type QueryPersistence,
} from '@/data/query-persistence'
import { showToast } from '@/ui/toast'
import { Toaster } from '@/ui/toaster'

/** One "Couldn't refresh." toast at a time; a new failure replaces it. */
const REFRESH_FAILED_TOAST_ID = 'refresh-failed'

/** Queries hold off until the signed-in user's saved cache is restored (Story 3.3). */
/**
 * Signed out (also a session that expired while the app was closed): no account's photos stay in
 * the service worker's cache for the next account to read offline (Story 3.4).
 */
function ClearPhotosWhenSignedOut() {
  const { status } = useAuthSession()
  useEffect(() => {
    if (status === 'signed-out') void clearPhotoCache()
  }, [status])
  return null
}

function RestoredQueryCache({
  persistence,
  children,
}: {
  persistence: QueryPersistence
  children: ReactNode
}) {
  const restoring = useRestoringQueryCache(persistence)
  return <IsRestoringProvider value={restoring}>{children}</IsRestoringProvider>
}

export function App() {
  const [queryClient] = useState(() =>
    createAppQueryClient({
      onRefreshFailed: (retry) =>
        showToast(OFFLINE_COPY.refreshFailed, {
          variant: 'error',
          id: REFRESH_FAILED_TOAST_ID,
          action: { label: OFFLINE_COPY.retry, onClick: retry },
        }),
    }),
  )
  const [persistence] = useState(() =>
    createQueryPersistence(queryClient, { buster: __PROOFY_BUILD_ID__ }),
  )
  const [router] = useState(createAppRouter)

  return (
    <QueryClientProvider client={queryClient}>
      {/* A session that ends (sign-out, other tab, expiry, another account) stops saving the
          query cache and deletes that user's saved copy, then drops every cached query and the
          account's device state (focused group, last-seen member counts) and the cached photos. The check-in outbox
          stays on the device (only a confirmed sign-out in Settings clears it). */}
      <BackendProvider
        backend={adapters.backend}
        onSignedOut={() => {
          void persistence.stop()
          queryClient.clear()
          clearAccountDeviceState()
          clearPostMoment()
          void clearPhotoCache()
        }}
      >
        <ClearPhotosWhenSignedOut />
        <RestoredQueryCache persistence={persistence}>
          <ImageEncoderContext.Provider value={adapters.imageEncoder}>
            <CameraPortContext.Provider value={adapters.camera}>
              <RouterProvider router={router} />
            </CameraPortContext.Provider>
          </ImageEncoderContext.Provider>
        </RestoredQueryCache>
      </BackendProvider>
      <Toaster />
      <UpdatePrompt />
    </QueryClientProvider>
  )
}
