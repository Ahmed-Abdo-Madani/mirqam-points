import { loadConfig } from '../config.js'
import { openDb } from './index.js'
import { migrate } from './migrate.js'

const config = loadConfig()
const db = await openDb(config.databaseUrl)
await migrate(db, { log: console.log })
await db.close()
console.log('[db] up to date')
