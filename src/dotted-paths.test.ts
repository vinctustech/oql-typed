/**
 * Tests for multi-level dotted path navigation in filters.
 * OQL supports filtering through relation chains: store.account.id = :accountId
 * oql-typed should support this via chained field access on relation refs.
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
import { eq, and, inList } from './operators.js'
import { generateDM } from './generate-dm.js'

// ── Schema ──

const account = entity('account', 'accounts', {
  id: uuid().primaryKey(),
  name: text(),
  enabled: boolean(),
})

const store = entity('store', 'stores', {
  id: uuid().primaryKey(),
  name: text(),
  enabled: boolean(),
  account: manyToOne(() => account, { column: 'account_id' }),
})

const trip = entity('trip', 'trips', {
  id: uuid().primaryKey(),
  state: text(),
  store: manyToOne(() => store, { column: 'store_id' }),
})

// ── Database setup ──

let oql: OQL_PETRADB

const dm = generateDM(account, store, trip)

const ID = {
  a1: 'a0000000-0000-4000-8000-000000000001',
  a2: 'a0000000-0000-4000-8000-000000000002',
  s1: 'b0000000-0000-4000-8000-000000000001',
  s2: 'b0000000-0000-4000-8000-000000000002',
  t1: 'c0000000-0000-4000-8000-000000000001',
  t2: 'c0000000-0000-4000-8000-000000000002',
  t3: 'c0000000-0000-4000-8000-000000000003',
}

const seedSQL = `CREATE TABLE accounts (id UUID PRIMARY KEY, name TEXT NOT NULL, enabled BOOLEAN NOT NULL);
CREATE TABLE stores (id UUID PRIMARY KEY, name TEXT NOT NULL, enabled BOOLEAN NOT NULL, account_id UUID REFERENCES accounts(id));
CREATE TABLE trips (id UUID PRIMARY KEY, state TEXT NOT NULL, store_id UUID REFERENCES stores(id));

INSERT INTO accounts (id, name, enabled) VALUES ('${ID.a1}', 'Acme Corp', true);
INSERT INTO accounts (id, name, enabled) VALUES ('${ID.a2}', 'Beta Inc', false);

INSERT INTO stores (id, name, enabled, account_id) VALUES ('${ID.s1}', 'Downtown', true, '${ID.a1}');
INSERT INTO stores (id, name, enabled, account_id) VALUES ('${ID.s2}', 'Airport', true, '${ID.a2}');

INSERT INTO trips (id, state, store_id) VALUES ('${ID.t1}', 'CONFIRMED', '${ID.s1}');
INSERT INTO trips (id, state, store_id) VALUES ('${ID.t2}', 'REQUESTED', '${ID.s1}');
INSERT INTO trips (id, state, store_id) VALUES ('${ID.t3}', 'CONFIRMED', '${ID.s2}');
`

// ═══════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════

describe('dotted path filters', () => {
  before(async () => {
    oql = new OQL_PETRADB(dm)
    await oql.rawMulti(seedSQL)
  })

  it('single-level dotted path: store.id', async () => {
    // Filter trips by their store's ID (single FK hop)
    const results = await query(oql, trip)
      .select('id', 'state')
      .where(eq(trip.store, ID.s1))
      .many()

    assert.equal(results.length, 2)
  })

  it('two-level dotted path: store.account.id', async () => {
    // Filter trips by their store's account's ID (two FK hops)
    // This requires: trip → store (FK) → account (FK) → id (PK)
    // OQL: trip {id state} [store.account.id = :p0]
    const results = await query(oql, trip)
      .select('id', 'state')
      .where(eq(trip.store.account.id, ID.a1))
      .many()

    assert.equal(results.length, 2)
    for (const r of results) {
      assert.ok(r.state === 'CONFIRMED' || r.state === 'REQUESTED')
    }
  })

  it('two-level dotted path with IN', async () => {
    // Filter trips by account ID using IN
    const results = await query(oql, trip)
      .select('id', 'state')
      .where(inList(trip.store.account.id, [ID.a1, ID.a2]))
      .many()

    assert.equal(results.length, 3)
  })

  it('combine dotted path with other filters', async () => {
    const results = await query(oql, trip)
      .select('id', 'state')
      .where(and(
        eq(trip.store.account.id, ID.a1),
        eq(trip.state, 'CONFIRMED'),
      ))
      .many()

    assert.equal(results.length, 1)
  })
})
