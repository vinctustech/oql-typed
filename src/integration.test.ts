/**
 * Integration tests using @vinctus/oql-petradb in-memory backend.
 * These tests execute real queries against a live database, verifying
 * that oql-typed generates correct OQL and that results match expectations.
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
  json,
  textArray,
  manyToOne,
  oneToMany,
  manyToMany,
  oneToOne,
  enumType,
} from './schema.js'
import { query } from './query.js'
import {
  eq,
  ne,
  gt,
  gte,
  lt,
  lte,
  and,
  or,
  not,
  inList,
  notInList,
  like,
  ilike,
  between,
  isNull,
  isNotNull,
  exists,
  asc,
  desc,
} from './operators.js'
import { generateDM } from './generate-dm.js'

// ── Type helpers ──

type AssertEqual<T, U> = [T] extends [U] ? ([U] extends [T] ? true : false) : false
type AssertTrue<T extends true> = T

// ── Schema ──

type Role = 'ADMIN' | 'DISPATCHER' | 'DRIVER'
type TripState = 'REQUESTED' | 'CONFIRMED' | 'EN_ROUTE' | 'COMPLETED' | 'CANCELLED'

const account = entity('account', 'accounts', {
  id: uuid().primaryKey(),
  name: text(),
  enabled: boolean(),
  plan: text(),
  createdAt: timestamp().column('created_at'),
})

const place = entity('place', 'places', {
  id: uuid().primaryKey(),
  latitude: float(),
  longitude: float(),
  address: text().nullable(),
})

const store = entity('store', 'stores', {
  id: uuid().primaryKey(),
  name: text(),
  enabled: boolean(),
  color: text(),
  place: manyToOne(() => place, { column: 'place_id' }),
  vehicles: oneToMany(() => vehicle),
  users: manyToMany(() => user, { junction: 'users_stores' }),
  trips: oneToMany(() => trip),
})

const user = entity('user', 'users', {
  id: uuid().primaryKey(),
  firstName: text().column('first_name'),
  lastName: text().column('last_name'),
  email: text(),
  role: enumType<Role>('Role', ['ADMIN', 'DISPATCHER', 'DRIVER']),
  enabled: boolean(),
  lastLoginAt: timestamp().column('last_login_at').nullable(),
  account: manyToOne(() => account, { column: 'account_id' }),
  stores: manyToMany(() => store, { junction: 'users_stores' }),
  vehicle: oneToOne(() => vehicle, { reference: 'driver' }).nullable(),
})

const vehicle = entity('vehicle', 'vehicles', {
  id: uuid().primaryKey(),
  make: text(),
  model: text(),
  year: integer().nullable(),
  active: boolean(),
  driver: manyToOne(() => user, { column: 'driver_id' }).nullable(),
  store: manyToOne(() => store, { column: 'store_id' }),
  trips: oneToMany(() => trip),
})

const trip = entity('trip', 'trips', {
  id: uuid().primaryKey(),
  state: enumType<TripState>('TripState', [
    'REQUESTED',
    'CONFIRMED',
    'EN_ROUTE',
    'COMPLETED',
    'CANCELLED',
  ]),
  seats: integer(),
  notes: text().nullable(),
  createdAt: timestamp().column('created_at'),
  vehicle: manyToOne(() => vehicle, { column: 'vehicle_id' }).nullable(),
  store: manyToOne(() => store, { column: 'store_id' }),
  customer: manyToOne(() => customer, { column: 'customer_id' }),
})

const customer = entity('customer', 'customers', {
  id: uuid().primaryKey(),
  firstName: text().column('first_name'),
  lastName: text().column('last_name'),
  phone: text(),
  places: manyToMany(() => place, { junction: 'customers_places' }),
})

// ── Database setup ──

let oql: OQL_PETRADB

const dm = generateDM(account, place, store, user, vehicle, trip, customer)

// Fixed UUIDs for deterministic test data
const ID = {
  a1: 'a0000000-0000-0000-0000-000000000001',
  p1: 'b0000000-0000-0000-0000-000000000001',
  p2: 'b0000000-0000-0000-0000-000000000002',
  s1: 'c0000000-0000-0000-0000-000000000001',
  s2: 'c0000000-0000-0000-0000-000000000002',
  u1: 'd0000000-0000-0000-0000-000000000001',
  u2: 'd0000000-0000-0000-0000-000000000002',
  u3: 'd0000000-0000-0000-0000-000000000003',
  v1: 'e0000000-0000-0000-0000-000000000001',
  v2: 'e0000000-0000-0000-0000-000000000002',
  c1: 'f0000000-0000-0000-0000-000000000001',
  c2: 'f0000000-0000-0000-0000-000000000002',
  t1: '10000000-0000-0000-0000-000000000001',
  t2: '10000000-0000-0000-0000-000000000002',
  t3: '10000000-0000-0000-0000-000000000003',
  t4: '10000000-0000-0000-0000-000000000004',
}

const seedSQL = `CREATE TABLE accounts (
  id UUID AUTO PRIMARY KEY,
  name TEXT NOT NULL,
  enabled BOOLEAN NOT NULL,
  plan TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL
);
CREATE TABLE places (
  id UUID AUTO PRIMARY KEY,
  latitude FLOAT NOT NULL,
  longitude FLOAT NOT NULL,
  address TEXT
);
CREATE TABLE stores (
  id UUID AUTO PRIMARY KEY,
  name TEXT NOT NULL,
  enabled BOOLEAN NOT NULL,
  color TEXT NOT NULL,
  place_id UUID REFERENCES places(id)
);
CREATE TABLE users (
  id UUID AUTO PRIMARY KEY,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL,
  enabled BOOLEAN NOT NULL,
  last_login_at TIMESTAMP,
  account_id UUID REFERENCES accounts(id)
);
CREATE TABLE users_stores (
  user_id UUID REFERENCES users(id),
  store_id UUID REFERENCES stores(id)
);
CREATE TABLE vehicles (
  id UUID AUTO PRIMARY KEY,
  make TEXT NOT NULL,
  model TEXT NOT NULL,
  year INT,
  active BOOLEAN NOT NULL,
  driver_id UUID REFERENCES users(id),
  store_id UUID REFERENCES stores(id)
);
CREATE TABLE customers (
  id UUID AUTO PRIMARY KEY,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  phone TEXT NOT NULL
);
CREATE TABLE customers_places (
  customer_id UUID REFERENCES customers(id),
  place_id UUID REFERENCES places(id)
);
CREATE TABLE trips (
  id UUID AUTO PRIMARY KEY,
  state TEXT NOT NULL,
  seats INT NOT NULL,
  notes TEXT,
  created_at TIMESTAMP NOT NULL,
  vehicle_id UUID REFERENCES vehicles(id),
  store_id UUID REFERENCES stores(id),
  customer_id UUID REFERENCES customers(id)
);

INSERT INTO accounts (id, name, enabled, plan, created_at) VALUES
  ('${ID.a1}', 'Acme Corp', true, 'pro', '2024-01-01T00:00:00Z');

INSERT INTO places (id, latitude, longitude, address) VALUES
  ('${ID.p1}', 45.5, -73.6, '123 Main St');
INSERT INTO places (id, latitude, longitude, address) VALUES
  ('${ID.p2}', 45.6, -73.7, NULL);

INSERT INTO stores (id, name, enabled, color, place_id) VALUES
  ('${ID.s1}', 'Downtown', true, '#ff0000', '${ID.p1}');
INSERT INTO stores (id, name, enabled, color, place_id) VALUES
  ('${ID.s2}', 'Airport', false, '#00ff00', '${ID.p2}');

INSERT INTO users (id, first_name, last_name, email, role, enabled, last_login_at, account_id) VALUES
  ('${ID.u1}', 'Alice', 'Smith', 'alice@example.com', 'ADMIN', true, '2024-06-15T00:00:00Z', '${ID.a1}');
INSERT INTO users (id, first_name, last_name, email, role, enabled, last_login_at, account_id) VALUES
  ('${ID.u2}', 'Bob', 'Jones', 'bob@example.com', 'DRIVER', true, NULL, '${ID.a1}');
INSERT INTO users (id, first_name, last_name, email, role, enabled, last_login_at, account_id) VALUES
  ('${ID.u3}', 'Charlie', 'Brown', 'charlie@example.com', 'DISPATCHER', false, '2024-03-01T00:00:00Z', '${ID.a1}');

INSERT INTO users_stores (user_id, store_id) VALUES ('${ID.u1}', '${ID.s1}');
INSERT INTO users_stores (user_id, store_id) VALUES ('${ID.u1}', '${ID.s2}');
INSERT INTO users_stores (user_id, store_id) VALUES ('${ID.u2}', '${ID.s1}');

INSERT INTO vehicles (id, make, model, year, active, driver_id, store_id) VALUES
  ('${ID.v1}', 'Toyota', 'Camry', 2022, true, '${ID.u2}', '${ID.s1}');
INSERT INTO vehicles (id, make, model, year, active, driver_id, store_id) VALUES
  ('${ID.v2}', 'Honda', 'Civic', NULL, false, NULL, '${ID.s1}');

INSERT INTO customers (id, first_name, last_name, phone) VALUES
  ('${ID.c1}', 'Dan', 'White', '555-0001');
INSERT INTO customers (id, first_name, last_name, phone) VALUES
  ('${ID.c2}', 'Eve', 'Black', '555-0002');

INSERT INTO customers_places (customer_id, place_id) VALUES ('${ID.c1}', '${ID.p1}');
INSERT INTO customers_places (customer_id, place_id) VALUES ('${ID.c1}', '${ID.p2}');

INSERT INTO trips (id, state, seats, notes, created_at, vehicle_id, store_id, customer_id) VALUES
  ('${ID.t1}', 'CONFIRMED', 2, 'VIP guest', '2024-06-01T00:00:00Z', '${ID.v1}', '${ID.s1}', '${ID.c1}');
INSERT INTO trips (id, state, seats, notes, created_at, vehicle_id, store_id, customer_id) VALUES
  ('${ID.t2}', 'REQUESTED', 1, NULL, '2024-06-02T00:00:00Z', NULL, '${ID.s1}', '${ID.c2}');
INSERT INTO trips (id, state, seats, notes, created_at, vehicle_id, store_id, customer_id) VALUES
  ('${ID.t3}', 'COMPLETED', 4, 'Airport pickup', '2024-05-15T00:00:00Z', '${ID.v1}', '${ID.s2}', '${ID.c1}');
INSERT INTO trips (id, state, seats, notes, created_at, vehicle_id, store_id, customer_id) VALUES
  ('${ID.t4}', 'CANCELLED', 1, NULL, '2024-05-20T00:00:00Z', NULL, '${ID.s2}', '${ID.c2}');
`

// ═══════════════════════════════════════════════════════════════════
// INTEGRATION TESTS
// ═══════════════════════════════════════════════════════════════════

describe('integration: petradb backend', () => {
  before(async () => {
    oql = new OQL_PETRADB(dm)
    await oql.rawMulti(seedSQL)
  })

  describe('basic queries', () => {
    it('queryMany returns all accounts', async () => {
      const results = await query(oql, account).many()

      type Result = typeof results[number]
      type _ = AssertTrue<AssertEqual<Result, {
        id: string; name: string; enabled: boolean; plan: string; createdAt: Date
      }>>

      assert.equal(results.length, 1)
      assert.equal(results[0].name, 'Acme Corp')
      assert.equal(results[0].enabled, true)
      assert.equal(results[0].plan, 'pro')
    })

    it('queryOne returns single user by id', async () => {
      const result = await query(oql, user)
        .select('id', 'firstName', 'lastName', 'email')
        .where(eq(user.id, ID.u1))
        .one()

      type Result = NonNullable<typeof result>
      type _ = AssertTrue<AssertEqual<Result, {
        id: string; firstName: string; lastName: string; email: string
      }>>

      assert.ok(result)
      assert.equal(result.firstName, 'Alice')
      assert.equal(result.lastName, 'Smith')
      assert.equal(result.email, 'alice@example.com')
    })

    it('queryOne returns undefined when no match', async () => {
      const result = await query(oql, user)
        .select('id')
        .where(eq(user.email, 'nobody@example.com'))
        .one()

      assert.equal(result, undefined)
    })

    it('count returns correct number', async () => {
      const total = await query(oql, trip).count()
      assert.equal(total, 4)

      const confirmed = await query(oql, trip)
        .where(eq(trip.state, 'CONFIRMED'))
        .count()
      assert.equal(confirmed, 1)
    })
  })

  describe('projections', () => {
    it('select specific scalar fields', async () => {
      const results = await query(oql, user)
        .select('firstName', 'email')
        .where(eq(user.id, ID.u1))
        .many()

      assert.equal(results.length, 1)
      assert.equal(results[0].firstName, 'Alice')
      assert.equal(results[0].email, 'alice@example.com')
      // Should not have other fields
      assert.equal(Object.keys(results[0]).length, 2)
    })

    it('nested manyToOne relation', async () => {
      const result = await query(oql, user)
        .select('id', 'firstName', { account: ['id', 'name'] })
        .where(eq(user.id, ID.u1))
        .one()

      type Result = NonNullable<typeof result>
      type _ = AssertTrue<AssertEqual<Result, {
        id: string; firstName: string; account: { id: string; name: string }
      }>>

      assert.ok(result)
      assert.equal(result.firstName, 'Alice')
      assert.equal(result.account.name, 'Acme Corp')
    })

    it('nested oneToMany relation', async () => {
      const result = await query(oql, store)
        .select('id', 'name', { trips: ['id', 'state'] })
        .where(eq(store.id, ID.s1))
        .one()

      assert.ok(result)
      assert.equal(result.name, 'Downtown')
      assert.equal(result.trips.length, 2)
    })

    it('nested manyToMany relation', async () => {
      const result = await query(oql, user)
        .select('id', 'firstName', { stores: ['id', 'name'] })
        .where(eq(user.id, ID.u1))
        .one()

      assert.ok(result)
      assert.equal(result.firstName, 'Alice')
      assert.equal(result.stores.length, 2)
      const storeNames = result.stores.map((s: any) => s.name).sort()
      assert.deepEqual(storeNames, ['Airport', 'Downtown'])
    })

    it('nullable manyToOne returns null when not set', async () => {
      const result = await query(oql, trip)
        .select('id', 'state', { vehicle: ['id', 'make'] })
        .where(eq(trip.id, ID.c2))
        .one()

      // Trip with no vehicle should have vehicle: null
      // (Using a trip that has vehicle_id = null)
      const trips = await query(oql, trip)
        .select('id', 'state', { vehicle: ['id', 'make'] })
        .where(isNull(trip.vehicle))
        .many()

      assert.ok(trips.length > 0)
      assert.equal(trips[0].vehicle, null)
    })

    it('deep nesting: trip → vehicle → driver', async () => {
      const result = await query(oql, trip)
        .select('id', 'state', {
          vehicle: ['make', 'model', { driver: ['firstName', 'lastName'] }],
        })
        .where(eq(trip.state, 'CONFIRMED'))
        .one()

      assert.ok(result)
      assert.equal(result.state, 'CONFIRMED')
      assert.equal(result.vehicle?.make, 'Toyota')
      assert.equal(result.vehicle?.driver?.firstName, 'Bob')
    })
  })

  describe('filters', () => {
    it('eq filter', async () => {
      const results = await query(oql, user)
        .select('id', 'firstName')
        .where(eq(user.role, 'DRIVER'))
        .many()

      assert.equal(results.length, 1)
      assert.equal(results[0].firstName, 'Bob')
    })

    it('ne filter', async () => {
      const results = await query(oql, user)
        .select('id', 'firstName')
        .where(ne(user.role, 'ADMIN'))
        .many()

      assert.equal(results.length, 2)
    })

    it('gt / lt filters', async () => {
      const results = await query(oql, trip)
        .select('id', 'seats')
        .where(gt(trip.seats, 1))
        .many()

      assert.ok(results.length > 0)
      for (const r of results) {
        assert.ok(r.seats > 1)
      }
    })

    it('and filter', async () => {
      const results = await query(oql, user)
        .select('id', 'firstName')
        .where(and(eq(user.enabled, true), eq(user.role, 'DRIVER')))
        .many()

      assert.equal(results.length, 1)
      assert.equal(results[0].firstName, 'Bob')
    })

    it('or filter', async () => {
      const results = await query(oql, user)
        .select('id', 'firstName')
        .where(or(eq(user.role, 'ADMIN'), eq(user.role, 'DISPATCHER')))
        .many()

      assert.equal(results.length, 2)
    })

    it('not filter', async () => {
      const results = await query(oql, user)
        .select('id', 'firstName')
        .where(not(eq(user.enabled, true)))
        .many()

      assert.equal(results.length, 1)
      assert.equal(results[0].firstName, 'Charlie')
    })

    it('inList filter', async () => {
      const results = await query(oql, trip)
        .select('id', 'state')
        .where(inList(trip.state, ['CONFIRMED', 'REQUESTED']))
        .many()

      assert.equal(results.length, 2)
    })

    it('notInList filter', async () => {
      const results = await query(oql, trip)
        .select('id', 'state')
        .where(notInList(trip.state, ['CANCELLED', 'COMPLETED']))
        .many()

      assert.equal(results.length, 2)
    })

    it('like filter', async () => {
      const results = await query(oql, user)
        .select('id', 'email')
        .where(like(user.email, '%@example.com'))
        .many()

      assert.equal(results.length, 3)
    })

    it('ilike filter', async () => {
      const results = await query(oql, user)
        .select('id', 'firstName')
        .where(ilike(user.firstName, '%ALI%'))
        .many()

      assert.equal(results.length, 1)
      assert.equal(results[0].firstName, 'Alice')
    })

    it('isNull filter', async () => {
      const results = await query(oql, user)
        .select('id', 'firstName')
        .where(isNull(user.lastLoginAt))
        .many()

      assert.equal(results.length, 1)
      assert.equal(results[0].firstName, 'Bob')
    })

    it('isNotNull filter', async () => {
      const results = await query(oql, user)
        .select('id', 'firstName')
        .where(isNotNull(user.lastLoginAt))
        .many()

      assert.equal(results.length, 2)
    })

    it('exists filter on relation', async () => {
      const results = await query(oql, user)
        .select('id', 'firstName')
        .where(exists(user.stores, eq(store.id, ID.s1)))
        .many()

      // Alice and Bob are linked to s1
      assert.equal(results.length, 2)
      const names = results.map((r: any) => r.firstName).sort()
      assert.deepEqual(names, ['Alice', 'Bob'])
    })

    it('compound filter with exists, inList, ilike', async () => {
      const results = await query(oql, user)
        .select('id', 'firstName', 'lastName', 'role')
        .where(
          and(
            exists(user.stores, eq(store.id, ID.s1)),
            eq(user.enabled, true),
            or(ilike(user.firstName, '%ali%'), ilike(user.lastName, '%jon%')),
          ),
        )
        .many()

      // Alice (firstName matches) and Bob (lastName matches), both enabled and in s1
      assert.equal(results.length, 2)
    })
  })

  describe('ordering', () => {
    it('order by ascending', async () => {
      const results = await query(oql, user)
        .select('id', 'firstName')
        .orderBy(asc(user.firstName))
        .many()

      assert.equal(results[0].firstName, 'Alice')
      assert.equal(results[1].firstName, 'Bob')
      assert.equal(results[2].firstName, 'Charlie')
    })

    it('order by descending', async () => {
      const results = await query(oql, user)
        .select('id', 'firstName')
        .orderBy(desc(user.firstName))
        .many()

      assert.equal(results[0].firstName, 'Charlie')
      assert.equal(results[1].firstName, 'Bob')
      assert.equal(results[2].firstName, 'Alice')
    })
  })

  describe('limit and offset', () => {
    it('limit restricts results', async () => {
      const results = await query(oql, user)
        .select('id', 'firstName')
        .orderBy(asc(user.firstName))
        .limit(2)
        .many()

      assert.equal(results.length, 2)
      assert.equal(results[0].firstName, 'Alice')
      assert.equal(results[1].firstName, 'Bob')
    })

    it('offset skips results', async () => {
      const results = await query(oql, user)
        .select('id', 'firstName')
        .orderBy(asc(user.firstName))
        .offset(1)
        .limit(2)
        .many()

      assert.equal(results.length, 2)
      assert.equal(results[0].firstName, 'Bob')
      assert.equal(results[1].firstName, 'Charlie')
    })
  })

  describe('combined query features', () => {
    it('select + where + orderBy + limit', async () => {
      const results = await query(oql, trip)
        .select('id', 'state', 'seats', { store: ['name'] })
        .where(inList(trip.state, ['CONFIRMED', 'REQUESTED', 'EN_ROUTE']))
        .orderBy(desc(trip.createdAt))
        .limit(10)
        .many()

      type Result = typeof results[number]
      type _ = AssertTrue<AssertEqual<Result, {
        id: string; state: TripState; seats: number; store: { name: string }
      }>>

      assert.equal(results.length, 2)
      // Ordered by createdAt desc: REQUESTED (Jun 2) before CONFIRMED (Jun 1)
      assert.equal(results[0].state, 'REQUESTED')
      assert.equal(results[1].state, 'CONFIRMED')
    })

    it('full query with nested relations and compound filter', async () => {
      const results = await query(oql, trip)
        .select('id', 'state', 'seats', 'notes', {
          vehicle: ['make', 'model'],
          store: ['name', 'color'],
          customer: ['firstName', 'lastName', 'phone'],
        })
        .where(
          and(
            eq(trip.store, ID.s1),
            isNotNull(trip.vehicle),
          ),
        )
        .many()

      assert.equal(results.length, 1)
      assert.equal(results[0].state, 'CONFIRMED')
      assert.equal(results[0].vehicle?.make, 'Toyota')
      assert.equal(results[0].store.name, 'Downtown')
      assert.equal(results[0].customer.firstName, 'Dan')
    })
  })
})
