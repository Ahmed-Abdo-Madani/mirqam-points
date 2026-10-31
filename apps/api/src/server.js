/* Process entry point (Dockerfile CMD, verify gate, `npm start`). Picks the
   runtime mode (runtime-mode.js) before anything touches the database:
   forward → forwarder.js, standby → standby.js, live/read-only → main.js. */
import { loadConfig } from './config.js'
import { runtimeMode } from './runtime-mode.js'

const mode = runtimeMode(process.env)

if (mode.kind === 'forward') {
  const { createForwarder } = await import('./forwarder.js')
  const config = loadConfig({ ...process.env, DATABASE_URL: process.env.DATABASE_URL || 'memory://' })
  const server = createForwarder({ upstream: mode.upstream, secretKey: config.secretKey, trustProxy: config.trustProxy })
  server.listen(config.port, () => {
    console.log(
      `[launch] forwarding every request on port ${server.address().port} to ${mode.upstream}${config.secretKey ? '' : ' (no SECRET_KEY: client addresses are not signed)'}`,
    )
  })
  const stop = () => server.close(() => process.exit(0))
  process.on('SIGTERM', stop)
  process.on('SIGINT', stop)
} else if (mode.kind === 'standby') {
  const { startStandby } = await import('./standby.js')
  const { VERSION } = await import('./app.js')
  await startStandby({ port: Number(process.env.PORT || 4100), version: VERSION })
} else {
  const { startServer } = await import('./main.js')
  await startServer({ readOnly: mode.readOnly })
}
