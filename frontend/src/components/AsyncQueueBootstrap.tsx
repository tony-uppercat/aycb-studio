import { useEffect, useRef } from 'react'
import { useSettings } from './SettingsContext'
import { configurePoller, startAsyncJobPoller } from '../services/asyncJobPoller'
import { configureBundler } from '../services/asyncBundler'

/** Wires the async batch queue (poller + bundler) to the live Gemini + OpenAI API keys and starts the background poller. Renders nothing. */
export function AsyncQueueBootstrap() {
  const settings = useSettings()
  const geminiKeyRef = useRef('')
  const openaiKeyRef = useRef('')
  geminiKeyRef.current = settings.apiKey ?? ''
  openaiKeyRef.current = settings.openaiApiKey ?? ''
  useEffect(() => {
    const getKey = (p: 'gemini' | 'openai') => p === 'openai' ? openaiKeyRef.current : geminiKeyRef.current
    configureBundler(getKey)
    configurePoller(getKey)
    startAsyncJobPoller()
  }, [])
  return null
}
