/**
 * BACKEND FACTORIES — createPetraDB/createPostgresDB build the OQL backend
 * from the TypeScript schema, so a consumer never constructs one itself.
 */
import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'

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
