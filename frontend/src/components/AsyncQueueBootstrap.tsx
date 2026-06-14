import { useEffect, useRef } from 'react'
import { useSettings } from './SettingsContext'
import { configurePoller, startAsyncJobPoller } from '../services/asyncJobPoller'

/** Wires the async batch queue poller to the live Gemini + OpenAI API keys and starts the background poller. The bundler now carries the key on each request, so only the poller needs the getter (for post-reload recovery). Renders nothing. */
export function AsyncQueueBootstrap() {
  const settings = useSettings()
  const geminiKeyRef = useRef('')
  const openaiKeyRef = useRef('')
  geminiKeyRef.current = settings.apiKey ?? ''
  openaiKeyRef.current = settings.openaiApiKey ?? ''
  useEffect(() => {
    const getKey = (p: 'gemini' | 'openai') => p === 'openai' ? openaiKeyRef.current : geminiKeyRef.current
    configurePoller(getKey)
    startAsyncJobPoller()
  }, [])
  return null
}
