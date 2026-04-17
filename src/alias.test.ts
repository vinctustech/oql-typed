/**
 * Tests for aliased projections:
 * - alias('label', field) → label: (field.name)
 * - alias('label', fn(...)) → label: (fn(...))
 * - alias combined with filtered sub-collections
 */

import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import { OQL_PETRADB } from '@vinctus/oql-petradb'
import {
  entity,
  uuid,
  text,
  integer,
  boolean_ as boolean,
  timestamp,
  manyToOne,
  oneToMany,
} from './schema.js'
import { query } from './query.js'
import { eq, ne, and, inList } from './operators.js'
import { alias, raw, fn } from './expressions.js'
import { generateDM } from './generate-dm.js'

// ── Schema ──

const store = entity('store', 'stores', {
  id: uuid().primaryKey(),
  name: text(),
  enabled: boolean(),
  vehicles: oneToMany(() => vehicle),
  trips: oneToMany(() => trip),
})

const vehicle = entity('vehicle', 'vehicles', {
  id: uuid().primaryKey(),
  make: text(),
  model: text(),
  active: boolean(),
  store: manyToOne(() => store, { column: 'store_id' }),
  trips: oneToMany(() => trip),
})

const trip = entity('trip', 'trips', {
  id: uuid().primaryKey(),
  state: text(),
  seats: integer(),
  createdAt: timestamp().column('created_at'),
  vehicle: manyToOne(() => vehicle, { column: 'vehicle_id' }).nullable(),
  store: manyToOne(() => store, { column: 'store_id' }),
  returnTripFor: manyToOne(() => trip, { column: 'return_trip_for_id' }).nullable(),
})

// ── Database setup ──

let oql: OQL_PETRADB

const dm = generateDM(store, vehicle, trip)

const ID = {
  s1: 'a0000000-0000-4000-8000-000000000001',
  v1: 'b0000000-0000-4000-8000-000000000001',
  t1: 'c0000000-0000-4000-8000-000000000001',
  t2: 'c0000000-0000-4000-8000-000000000002',
  t3: 'c0000000-0000-4000-8000-000000000003',
  t4: 'c0000000-0000-4000-8000-000000000004',
}

const seedSQL = `CREATE TABLE stores (id UUID PRIMARY KEY, name TEXT NOT NULL, enabled BOOLEAN NOT NULL);
CREATE TABLE vehicles (id UUID PRIMARY KEY, make TEXT NOT NULL, model TEXT NOT NULL, active BOOLEAN NOT NULL, store_id UUID REFERENCES stores(id));
CREATE TABLE trips (id UUID PRIMARY KEY, state TEXT NOT NULL, seats INTEGER NOT NULL, created_at TIMESTAMP NOT NULL, vehicle_id UUID REFERENCES vehicles(id), store_id UUID REFERENCES stores(id), return_trip_for_id UUID REFERENCES trips(id));

INSERT INTO stores (id, name, enabled) VALUES ('${ID.s1}', 'Downtown', true);
INSERT INTO vehicles (id, make, model, active, store_id) VALUES ('${ID.v1}', 'Toyota', 'Camry', true, '${ID.s1}');

INSERT INTO trips (id, state, seats, created_at, vehicle_id, store_id, return_trip_for_id) VALUES ('${ID.t1}', 'CONFIRMED', 2, '2024-06-01T10:00:00Z', '${ID.v1}', '${ID.s1}', NULL);
INSERT INTO trips (id, state, seats, created_at, vehicle_id, store_id, return_trip_for_id) VALUES ('${ID.t2}', 'REQUESTED', 3, '2024-06-02T14:00:00Z', '${ID.v1}', '${ID.s1}', '${ID.t1}');
INSERT INTO trips (id, state, seats, created_at, vehicle_id, store_id, return_trip_for_id) VALUES ('${ID.t3}', 'COMPLETED', 1, '2024-06-03T08:00:00Z', NULL, '${ID.s1}', NULL);
INSERT INTO trips (id, state, seats, created_at, vehicle_id, store_id, return_trip_for_id) VALUES ('${ID.t4}', 'CANCELLED', 4, '2024-06-04T16:00:00Z', NULL, '${ID.s1}', NULL);
`

// ═══════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════

describe('aliased projections', () => {
  before(async () => {
    oql = new OQL_PETRADB(dm)
    await oql.rawMulti(seedSQL)
  })

  it('alias a dotted FK field: returnTripId: (returnTripFor.id)', async () => {
    const { queryStr } = query(oql, trip)
      .select('id', 'state', alias('returnTripId', trip.returnTripFor.id))
      .toOQL()

    assert.ok(queryStr.includes('returnTripId: (returnTripFor.id)'), `Expected alias in: ${queryStr}`)
  })

  it('alias a dotted FK field executes correctly', async () => {
    const results = await query(oql, trip)
      .select('id', 'state', alias('returnTripId', trip.returnTripFor.id))
      .many()

    // t2 has returnTripFor = t1
    const t2 = results.find((r: any) => r.id === ID.t2)
    assert.ok(t2)
    assert.equal((t2 as any).returnTripId, ID.t1)

    // t1 has no returnTripFor
    const t1 = results.find((r: any) => r.id === ID.t1)
    assert.ok(t1)
    assert.equal((t1 as any).returnTripId, null)
  })

  it('alias with raw aggregate: passengers: trips {count: sum(seats)}', () => {
    // This mimics the production pattern:
    // vehicle { id make passengers: trips {count: sum(seats)} [state != 'COMPLETED'] }
    const { queryStr } = query(oql, vehicle)
      .select('id', 'make', {
        trips: {
          fields: [raw('count: sum(seats)')],
          where: and(ne(trip.state, 'COMPLETED'), ne(trip.state, 'CANCELLED')),
        },
      })
      .toOQL()

    assert.ok(queryStr.includes('trips {count: sum(seats)}'), `Expected aggregate in: ${queryStr}`)
    assert.ok(queryStr.includes('state != :p0'), `Expected filter in: ${queryStr}`)
  })

  it('alias with raw aggregate executes correctly', async () => {
    const results = await query(oql, vehicle)
      .select('id', 'make', {
        trips: {
          fields: [raw('count: sum(seats)')],
          where: and(ne(trip.state, 'COMPLETED'), ne(trip.state, 'CANCELLED')),
        },
      })
      .many()

    // v1 has t1 (CONFIRMED, 2 seats) and t2 (REQUESTED, 3 seats) = sum 5
    assert.equal(results.length, 1)
    const trips = (results[0] as any).trips
    assert.ok(Array.isArray(trips))
    assert.equal(trips[0].count, 5)
  })

  it('alias a store field on nested relation', () => {
    const { queryStr } = query(oql, trip)
      .select('id', alias('storeName', trip.store.name))
      .toOQL()

    assert.ok(queryStr.includes('storeName: (store.name)'), `Expected alias in: ${queryStr}`)
  })

  it('alias a store field executes correctly', async () => {
    const results = await query(oql, trip)
      .select('id', alias('storeName', trip.store.name))
      .many()

    for (const r of results) {
      assert.equal((r as any).storeName, 'Downtown')
    }
  })

  it('multiple aliases in one query', () => {
    const { queryStr } = query(oql, trip)
      .select(
        'id',
        alias('returnTripId', trip.returnTripFor.id),
        alias('storeName', trip.store.name),
        alias('vehicleMake', trip.vehicle.make),
      )
      .toOQL()

    assert.ok(queryStr.includes('returnTripId: (returnTripFor.id)'))
    assert.ok(queryStr.includes('storeName: (store.name)'))
    assert.ok(queryStr.includes('vehicleMake: (vehicle.make)'))
  })
})
