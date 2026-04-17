import { Dispatch, MutableRefObject, SetStateAction, useEffect, useRef, useState } from 'react'

/**
 * A useState whose current value is always readable from a ref — for
 * dodging stale closures inside long-lived callbacks without scattering
 * six mirror-ref blocks across the top of a hook.
 *
 * Replaces the v2 audit M8 pattern:
 *   const [x, setX] = useState(initial)
 *   const xRef = useRef(x)
 *   useEffect(() => { xRef.current = x }, [x])
 *
 * with a single line:
 *   const [x, setX, xRef] = useStateRef(initial)
 */
export function useStateRef<T>(initial: T | (() => T)): [
  T,
  Dispatch<SetStateAction<T>>,
  MutableRefObject<T>,
] {
  const [value, setValue] = useState(initial)
  const ref = useRef(value)
  useEffect(() => { ref.current = value }, [value])
  return [value, setValue, ref]
}
