/** Deep-merges dictionary fragments (later fragments win on leaf conflicts). */
export function mergeDict(...parts) {
  const out = {}
  for (const part of parts) {
    for (const [k, v] of Object.entries(part)) {
      out[k] = v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' ? mergeDict(out[k], v) : v
    }
  }
  return out
}
