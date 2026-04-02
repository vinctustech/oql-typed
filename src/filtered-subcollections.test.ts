/**
 * Tests for filtered sub-collections — inline WHERE and ORDER BY on nested relations.
 *
 * OQL supports filtering nested collections:
 *   trip { steps {id name place {id}} [type = 'place' AND finishedAt IS NULL] <position> }
 *
 * oql-typed needs to support this in the .select() projection syntax.
 * Proposed API:
 *   query(oql, trip).select('id', {
 *     steps: { fields: ['id', 'name', { place: ['id'] }], where: and(eq(step.type, 'place'), isNull(step.finishedAt)), orderBy: [asc(step.position)] }
 *   })
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
  manyToMany,
  enumType,
} from './schema.js'
import { query } from './query.js'
import { eq, ne, and, isNull, isNotNull, inList, asc, desc } from './operators.js'
import type { FilterExpr, OrderExpr } from './operators.js'
import { generateDM } from './generate-dm.js'

// ── Type helpers ──

type AssertEqual<T, U> = [T] extends [U] ? ([U] extends [T] ? true : false) : false
type AssertTrue<T extends true> = T

// ── Schema ──

type StepType = 'place' | 'pickup' | 'dropoff'

const place = entity('place', 'places', {
  id: uuid().primaryKey(),
  address: text(),
  latitude: float(),
  longitude: float(),
})

const store = entity('store', 'stores', {
  id: uuid().primaryKey(),
  name: text(),
  enabled: boolean(),
  trips: oneToMany(() => trip),
})

const trip = entity('trip', 'trips', {
  id: uuid().primaryKey(),
  state: text(),
  seats: integer(),
  store: manyToOne(() => store, { column: 'store_id' }),
  steps: oneToMany(() => step),
})

const step = entity('step', 'steps', {
  id: uuid().primaryKey(),
  type: enumType<StepType>('StepType', ['place', 'pickup', 'dropoff']),
  name: text(),
  position: integer(),
  finishedAt: timestamp().column('finished_at').nullable(),
  trip: manyToOne(() => trip, { column: 'trip_id' }),
  place: manyToOne(() => place, { column: 'place_id' }).nullable(),
})

// ── Database setup ──

let oql: OQL_PETRADB

const dm = generateDM(place, store, trip, step)

const ID = {
  p1: 'a0000000-0000-4000-8000-000000000001',
  p2: 'a0000000-0000-4000-8000-000000000002',
  s1: 'b0000000-0000-4000-8000-000000000001',
  t1: 'c0000000-0000-4000-8000-000000000001',
  t2: 'c0000000-0000-4000-8000-000000000002',
  st1: 'd0000000-0000-4000-8000-000000000001',
  st2: 'd0000000-0000-4000-8000-000000000002',
  st3: 'd0000000-0000-4000-8000-000000000003',
  st4: 'd0000000-0000-4000-8000-000000000004',
  st5: 'd0000000-0000-4000-8000-000000000005',
}

const seedSQL = `CREATE TABLE places (id UUID PRIMARY KEY, address TEXT NOT NULL, latitude DOUBLE NOT NULL, longitude DOUBLE NOT NULL);
CREATE TABLE stores (id UUID PRIMARY KEY, name TEXT NOT NULL, enabled BOOLEAN NOT NULL);
CREATE TABLE trips (id UUID PRIMARY KEY, state TEXT NOT NULL, seats INTEGER NOT NULL, store_id UUID REFERENCES stores(id));
CREATE TABLE steps (id UUID PRIMARY KEY, "type" TEXT NOT NULL, name TEXT NOT NULL, position INTEGER NOT NULL, finished_at TIMESTAMP, trip_id UUID REFERENCES trips(id), place_id UUID REFERENCES places(id));

INSERT INTO places (id, address, latitude, longitude) VALUES ('${ID.p1}', '123 Main St', 45.5, -73.6);
INSERT INTO places (id, address, latitude, longitude) VALUES ('${ID.p2}', '456 Oak Ave', 45.6, -73.7);

INSERT INTO stores (id, name, enabled) VALUES ('${ID.s1}', 'Downtown', true);

INSERT INTO trips (id, state, seats, store_id) VALUES ('${ID.t1}', 'CONFIRMED', 2, '${ID.s1}');
INSERT INTO trips (id, state, seats, store_id) VALUES ('${ID.t2}', 'COMPLETED', 1, '${ID.s1}');

INSERT INTO steps (id, "type", name, position, finished_at, trip_id, place_id) VALUES
  ('${ID.st1}', 'place', 'Start', 1, NULL, '${ID.t1}', '${ID.p1}');
INSERT INTO steps (id, "type", name, position, finished_at, trip_id, place_id) VALUES
  ('${ID.st2}', 'pickup', 'Pickup Alice', 2, NULL, '${ID.t1}', NULL);
INSERT INTO steps (id, "type", name, position, finished_at, trip_id, place_id) VALUES
  ('${ID.st3}', 'place', 'End', 3, '2024-06-01T12:00:00Z', '${ID.t1}', '${ID.p2}');
INSERT INTO steps (id, "type", name, position, finished_at, trip_id, place_id) VALUES
  ('${ID.st4}', 'place', 'Start', 1, '2024-06-01T10:00:00Z', '${ID.t2}', '${ID.p1}');
INSERT INTO steps (id, "type", name, position, finished_at, trip_id, place_id) VALUES
  ('${ID.st5}', 'place', 'End', 2, '2024-06-01T11:00:00Z', '${ID.t2}', '${ID.p2}');
`

// ═══════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════

describe('filtered sub-collections', () => {
  before(async () => {
    oql = new OQL_PETRADB(dm)
    await oql.rawMulti(seedSQL)
  })

  it('filter nested oneToMany by field value', async () => {
    // Get trip with only "place" type steps
    // OQL: trip {id steps {id name} [type = 'place']} [id = :t1]
    const result = await query(oql, trip)
      .select('id', {
        steps: {
          fields: ['id', 'name'],
          where: eq(step.type, 'place'),
        },
      })
      .where(eq(trip.id, ID.t1))
      .one()

    assert.ok(result)
    assert.equal(result.steps.length, 2) // st1 (place, not finished) and st3 (place, finished)
    for (const s of result.steps) {
      assert.ok('id' in s)
      assert.ok('name' in s)
    }
  })

  it('filter nested with IS NULL', async () => {
    // Get trip with only unfinished place-type steps
    // OQL: trip {id steps {id name position} [type = 'place' AND finishedAt IS NULL]} [id = :t1]
    const result = await query(oql, trip)
      .select('id', {
        steps: {
          fields: ['id', 'name', 'position'],
          where: and(eq(step.type, 'place'), isNull(step.finishedAt)),
        },
      })
      .where(eq(trip.id, ID.t1))
      .one()

    assert.ok(result)
    assert.equal(result.steps.length, 1) // Only st1 — place type AND not finished
    assert.equal(result.steps[0].name, 'Start')
  })

  it('order nested sub-collection', async () => {
    // Get trip with steps ordered by position descending
    // OQL: trip {id steps {id name position} <position DESC>} [id = :t1]
    const result = await query(oql, trip)
      .select('id', {
        steps: {
          fields: ['id', 'name', 'position'],
          orderBy: [desc(step.position)],
        },
      })
      .where(eq(trip.id, ID.t1))
      .one()

    assert.ok(result)
    assert.equal(result.steps.length, 3)
    assert.equal(result.steps[0].position, 3) // Highest position first
    assert.equal(result.steps[1].position, 2)
    assert.equal(result.steps[2].position, 1)
  })

  it('filter AND order nested sub-collection', async () => {
    // OQL: trip {id steps {id name position place {id latitude longitude}} [type = 'place' AND finishedAt IS NULL] <position>} [id = :t1]
    const result = await query(oql, trip)
      .select('id', {
        steps: {
          fields: ['id', 'name', 'position', { place: ['id', 'latitude', 'longitude'] }],
          where: and(eq(step.type, 'place'), isNull(step.finishedAt)),
          orderBy: [asc(step.position)],
        },
      })
      .where(eq(trip.id, ID.t1))
      .one()

    assert.ok(result)
    assert.equal(result.steps.length, 1)
    assert.equal(result.steps[0].name, 'Start')
    assert.equal(result.steps[0].position, 1)
    assert.ok(result.steps[0].place)
    assert.equal(result.steps[0].place?.address, undefined) // not projected
    assert.equal(result.steps[0].place?.latitude, 45.5)
  })

  it('filtered sub-collection on store trips', async () => {
    // Get store with only CONFIRMED trips
    // OQL: store {id name trips {id state seats} [state = 'CONFIRMED']} [id = :s1]
    const result = await query(oql, store)
      .select('id', 'name', {
        trips: {
          fields: ['id', 'state', 'seats'],
          where: eq(trip.state, 'CONFIRMED'),
        },
      })
      .where(eq(store.id, ID.s1))
      .one()

    assert.ok(result)
    assert.equal(result.name, 'Downtown')
    assert.equal(result.trips.length, 1)
    assert.equal(result.trips[0].state, 'CONFIRMED')
  })
})
