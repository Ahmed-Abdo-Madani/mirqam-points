/* Live updates for the Points Business app (@capgo/capacitor-updater with a
   self-hosted updateUrl). The app posts what it runs; we answer with the
   current screens bundle (packed at deploy by scripts/pack-live-update.mjs
   and served from /live-update/) or "up to date".
   Bundles only go to store builds >= minNative, so a web change that needs
   new native code never reaches an app that cannot run it. The version name
   is "<native version>+<bundle id>": never below the installed app (the
   plugin refuses that) and unique per bundle. */
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const APP_ID = 'sa.mirqam.points'

function core(version) {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(version || ''))
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

function atLeast(a, b) {
  for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i] > b[i]
  return true
}

// The updater plugin's own "nothing new" answer (read by the app, never shown to people).
const NO_UPDATE = 'no_new_version_available'
const upToDate = (version, message = 'No new version available') => ({ kind: 'up_to_date', error: NO_UPDATE, message, version })

/** Pure decision: what to answer to an update check. */
export function liveUpdateAnswer(manifest, body, origin) {
  const b = body && typeof body === 'object' ? body : {}
  const current = String(b.version_name || '')
  if (b.app_id && b.app_id !== APP_ID) return upToDate(current, 'Unknown app')
  const native = core(b.version_build)
  const min = core(manifest?.minNative)
  if (!manifest?.id || !native || !min || !atLeast(native, min)) return upToDate(current)
  const version = `${native.join('.')}+${manifest.id}`
  if (current === version) return upToDate(current)
  return { version, url: `${origin}/live-update/${manifest.file}`, checksum: manifest.checksum }
}

/** POST /api/mobile/live-update */
export function liveUpdateHandler(config) {
  const file = join(config.webDist, 'live-update', 'manifest.json')
  let cache = { mtime: 0, manifest: null }
  const load = () => {
    try {
      const mtime = statSync(file).mtimeMs
      if (mtime !== cache.mtime) cache = { mtime, manifest: JSON.parse(readFileSync(file, 'utf8')) }
    } catch {
      cache = { mtime: 0, manifest: null }
    }
    return cache.manifest
  }
  return (req, res) => {
    res.set('Cache-Control', 'no-store')
    // The bundle comes from the host the app asked (the app's API host).
    res.json(liveUpdateAnswer(load(), req.body, `${req.protocol}://${req.get('host')}`))
  }
}
