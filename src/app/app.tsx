import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from 'react-router/dom'
import { CameraPortContext } from '@/app/camera-port-context'
import { adapters } from '@/app/composition'
import { createAppRouter } from '@/app/router'
import { UpdatePrompt } from '@/app/update-prompt'
import { clearAccountDeviceState } from '@/data/account-device-state'
import { BackendProvider } from '@/data/backend-context'
import { ImageEncoderContext } from '@/data/image-encoder-context'
import { clearPostMoment } from '@/data/post-moment'
import { Toaster } from '@/ui/toaster'

export function App() {
  const [queryClient] = useState(() => new QueryClient())
  const [router] = useState(createAppRouter)

  return (
    <QueryClientProvider client={queryClient}>
      {/* A session that ends (sign-out, other tab, expiry, another account) drops every cached
          query and the account's device state (focused group, last-seen member counts). */}
      <BackendProvider
        backend={adapters.backend}
        onSignedOut={() => {
          queryClient.clear()
          clearAccountDeviceState()
          clearPostMoment()
        }}
      >
        <ImageEncoderContext.Provider value={adapters.imageEncoder}>
          <CameraPortContext.Provider value={adapters.camera}>
            <RouterProvider router={router} />
          </CameraPortContext.Provider>
        </ImageEncoderContext.Provider>
      </BackendProvider>
      <Toaster />
      <UpdatePrompt />
    </QueryClientProvider>
  )
}
