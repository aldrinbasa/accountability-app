import { render, screen } from '@testing-library/react'
import { App } from '@/app/app'

describe('App', () => {
  it('renders the placeholder screen through the router', async () => {
    render(<App />)
    expect(await screen.findByRole('heading', { level: 1, name: 'Proofy' })).toBeInTheDocument()
  })
})
