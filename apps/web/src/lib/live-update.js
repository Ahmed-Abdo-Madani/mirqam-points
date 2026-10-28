/* Live updates (Points Business app): the screens are downloaded by
   @capgo/capacitor-updater and applied the next time the app goes to the
   background. The app must confirm each start, or the plugin rolls back to
   the previous screens after 10 s — so a broken update never strands a
   merchant. Nothing happens on the website. */
import { Capacitor, registerPlugin } from '@capacitor/core'

export function confirmAppStarted() {
  if (!Capacitor.isNativePlatform()) return
  try {
    registerPlugin('CapacitorUpdater')
      .notifyAppReady()
      .catch(() => {})
  } catch {
    // An app build without the plugin: nothing to confirm.
  }
}
