import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import Menu from '../src/Menu'

vi.mock('../src/components/NavBar', () => ({
  NavBar: ({ activeSection }: { activeSection: string }) => (
    <div data-testid="nav-bar">{activeSection}</div>
  ),
}))

vi.mock('../src/audits/AuditsWorkspace', () => ({
  AuditsWorkspace: ({ searchQuery }: { searchQuery: string }) => (
    <div>audits-workspace:{searchQuery}</div>
  ),
}))

vi.mock('../src/reports/AllReportsView', () => ({
  AllReportsView: () => <div>all-reports-view</div>,
}))

describe('Menu', () => {
  it('renders the audits workspace for the audits section', () => {
    render(
      <Menu
        path="/menu/audits"
        onNavigate={vi.fn()}
        onOpenProfile={vi.fn()}
      />,
    )

    expect(screen.getByTestId('nav-bar')).toHaveTextContent('audits')
    expect(screen.getByText('audits-workspace:')).toBeInTheDocument()
  })

  it('renders the reports view for the reports section', () => {
    render(
      <Menu
        path="/menu/reports"
        onNavigate={vi.fn()}
        onOpenProfile={vi.fn()}
      />,
    )

    expect(screen.getByTestId('nav-bar')).toHaveTextContent('reports')
    expect(screen.getByText('all-reports-view')).toBeInTheDocument()
  })
})
