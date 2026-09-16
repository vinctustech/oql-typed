/**
 * BACKEND FACTORIES — createPetraDB/createPostgresDB build the OQL backend
 * from the TypeScript schema, so a consumer never constructs one itself.
 */
import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execSync } from 'node:child_process'

import { createPetraDB, createPostgresDB } from './backends.js'
import type { DB } from './db.js'
import { eq } from './operators.js'
import { defineSchema, entity, uuid, text, manyToOne } from './schema.js'
import { schema, seedDatabase, ID } from './test-schema.js'

// A connection to nowhere: OQL_PG builds its pool lazily, so the constructor
// never reaches the network and these tests need no database.
const unreachable = {
  host: '127.0.0.1',
  port: 1,
  database: 'oql_typed_no_such_database',
  user: 'nobody',
  password: 'nothing',
}

describe('createPetraDB', () => {
  let db: DB<typeof schema>

  before(async () => {
    db = createPetraDB(schema)
    await seedDatabase(db)
  })

  it('returns a handle that queries the seeded data', async () => {
    const rows = await db.store.select('id', 'name').many()
    assert.deepStrictEqual(rows.map((store) => store.name).sort(), ['Airport', 'Downtown'])
  })

  it('returns a handle that follows relations', async () => {
    const trip = await db.trip.select('id', { store: ['name'] }).where(eq(db.trip.id, ID.t1)).one()
    assert.ok(trip)
    assert.equal(trip.store.name, 'Downtown')
  })

  it('returns a handle that writes', async () => {
    const inserted = await db.place.insert({ latitude: 1.5, longitude: 2.5, address: 'Factory St' })
    const found = await db.place.select('id', 'address').where(eq(db.place.id, inserted.id)).one()
    assert.ok(found)
    assert.equal(found.address, 'Factory St')
  })

  it('defaults to the AST engine and honours an explicit one', () => {
    assert.equal(createPetraDB(schema).__engine, 'ast')
    assert.equal(createPetraDB(schema, { engine: 'string' }).__engine, 'string')
  })

  it('close() is a no-op on a backend that holds nothing open', async () => {
    const closeable = createPetraDB(schema)
    await seedDatabase(closeable)
    closeable.close()
    const rows = await closeable.store.select('id').many()
    assert.equal(rows.length, 2)
  })

  it('rejects a schema whose relation points nowhere', () => {
    const broken = defineSchema({
      widget: entity({ id: uuid().primaryKey(), owner: manyToOne('nosuch', { column: 'owner_id' }) }),
    })
    assert.throws(() => createPetraDB(broken))
  })
})

describe('createPostgresDB', () => {
  it('constructs a handle without opening a connection', () => {
    const db = createPostgresDB(schema, unreachable)
    assert.equal(db.__engine, 'ast')
    assert.equal(typeof db.trip.select, 'function')
    assert.equal(typeof db.trip.insert, 'function')
    assert.equal(typeof db.transaction, 'function')
    assert.equal(typeof db.raw, 'function')
    db.close()
  })

  it('passes the generated data model to the backend', () => {
    // OQL_PG validates the model in its constructor, so a schema that
    // generates a bad model is rejected before any query runs.
    const broken = defineSchema({
      widget: entity({ id: uuid().primaryKey(), owner: manyToOne('nosuch', { column: 'owner_id' }) }),
    })
    assert.throws(() => createPostgresDB(broken, unreachable))
    const sound = defineSchema({
      widget: entity('widgets', { id: uuid().primaryKey(), name: text(), owner: manyToOne('person', { column: 'owner_id' }) }),
      person: entity('people', { id: uuid().primaryKey() }),
    })
    createPostgresDB(sound, unreachable).close()
  })

  it('honours an explicit engine', () => {
    const db = createPostgresDB(schema, unreachable, { engine: 'string' })
    assert.equal(db.__engine, 'string')
    db.close()
  })

  it('accepts the optional pool settings', () => {
    const db = createPostgresDB(schema, { ...unreachable, ssl: { rejectUnauthorized: false }, idleTimeoutMillis: 1000, max: 3 })
    assert.equal(typeof db.close, 'function')
    db.close()
  })
})

// ══════════════════════════════════════════════════════════════════════
// A consumer project compiles against the library under --strict. The
// optional petradb peer is the reason this matters most: createPetraDB types
// its constructor structurally, so the emitted declarations must never name
// @vinctus/oql-petradb — a consumer that skips the optional peer would have
// nothing to resolve it to.
// ══════════════════════════════════════════════════════════════════════

const consumerSource = `
import {
  createPetraDB,
  createPostgresDB,
  defineSchema,
  desc,
  entity,
  eq,
  integer,
  manyToOne,
  oneToMany,
  text,
  timestamp,
  uuid,
} from '@vinctus/oql-typed'

const schema = defineSchema({
  account: entity('accounts', {
    id: uuid().primaryKey(),
    name: text(),
    users: oneToMany('user'),
  }),
  user: entity('users', {
    id: uuid().primaryKey(),
    firstName: text().column('first_name'),
    loginCount: integer(),
    lastLoginAt: timestamp().column('last_login_at').nullable(),
    account: manyToOne('account', { column: 'account_id' }),
  }),
})

const db = createPostgresDB(schema, {
  host: 'localhost',
  port: 5432,
  database: 'app',
  user: 'app',
  password: 'secret',
})

const memory = createPetraDB(schema)

export async function report(): Promise<string> {
  const rows = await db.user
    .select('id', 'firstName', { account: ['name'] })
    .where(eq(db.user.firstName, 'Alice'))
    .orderBy(desc(db.user.lastLoginAt))
    .many()
  const inserted = await memory.account.insert({ name: 'Acme' })
  const accountName: string = rows.length > 0 ? rows[0].account.name : inserted.name
  db.close()
  return accountName
}
`

describe('consumer compilation', () => {
  it('a strict consumer project typechecks against the library', () => {
    const packageRoot = process.cwd()
    const dir = mkdtempSync(join(tmpdir(), 'oql-typed-consumer-'))
    try {
      const file = join(dir, 'consumer.ts')
      writeFileSync(file, consumerSource)
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ type: 'module' }))
      const tsconfig = {
        compilerOptions: {
          target: 'ES2022',
          module: 'Node16',
          moduleResolution: 'Node16',
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
          noEmit: true,
          baseUrl: packageRoot,
          paths: { '@vinctus/oql-typed': ['src/index.ts'] },
          // The library is compiled from source here, and its backend
          // factories reach for node:module.
          typeRoots: [join(packageRoot, 'node_modules', '@types')],
          types: ['node'],
        },
        include: [file],
      }
      const tsconfigPath = join(dir, 'tsconfig.json')
      writeFileSync(tsconfigPath, JSON.stringify(tsconfig, null, 2))

      try {
        execSync(`npx tsc --project ${tsconfigPath}`, { encoding: 'utf-8', stdio: 'pipe' })
      } catch (error: any) {
        const output = (error.stdout || '') + (error.stderr || '')
        assert.fail(`Consumer failed to compile under --strict:\n${output}`)
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('emits declarations that never name the optional petradb peer', () => {
    const packageRoot = process.cwd()
    const outDir = mkdtempSync(join(tmpdir(), 'oql-typed-declarations-'))
    try {
      execSync(
        `npx tsc --project ${join(packageRoot, 'tsconfig.json')} --emitDeclarationOnly --declarationMap false --outDir ${outDir}`,
        { encoding: 'utf-8', stdio: 'pipe' },
      )
      const declarations = readdirSync(outDir).filter((name) => name.endsWith('.d.ts'))
      assert.ok(declarations.length > 0, 'no declarations were emitted')
      for (const name of declarations) {
        const declaration = readFileSync(join(outDir, name), 'utf-8')
        assert.ok(
          !declaration.includes('@vinctus/oql-petradb'),
          `${name} names the optional peer dependency`,
        )
      }
    } finally {
      rmSync(outDir, { recursive: true, force: true })
    }
  })
})
