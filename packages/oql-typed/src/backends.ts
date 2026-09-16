// Backend factories — the normal way to get a `DB`. Each one turns the
// TypeScript schema into a `.dm` data model and constructs the OQL backend, so
// consumers never touch an OQL package directly.

import { createRequire } from 'node:module'
import { OQL_PG } from '@vinctus/oql-pg'
import { typedOQL } from './db.js'
import type { DB, Engine, OQLInstance } from './db.js'
// Query starters register themselves with db.ts on load, so the factories
// pull the module in rather than relying on the caller having imported it.
import './query.js'
import { generateDM } from './generate-dm.js'
import type { Schema } from './types.js'

export interface PostgresConnection {
  host: string
  port: number
  database: string
  user: string
  password: string
  ssl?: boolean | Record<string, unknown>
  idleTimeoutMillis?: number
  max?: number
}

export interface PostgresOptions {
  engine?: Engine
}

export function createPostgresDB<S extends Schema>(
  schema: S,
  connection: PostgresConnection,
  options?: PostgresOptions,
): DB<S> {
  const instance = new OQL_PG(
    generateDM(schema),
    connection.host,
    connection.port,
    connection.database,
    connection.user,
    connection.password,
    connection.ssl ?? false,
    connection.idleTimeoutMillis ?? 7200000,
    connection.max ?? 10,
  )
  return typedOQL(instance, schema, options)
}

export type PetraStorage = 'memory' | 'persistent' | 'text'

export interface PetraOptions {
  storage?: PetraStorage
  path?: string
  engine?: Engine
}

// Structural, so the emitted declarations never reference @vinctus/oql-petradb —
// consumers that skip the optional peer dependency still typecheck.
type PetraConstructor = new (dm: string, storage?: PetraStorage, path?: string) => OQLInstance

export function createPetraDB<S extends Schema>(schema: S, options?: PetraOptions): DB<S> {
  // petradb is an optional peer and ships as CommonJS, so it is required
  // on demand rather than imported — an `import` would make the whole
  // package fail to load for consumers that never install it.
  const nodeRequire = createRequire(import.meta.url)
  let petraModule: { OQL_PETRADB: PetraConstructor }
  try {
    petraModule = nodeRequire('@vinctus/oql-petradb') as { OQL_PETRADB: PetraConstructor }
  } catch {
    throw new Error(
      "oql-typed: createPetraDB needs the optional peer dependency '@vinctus/oql-petradb'. Install it with `npm install @vinctus/oql-petradb`.",
    )
  }
  const instance = new petraModule.OQL_PETRADB(generateDM(schema), options?.storage, options?.path)
  return typedOQL(instance, schema, options)
}
