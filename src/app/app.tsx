import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from 'react-router/dom'
import { adapters } from '@/app/composition'
import { createAppRouter } from '@/app/router'
import { UpdatePrompt } from '@/app/update-prompt'
import { clearAccountDeviceState } from '@/data/account-device-state'
import { BackendProvider } from '@/data/backend-context'
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
        }}
      >
        <RouterProvider router={router} />
      </BackendProvider>
      <Toaster />
      <UpdatePrompt />
    </QueryClientProvider>
  )
}
