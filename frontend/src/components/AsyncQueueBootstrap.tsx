import { useEffect, useRef } from 'react'
import { useSettings } from './SettingsContext'
import { configurePoller, startAsyncJobPoller } from '../services/asyncJobPoller'
import { configureBundler } from '../services/asyncBundler'

/** Wires the async batch queue (poller + bundler) to the live Gemini API key and starts the background poller. Renders nothing. */
export function AsyncQueueBootstrap() {
  const settings = useSettings()
  const keyRef = useRef('')
  keyRef.current = settings.apiKey ?? ''
  useEffect(() => {
    const getKey = () => keyRef.current
    configureBundler(getKey)
    configurePoller(getKey)
    startAsyncJobPoller()
  }, [])
  return null
}
