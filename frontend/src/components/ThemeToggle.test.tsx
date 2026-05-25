import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ThemeToggle } from './ThemeToggle'
import { useCanvasStore } from '../stores/canvasStore'

describe('ThemeToggle', () => {
  beforeEach(() => {
    useCanvasStore.setState({ theme: 'dark' })
    document.documentElement.removeAttribute('data-theme')
  })

  it('renders a labelled button', () => {
    render(<ThemeToggle />)
    expect(screen.getByRole('button', { name: /toggle day\/night/i })).toBeInTheDocument()
  })

  it('syncs data-theme to the current theme on mount', () => {
    render(<ThemeToggle />)
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('click flips the store theme and data-theme', () => {
    render(<ThemeToggle />)
    fireEvent.click(screen.getByRole('button', { name: /toggle day\/night/i }))
    expect(useCanvasStore.getState().theme).toBe('light')
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('applies the passed className', () => {
    render(<ThemeToggle className="my-btn" />)
    expect(screen.getByRole('button', { name: /toggle day\/night/i })).toHaveClass('my-btn')
  })
})
