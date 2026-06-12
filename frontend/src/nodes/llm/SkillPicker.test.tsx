import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { SkillPicker } from './SkillPicker'
import { api } from '../../api'

describe('SkillPicker', () => {
  beforeEach(() => {
    vi.spyOn(api, 'listSkills').mockResolvedValue({
      skills: [
        { name: 'caveman', description: 'Talk short.', source: 'caveman' },
        { name: 'react-patterns', description: 'React 19.', source: 'sp' },
      ],
    })
  })

  it('renders fetched skills and toggles selection', async () => {
    const onChange = vi.fn()
    render(<SkillPicker value={['caveman']} onChange={onChange} />)
    await waitFor(() => screen.getByText('react-patterns'))
    fireEvent.click(screen.getByLabelText('react-patterns'))
    expect(onChange).toHaveBeenCalledWith(['caveman', 'react-patterns'])
  })

  it('unchecks a selected skill', async () => {
    const onChange = vi.fn()
    render(<SkillPicker value={['caveman']} onChange={onChange} />)
    await waitFor(() => screen.getByLabelText('caveman'))
    fireEvent.click(screen.getByLabelText('caveman'))
    expect(onChange).toHaveBeenCalledWith([])
  })
})
