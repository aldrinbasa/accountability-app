import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from 'react-router/dom'
import { createAppRouter } from '@/app/router'

export function App() {
  const [queryClient] = useState(() => new QueryClient())
  const [router] = useState(createAppRouter)

  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
}
