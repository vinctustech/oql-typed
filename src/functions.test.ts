/**
 * Tests for function calls in filters, aliased fields, and aggregates in projections.
 *
 * Features:
 * 1. Function calls in filters: concat(make, ' ', model) ILIKE :search
 * 2. Aliased/labeled projection fields: passengers: trips {sum(seats)}
 * 3. Aggregate functions in projections: count(*), sum(seats)
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
  float,
  manyToOne,
  oneToMany,
} from './schema.js'
import { query } from './query.js'
import { eq, and, ne, ilike, asc } from './operators.js'
import { fn, raw } from './expressions.js'
import { generateDM } from './generate-dm.js'

// ── Type helpers ──

type AssertEqual<T, U> = [T] extends [U] ? ([U] extends [T] ? true : false) : false
type AssertTrue<T extends true> = T

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
  year: integer().nullable(),
  enabled: boolean(),
  store: manyToOne(() => store, { column: 'store_id' }),
})

const trip = entity('trip', 'trips', {
  id: uuid().primaryKey(),
  state: text(),
  seats: integer(),
  store: manyToOne(() => store, { column: 'store_id' }),
  vehicle: manyToOne(() => vehicle, { column: 'vehicle_id' }).nullable(),
})

// ── Database setup ──

let oql: OQL_PETRADB

const dm = generateDM(store, vehicle, trip)

const ID = {
  s1: 'a0000000-0000-4000-8000-000000000001',
  v1: 'b0000000-0000-4000-8000-000000000001',
  v2: 'b0000000-0000-4000-8000-000000000002',
  t1: 'c0000000-0000-4000-8000-000000000001',
  t2: 'c0000000-0000-4000-8000-000000000002',
  t3: 'c0000000-0000-4000-8000-000000000003',
}

const seedSQL = `CREATE TABLE stores (id UUID PRIMARY KEY, name TEXT NOT NULL, enabled BOOLEAN NOT NULL);
CREATE TABLE vehicles (id UUID PRIMARY KEY, make TEXT NOT NULL, model TEXT NOT NULL, year INTEGER, enabled BOOLEAN NOT NULL, store_id UUID REFERENCES stores(id));
CREATE TABLE trips (id UUID PRIMARY KEY, state TEXT NOT NULL, seats INTEGER NOT NULL, store_id UUID REFERENCES stores(id), vehicle_id UUID REFERENCES vehicles(id));

INSERT INTO stores (id, name, enabled) VALUES ('${ID.s1}', 'Downtown', true);

INSERT INTO vehicles (id, make, model, year, enabled, store_id) VALUES ('${ID.v1}', 'Toyota', 'Camry', 2022, true, '${ID.s1}');
INSERT INTO vehicles (id, make, model, year, enabled, store_id) VALUES ('${ID.v2}', 'Honda', 'Civic', 2020, false, '${ID.s1}');

INSERT INTO trips (id, state, seats, store_id, vehicle_id) VALUES ('${ID.t1}', 'CONFIRMED', 2, '${ID.s1}', '${ID.v1}');
INSERT INTO trips (id, state, seats, store_id, vehicle_id) VALUES ('${ID.t2}', 'REQUESTED', 3, '${ID.s1}', '${ID.v1}');
INSERT INTO trips (id, state, seats, store_id, vehicle_id) VALUES ('${ID.t3}', 'COMPLETED', 1, '${ID.s1}', '${ID.v2}');
`

// ═══════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════

describe('function calls in filters', () => {
  before(async () => {
    oql = new OQL_PETRADB(dm)
    await oql.rawMulti(seedSQL)
  })

  it('concat() with ILIKE for search', async () => {
    // OQL: vehicle {id make model} [concat(make, ' ', model) ILIKE :search]
    const results = await query(oql, vehicle)
      .select('id', 'make', 'model')
      .where(ilike(fn('concat', vehicle.make, raw("' '"), vehicle.model), '%Toyota Cam%'))
      .many()

    assert.equal(results.length, 1)
    assert.equal(results[0].make, 'Toyota')
  })

  it('lower() in filter', async () => {
    // OQL: vehicle {id make} [lower(make) = :p0]
    const results = await query(oql, vehicle)
      .select('id', 'make')
      .where(eq(fn('lower', vehicle.make), 'toyota'))
      .many()

    assert.equal(results.length, 1)
    assert.equal(results[0].make, 'Toyota')
  })

  it('length() in filter', async () => {
    // OQL: vehicle {id make} [length(make) > 4]
    const results = await query(oql, vehicle)
      .select('id', 'make')
      .where(eq(fn('length', vehicle.make), 6))
      .many()

    assert.equal(results.length, 1)
    assert.equal(results[0].make, 'Toyota')
  })
})

describe('aggregate functions in projections', () => {
  before(async () => {
    oql = new OQL_PETRADB(dm)
    await oql.rawMulti(seedSQL)
  })

  it('sum() in filtered sub-collection', async () => {
    // OQL: store {id name trips {count: sum(seats)} [state != 'COMPLETED']}
    const results = await query(oql, store)
      .select('id', 'name', {
        trips: {
          fields: [raw('count: sum(seats)')],
          where: ne(trip.state, 'COMPLETED'),
        },
      })
      .where(eq(store.id, ID.s1))
      .many()

    assert.equal(results.length, 1)
    assert.equal(results[0].name, 'Downtown')
    // s1 has trips t1 (2 seats, CONFIRMED) and t2 (3 seats, REQUESTED) — sum = 5
    assert.equal(results[0].trips[0].count, 5)
  })
})
