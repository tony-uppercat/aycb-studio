/** Escape HTML special characters for safe innerHTML rendering */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Syntax-highlight a JSON string with inline color spans (keys, strings, bools, numbers, hex swatches) */
export function colorizeJson(json: string): string {
  const safe = escapeHtml(json)
  let depth = 0
  const keyCount: number[] = [0]
  return safe.replace(
    /([{}[\]])|(&quot;(?:\\.|[^&]|&(?!quot;))*?&quot;)\s*(:)?|(\b(?:true|false|null)\b)|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
    (match, bracket, str, colon, bool, num) => {
      if (bracket) {
        if (bracket === '{' || bracket === '[') { depth++; keyCount[depth] = 0 }
        if (bracket === '}' || bracket === ']') depth--
        return match
      }
      if (str && colon) keyCount[depth] = (keyCount[depth] ?? 0) + 1
      const idx = keyCount[depth] ?? 0
      const base = depth <= 1 ? (idx % 2 === 0 ? 1 : 0.6) : (idx % 2 === 0 ? 0.9 : 0.55)
      if (str && colon) return `<span style="color:#a855f7;opacity:${base}">${str}</span>:`
      if (str) {
        const hexMatch = str.match(/&quot;(#(?:[0-9a-fA-F]{3,4}){1,2})&quot;/)
        if (hexMatch) {
          const hex = hexMatch[1]
          return `<span style="color:#f59e0b;opacity:${base}">${str}</span><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${hex};margin-left:3px;vertical-align:middle;border:1px solid rgba(255,255,255,0.2)"></span>`
        }
        return `<span style="color:#f59e0b;opacity:${base}">${str}</span>`
      }
      if (bool) return `<span style="color:#3b82f6;opacity:${base}">${match}</span>`
      if (num) return `<span style="color:#22c55e;opacity:${base}">${match}</span>`
      return match
    }
  )
}
