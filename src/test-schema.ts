// Shared test schema mirroring shuttlecontrol-api's real structure.
// Used by type assertions AND runtime tests against @vinctus/oql-petradb.

import {
  defineSchema,
  entity,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  manyToOne,
  oneToMany,
  manyToMany,
  oneToOne,
  enumType,
  float,
} from './schema.js'

export type Role = 'ADMIN' | 'DISPATCHER' | 'DRIVER'
export type TripState = 'REQUESTED' | 'CONFIRMED' | 'EN_ROUTE' | 'COMPLETED' | 'CANCELLED'

export const schema = defineSchema({
  account: entity('accounts', {
    id: uuid().primaryKey(),
    name: text(),
    enabled: boolean(),
    plan: text(),
    createdAt: timestamp().column('created_at'),
    users: oneToMany('user'),
    stores: oneToMany('store'),
  }),
  place: entity('places', {
    id: uuid().primaryKey(),
    latitude: float(),
    longitude: float(),
    address: text().nullable(),
  }),
  store: entity('stores', {
    id: uuid().primaryKey(),
    name: text(),
    enabled: boolean(),
    color: text(),
    account: manyToOne('account', { column: 'account_id' }),
    place: manyToOne('place', { column: 'place_id' }).nullable(),
    users: manyToMany('user', { junction: 'users_stores' }),
    vehicles: oneToMany('vehicle'),
    trips: oneToMany('trip'),
    zones: oneToMany('zone'),
  }),
  user: entity('users', {
    id: uuid().primaryKey(),
    firstName: text().column('first_name'),
    lastName: text().column('last_name'),
    email: text(),
    role: enumType<Role>('Role', ['ADMIN', 'DISPATCHER', 'DRIVER']),
    enabled: boolean(),
    lastLoginAt: timestamp().column('last_login_at').nullable(),
    account: manyToOne('account', { column: 'account_id' }),
    stores: manyToMany('store', { junction: 'users_stores' }),
    vehicle: oneToOne('vehicle', { reference: 'driver' }).nullable(),
  }),
  vehicle: entity('vehicles', {
    id: uuid().primaryKey(),
    make: text(),
    model: text(),
    year: integer().nullable(),
    active: boolean(),
    seats: integer(),
    driver: manyToOne('user', { column: 'driver_id' }).nullable(),
    store: manyToOne('store', { column: 'store_id' }),
    trips: oneToMany('trip'),
  }),
  trip: entity('trips', {
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
    scheduledAt: timestamp().column('scheduled_at').nullable(),
    vehicle: manyToOne('vehicle', { column: 'vehicle_id' }).nullable(),
    store: manyToOne('store', { column: 'store_id' }),
    customer: manyToOne('customer', { column: 'customer_id' }),
    returnTripFor: manyToOne('trip', { column: 'return_trip_for_id' }).nullable(),
    zone: manyToOne('zone', { column: 'zone_id' }).nullable(),
    steps: oneToMany('tripStep'),
  }),
  customer: entity('customers', {
    id: uuid().primaryKey(),
    firstName: text().column('first_name'),
    lastName: text().column('last_name'),
    companyName: text().column('company_name').nullable(),
    phoneNumber: text().column('phone_number'),
    store: manyToOne('store', { column: 'store_id' }),
    places: manyToMany('place', { junction: 'customers_places' }),
  }),
  tripStep: entity('trip_steps', {
    id: uuid().primaryKey(),
    type: text(),
    position: integer(),
    finishedAt: timestamp().column('finished_at').nullable(),
    trip: manyToOne('trip', { column: 'trip_id' }),
    place: manyToOne('place', { column: 'place_id' }).nullable(),
  }),
  zone: entity('zones', {
    id: uuid().primaryKey(),
    name: text(),
    color: text(),
    geometry: text(),
    enabled: boolean(),
    restricted: boolean(),
    store: manyToOne('store', { column: 'store_id' }),
  }),
})

export type AppSchema = typeof schema

// Seed SQL for petradb runtime tests
export const seedSQL = `CREATE TABLE accounts (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  enabled BOOLEAN NOT NULL,
  plan TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL
);
CREATE TABLE places (
  id UUID PRIMARY KEY,
  latitude DOUBLE NOT NULL,
  longitude DOUBLE NOT NULL,
  address TEXT
);
CREATE TABLE stores (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  enabled BOOLEAN NOT NULL,
  color TEXT NOT NULL,
  account_id UUID REFERENCES accounts(id),
  place_id UUID REFERENCES places(id)
);
CREATE TABLE users (
  id UUID PRIMARY KEY,
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
  id UUID PRIMARY KEY,
  make TEXT NOT NULL,
  model TEXT NOT NULL,
  year INTEGER,
  active BOOLEAN NOT NULL,
  seats INTEGER NOT NULL,
  driver_id UUID REFERENCES users(id),
  store_id UUID REFERENCES stores(id)
);
CREATE TABLE customers (
  id UUID PRIMARY KEY,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  company_name TEXT,
  phone_number TEXT NOT NULL,
  store_id UUID REFERENCES stores(id)
);
CREATE TABLE customers_places (
  customer_id UUID REFERENCES customers(id),
  place_id UUID REFERENCES places(id)
);
CREATE TABLE zones (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  geometry TEXT NOT NULL,
  enabled BOOLEAN NOT NULL,
  restricted BOOLEAN NOT NULL,
  store_id UUID REFERENCES stores(id)
);
CREATE TABLE trips (
  id UUID PRIMARY KEY,
  state TEXT NOT NULL,
  seats INTEGER NOT NULL,
  notes TEXT,
  created_at TIMESTAMP NOT NULL,
  scheduled_at TIMESTAMP,
  vehicle_id UUID REFERENCES vehicles(id),
  store_id UUID REFERENCES stores(id),
  customer_id UUID REFERENCES customers(id),
  return_trip_for_id UUID,
  zone_id UUID REFERENCES zones(id)
);
CREATE TABLE trip_steps (
  id UUID PRIMARY KEY,
  type TEXT NOT NULL,
  position INTEGER NOT NULL,
  finished_at TIMESTAMP,
  trip_id UUID REFERENCES trips(id),
  place_id UUID REFERENCES places(id)
);
`

// Fixed UUIDs for deterministic data
export const ID = {
  a1: 'a0000000-0000-4000-8000-000000000001',
  p1: 'b0000000-0000-4000-8000-000000000001',
  p2: 'b0000000-0000-4000-8000-000000000002',
  s1: 'c0000000-0000-4000-8000-000000000001',
  s2: 'c0000000-0000-4000-8000-000000000002',
  u1: 'd0000000-0000-4000-8000-000000000001',
  u2: 'd0000000-0000-4000-8000-000000000002',
  u3: 'd0000000-0000-4000-8000-000000000003',
  v1: 'e0000000-0000-4000-8000-000000000001',
  v2: 'e0000000-0000-4000-8000-000000000002',
  c1: 'f0000000-0000-4000-8000-000000000001',
  c2: 'f0000000-0000-4000-8000-000000000002',
  t1: '10000000-0000-4000-8000-000000000001',
  t2: '10000000-0000-4000-8000-000000000002',
  t3: '10000000-0000-4000-8000-000000000003',
  t4: '10000000-0000-4000-8000-000000000004',
  z1: '20000000-0000-4000-8000-000000000001',
  z2: '20000000-0000-4000-8000-000000000002',
}

export const dataSQL = `
INSERT INTO accounts VALUES ('${ID.a1}', 'Acme Corp', true, 'pro', '2024-01-01T00:00:00Z');

INSERT INTO places VALUES ('${ID.p1}', 45.5, -73.6, '123 Main St');
INSERT INTO places VALUES ('${ID.p2}', 45.6, -73.7, NULL);

INSERT INTO stores VALUES ('${ID.s1}', 'Downtown', true, '#ff0000', '${ID.a1}', '${ID.p1}');
INSERT INTO stores VALUES ('${ID.s2}', 'Airport', false, '#00ff00', '${ID.a1}', '${ID.p2}');

INSERT INTO users VALUES ('${ID.u1}', 'Alice', 'Smith', 'alice@example.com', 'ADMIN', true, '2024-06-15T00:00:00Z', '${ID.a1}');
INSERT INTO users VALUES ('${ID.u2}', 'Bob', 'Jones', 'bob@example.com', 'DRIVER', true, NULL, '${ID.a1}');
INSERT INTO users VALUES ('${ID.u3}', 'Charlie', 'Brown', 'charlie@example.com', 'DISPATCHER', false, '2024-03-01T00:00:00Z', '${ID.a1}');

INSERT INTO users_stores VALUES ('${ID.u1}', '${ID.s1}');
INSERT INTO users_stores VALUES ('${ID.u1}', '${ID.s2}');
INSERT INTO users_stores VALUES ('${ID.u2}', '${ID.s1}');

INSERT INTO vehicles VALUES ('${ID.v1}', 'Toyota', 'Camry', 2022, true, 4, '${ID.u2}', '${ID.s1}');
INSERT INTO vehicles VALUES ('${ID.v2}', 'Honda', 'Civic', NULL, false, 4, NULL, '${ID.s1}');

INSERT INTO customers VALUES ('${ID.c1}', 'Dan', 'White', 'Acme', '555-0001', '${ID.s1}');
INSERT INTO customers VALUES ('${ID.c2}', 'Eve', 'Black', NULL, '555-0002', '${ID.s1}');

INSERT INTO customers_places VALUES ('${ID.c1}', '${ID.p1}');
INSERT INTO customers_places VALUES ('${ID.c1}', '${ID.p2}');

INSERT INTO zones VALUES ('${ID.z1}', 'North', '#0000ff', 'poly1', true, false, '${ID.s1}');
INSERT INTO zones VALUES ('${ID.z2}', 'South', '#ff00ff', 'poly2', true, true, '${ID.s1}');

INSERT INTO trips VALUES ('${ID.t1}', 'CONFIRMED', 2, 'VIP guest', '2024-06-01T10:00:00Z', '2024-06-01T12:00:00Z', '${ID.v1}', '${ID.s1}', '${ID.c1}', NULL, '${ID.z1}');
INSERT INTO trips VALUES ('${ID.t2}', 'REQUESTED', 1, NULL, '2024-06-02T14:00:00Z', NULL, NULL, '${ID.s1}', '${ID.c2}', NULL, NULL);
INSERT INTO trips VALUES ('${ID.t3}', 'COMPLETED', 4, 'Airport pickup', '2024-05-15T08:00:00Z', '2024-05-15T10:00:00Z', '${ID.v1}', '${ID.s2}', '${ID.c1}', '${ID.t1}', NULL);
INSERT INTO trips VALUES ('${ID.t4}', 'CANCELLED', 1, NULL, '2024-05-20T16:00:00Z', NULL, NULL, '${ID.s2}', '${ID.c2}', '${ID.t2}', NULL);

INSERT INTO trip_steps VALUES ('30000000-0000-4000-8000-000000000001', 'place', 1, NULL, '${ID.t1}', '${ID.p1}');
INSERT INTO trip_steps VALUES ('30000000-0000-4000-8000-000000000002', 'place', 2, NULL, '${ID.t1}', '${ID.p2}');
`
