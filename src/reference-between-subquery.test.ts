/**
 * Tests for:
 * 1. & reference operator in filters: &returnTripFor IS NULL
 * 2. BETWEEN operator integration tests
 * 3. count(*) subquery in filter expressions: (drivers {count(*)}) = 0
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
  float,
  manyToOne,
  oneToMany,
} from './schema.js'
import { query } from './query.js'
import { eq, and, ne, gt, lt, gte, lte, between, isNull, isNotNull, or, inList, asc, desc } from './operators.js'
import { ref, subquery, raw } from './expressions.js'
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
  drivers: oneToMany(() => driver),
  trips: oneToMany(() => trip),
})

const driver = entity('driver', 'drivers', {
  id: uuid().primaryKey(),
  name: text(),
  vehicle: manyToOne(() => vehicle, { column: 'vehicle_id' }),
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

const dm = generateDM(store, vehicle, driver, trip)

const ID = {
  s1: 'a0000000-0000-4000-8000-000000000001',
  v1: 'b0000000-0000-4000-8000-000000000001',
  v2: 'b0000000-0000-4000-8000-000000000002',
  v3: 'b0000000-0000-4000-8000-000000000003',
  d1: 'c0000000-0000-4000-8000-000000000001',
  d2: 'c0000000-0000-4000-8000-000000000002',
  t1: 'd0000000-0000-4000-8000-000000000001',
  t2: 'd0000000-0000-4000-8000-000000000002',
  t3: 'd0000000-0000-4000-8000-000000000003',
  t4: 'd0000000-0000-4000-8000-000000000004',
}

const seedSQL = `CREATE TABLE stores (id UUID PRIMARY KEY, name TEXT NOT NULL, enabled BOOLEAN NOT NULL);
CREATE TABLE vehicles (id UUID PRIMARY KEY, make TEXT NOT NULL, model TEXT NOT NULL, active BOOLEAN NOT NULL, store_id UUID REFERENCES stores(id));
CREATE TABLE drivers (id UUID PRIMARY KEY, name TEXT NOT NULL, vehicle_id UUID REFERENCES vehicles(id));
CREATE TABLE trips (id UUID PRIMARY KEY, state TEXT NOT NULL, seats INTEGER NOT NULL, created_at TIMESTAMP NOT NULL, vehicle_id UUID REFERENCES vehicles(id), store_id UUID REFERENCES stores(id), return_trip_for_id UUID REFERENCES trips(id));

INSERT INTO stores (id, name, enabled) VALUES ('${ID.s1}', 'Downtown', true);

INSERT INTO vehicles (id, make, model, active, store_id) VALUES ('${ID.v1}', 'Toyota', 'Camry', true, '${ID.s1}');
INSERT INTO vehicles (id, make, model, active, store_id) VALUES ('${ID.v2}', 'Honda', 'Civic', true, '${ID.s1}');
INSERT INTO vehicles (id, make, model, active, store_id) VALUES ('${ID.v3}', 'Ford', 'F150', false, '${ID.s1}');

INSERT INTO drivers (id, name, vehicle_id) VALUES ('${ID.d1}', 'Alice', '${ID.v1}');
INSERT INTO drivers (id, name, vehicle_id) VALUES ('${ID.d2}', 'Bob', '${ID.v1}');

INSERT INTO trips (id, state, seats, created_at, vehicle_id, store_id, return_trip_for_id) VALUES ('${ID.t1}', 'CONFIRMED', 2, '2024-06-01T10:00:00Z', '${ID.v1}', '${ID.s1}', NULL);
INSERT INTO trips (id, state, seats, created_at, vehicle_id, store_id, return_trip_for_id) VALUES ('${ID.t2}', 'REQUESTED', 3, '2024-06-02T14:00:00Z', NULL, '${ID.s1}', NULL);
INSERT INTO trips (id, state, seats, created_at, vehicle_id, store_id, return_trip_for_id) VALUES ('${ID.t3}', 'COMPLETED', 1, '2024-06-03T08:00:00Z', '${ID.v2}', '${ID.s1}', '${ID.t1}');
INSERT INTO trips (id, state, seats, created_at, vehicle_id, store_id, return_trip_for_id) VALUES ('${ID.t4}', 'CANCELLED', 4, '2024-06-04T16:00:00Z', NULL, '${ID.s1}', '${ID.t2}');
`

// ═══════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════

describe('reference operator (&)', () => {
  before(async () => {
    oql = new OQL_PETRADB(dm)
    await oql.rawMulti(seedSQL)
  })

  it('&returnTripFor IS NULL — trips that are not return trips', async () => {
    const results = await query(oql, trip)
      .select('id', 'state')
      .where(isNull(ref(trip.returnTripFor)))
      .many()

    assert.equal(results.length, 2)
    const ids = results.map((r: any) => r.id).sort()
    assert.deepEqual(ids, [ID.t1, ID.t2].sort())
  })

  it('&returnTripFor IS NOT NULL — trips that are return trips', async () => {
    const results = await query(oql, trip)
      .select('id', 'state')
      .where(isNotNull(ref(trip.returnTripFor)))
      .many()

    assert.equal(results.length, 2)
    const ids = results.map((r: any) => r.id).sort()
    assert.deepEqual(ids, [ID.t3, ID.t4].sort())
  })

  it('combined: &returnTripFor IS NULL OR returnTripFor.state IN (...)', async () => {
    const results = await query(oql, trip)
      .select('id', 'state')
      .where(or(
        isNull(ref(trip.returnTripFor)),
        inList(trip.returnTripFor.state, ['COMPLETED', 'CANCELLED']),
      ))
      .many()

    // t1 (null), t2 (null) match the IS NULL clause
    // t3 (returnTripFor=t1 CONFIRMED — not in list), t4 (returnTripFor=t2 REQUESTED — not in list)
    assert.equal(results.length, 2)
  })

  it('ref() generates correct OQL string', () => {
    const { queryStr } = query(oql, trip)
      .select('id', 'state')
      .where(isNull(ref(trip.returnTripFor)))
      .toOQL()

    assert.ok(queryStr.includes('&returnTripFor IS NULL'), `Expected "&returnTripFor IS NULL" in: ${queryStr}`)
  })

  it('ref() with IS NOT NULL generates correct OQL', () => {
    const { queryStr } = query(oql, trip)
      .select('id')
      .where(and(
        isNull(ref(trip.returnTripFor)),
        inList(trip.returnTripFor.state, ['COMPLETED']),
      ))
      .toOQL()

    assert.ok(queryStr.includes('&returnTripFor IS NULL'), `Expected "&returnTripFor IS NULL" in: ${queryStr}`)
    assert.ok(queryStr.includes('returnTripFor.state IN'), `Expected "returnTripFor.state IN" in: ${queryStr}`)
  })
})

describe('BETWEEN operator', () => {
  before(async () => {
    oql = new OQL_PETRADB(dm)
    await oql.rawMulti(seedSQL)
  })

  it('between on integer field', async () => {
    const results = await query(oql, trip)
      .select('id', 'seats')
      .where(between(trip.seats, 2, 3))
      .many()

    assert.equal(results.length, 2)
    for (const r of results) {
      assert.ok(r.seats >= 2 && r.seats <= 3, `seats ${r.seats} not in [2,3]`)
    }
  })

  it('between on timestamp field', async () => {
    const results = await query(oql, trip)
      .select('id', 'state')
      .where(between(trip.createdAt, '2024-06-01T00:00:00Z' as any, '2024-06-02T23:59:59Z' as any))
      .many()

    assert.equal(results.length, 2)
    const states = results.map((r: any) => r.state).sort()
    assert.deepEqual(states, ['CONFIRMED', 'REQUESTED'])
  })

  it('between combined with other filters', async () => {
    const results = await query(oql, trip)
      .select('id', 'seats', 'state')
      .where(and(
        between(trip.seats, 1, 3),
        ne(trip.state, 'CANCELLED'),
      ))
      .many()

    // t1 (2, CONFIRMED), t2 (3, REQUESTED), t3 (1, COMPLETED) — t4 excluded (CANCELLED)
    assert.equal(results.length, 3)
  })

  it('between generates correct OQL string', () => {
    const { queryStr, params } = query(oql, trip)
      .select('id')
      .where(between(trip.seats, 1, 5))
      .toOQL()

    assert.ok(queryStr.includes('BETWEEN'), `Expected BETWEEN in: ${queryStr}`)
    assert.ok(queryStr.includes('AND'), `Expected AND in: ${queryStr}`)
    assert.equal(params.p0, 1)
    assert.equal(params.p1, 5)
  })
})

describe('count(*) subquery in filters', () => {
  before(async () => {
    oql = new OQL_PETRADB(dm)
    await oql.rawMulti(seedSQL)
  })

  it('subquery generates correct OQL: (drivers {count(*)}) = 0', () => {
    const { queryStr, params } = query(oql, vehicle)
      .select('id', 'make')
      .where(eq(subquery(vehicle.drivers, ['count(*)']), 0))
      .toOQL()

    assert.ok(queryStr.includes('(drivers {count(*)}) = :p0'), `Expected "(drivers {count(*)}) = :p0" in: ${queryStr}`)
    assert.equal(params.p0, 0)
  })

  it('subquery generates correct OQL: (trips {count(*)}) > 0 AND active = true', () => {
    const { queryStr } = query(oql, vehicle)
      .select('id', 'make')
      .where(and(
        gt(subquery(vehicle.trips, ['count(*)']), 0),
        eq(vehicle.active, true),
      ))
      .toOQL()

    assert.ok(queryStr.includes('(trips {count(*)}) > :p0'), `Expected subquery in: ${queryStr}`)
    assert.ok(queryStr.includes('active = :p1'), `Expected active filter in: ${queryStr}`)
  })

  it('subquery with filter generates correct OQL', () => {
    const { queryStr, params } = query(oql, vehicle)
      .select('id')
      .where(eq(subquery(vehicle.trips, ['count(*)'], eq(trip.state, 'CONFIRMED')), 0))
      .toOQL()

    assert.ok(queryStr.includes('(trips {count(*)} [state = :p0]) = :p1'), `Expected filtered subquery in: ${queryStr}`)
    assert.equal(params.p0, 'CONFIRMED')
    assert.equal(params.p1, 0)
  })

  it('vehicles with no drivers: (drivers {count(*)}) = 0', async () => {
    const results = await query(oql, vehicle)
      .select('id', 'make', 'model')
      .where(eq(subquery(vehicle.drivers, ['count(*)']), 0))
      .many()

    // v2 (Honda) and v3 (Ford) have no drivers
    assert.equal(results.length, 2)
    const makes = results.map((r: any) => r.make).sort()
    assert.deepEqual(makes, ['Ford', 'Honda'])
  })

  it('vehicles with drivers: (drivers {count(*)}) > 0', async () => {
    const results = await query(oql, vehicle)
      .select('id', 'make')
      .where(gt(subquery(vehicle.drivers, ['count(*)']), 0))
      .many()

    // v1 (Toyota) has 2 drivers
    assert.equal(results.length, 1)
    assert.equal(results[0].make, 'Toyota')
  })

  it('vehicles with exactly 2 drivers', async () => {
    const results = await query(oql, vehicle)
      .select('id', 'make')
      .where(eq(subquery(vehicle.drivers, ['count(*)']), 2))
      .many()

    assert.equal(results.length, 1)
    assert.equal(results[0].make, 'Toyota')
  })

  it('combined subquery with other filters', async () => {
    // Active vehicles with at least one trip
    const results = await query(oql, vehicle)
      .select('id', 'make')
      .where(and(
        gt(subquery(vehicle.trips, ['count(*)']), 0),
        eq(vehicle.active, true),
      ))
      .many()

    // v1 (Toyota, active, has trips), v2 (Honda, active, has 1 trip)
    assert.equal(results.length, 2)
  })
})
