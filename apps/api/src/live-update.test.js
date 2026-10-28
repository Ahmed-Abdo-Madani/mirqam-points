import { describe, expect, it } from 'vitest'
import { liveUpdateAnswer } from './live-update.js'

const manifest = { id: 'abc123def456', checksum: 'f'.repeat(64), file: 'points-abc123def456.zip', minNative: '1.1.0' }
const origin = 'https://mirqam-points.onrender.com'
const ask = (body) => liveUpdateAnswer(manifest, { app_id: 'sa.mirqam.points', ...body }, origin)

describe('live updates for the Points Business app', () => {
  it('offers the current bundle to a compatible store build, named above its native version', () => {
    expect(ask({ version_build: '1.1.0', version_name: 'builtin' })).toEqual({
      version: '1.1.0+abc123def456',
      url: `${origin}/live-update/points-abc123def456.zip`,
      checksum: manifest.checksum,
    })
    expect(ask({ version_build: '1.2.3', version_name: '1.2.3+old' }).version).toBe('1.2.3+abc123def456')
  })

  it('answers up to date when the phone runs it already or cannot run it', () => {
    expect(ask({ version_build: '1.1.0', version_name: '1.1.0+abc123def456' }).kind).toBe('up_to_date')
    expect(ask({ version_build: '1.0.9', version_name: 'builtin' }).kind).toBe('up_to_date')
    expect(ask({ version_build: 'garbage' }).kind).toBe('up_to_date')
    expect(liveUpdateAnswer(null, { version_build: '1.1.0' }, origin).kind).toBe('up_to_date')
    expect(liveUpdateAnswer(manifest, { app_id: 'com.other.app', version_build: '1.1.0' }, origin).kind).toBe('up_to_date')
  })
})
