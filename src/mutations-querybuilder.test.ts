/**
 * Tests for:
 * 1. Typed insert() and update() mutation wrappers
 * 2. Conditional queryBuilder with typed results
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
import { eq, and, ne, ilike, or, inList, asc, desc } from './operators.js'
import { insert, update } from './mutations.js'
import { queryBuilder } from './query-builder.js'
import { generateDM } from './generate-dm.js'

// ── Type helpers ──

type AssertEqual<T, U> = [T] extends [U] ? ([U] extends [T] ? true : false) : false
type AssertTrue<T extends true> = T

// ── Schema ──

const store = entity('store', 'stores', {
  id: uuid().primaryKey(),
  name: text(),
  enabled: boolean(),
  users: oneToMany(() => user),
})

const user = entity('user', 'users', {
  id: uuid().primaryKey(),
  firstName: text().column('first_name'),
  lastName: text().column('last_name'),
  email: text(),
  role: text(),
  enabled: boolean(),
  lastLoginAt: timestamp().column('last_login_at').nullable(),
  store: manyToOne(() => store, { column: 'store_id' }),
})

// ── Database setup ──

let oql: OQL_PETRADB

const dm = generateDM(store, user)

const ID = {
  s1: 'a0000000-0000-4000-8000-000000000001',
  u1: 'b0000000-0000-4000-8000-000000000001',
  u2: 'b0000000-0000-4000-8000-000000000002',
  u3: 'b0000000-0000-4000-8000-000000000003',
}

const seedSQL = `CREATE TABLE stores (id UUID PRIMARY KEY, name TEXT NOT NULL, enabled BOOLEAN NOT NULL);
CREATE TABLE users (id UUID PRIMARY KEY, first_name TEXT NOT NULL, last_name TEXT NOT NULL, email TEXT NOT NULL, role TEXT NOT NULL, enabled BOOLEAN NOT NULL, last_login_at TIMESTAMP, store_id UUID REFERENCES stores(id));

INSERT INTO stores (id, name, enabled) VALUES ('${ID.s1}', 'Downtown', true);

INSERT INTO users (id, first_name, last_name, email, role, enabled, last_login_at, store_id) VALUES ('${ID.u1}', 'Alice', 'Smith', 'alice@example.com', 'ADMIN', true, '2024-06-15T00:00:00Z', '${ID.s1}');
INSERT INTO users (id, first_name, last_name, email, role, enabled, last_login_at, store_id) VALUES ('${ID.u2}', 'Bob', 'Jones', 'bob@example.com', 'DRIVER', true, NULL, '${ID.s1}');
INSERT INTO users (id, first_name, last_name, email, role, enabled, last_login_at, store_id) VALUES ('${ID.u3}', 'Charlie', 'Brown', 'charlie@example.com', 'DISPATCHER', false, '2024-03-01T00:00:00Z', '${ID.s1}');
`

// ═══════════════════════════════════════════════════════════════════
// MUTATION TESTS
// ═══════════════════════════════════════════════════════════════════

describe('typed insert()', () => {
  before(async () => {
    oql = new OQL_PETRADB(dm)
    await oql.rawMulti(seedSQL)
  })

  it('inserts a store and returns typed result', async () => {
    const result = await insert(oql, store, {
      id: 'c0000000-0000-4000-8000-000000000001',
      name: 'Airport',
      enabled: true,
    })

    type Result = typeof result
    type _ = AssertTrue<AssertEqual<Result, {
      id: string; name: string; enabled: boolean
    }>>

    assert.equal(result.name, 'Airport')
    assert.equal(result.enabled, true)
    assert.ok(result.id)
  })

  it('inserts a user with nullable field omitted', async () => {
    const result = await insert(oql, user, {
      id: 'b0000000-0000-4000-8000-000000000010',
      firstName: 'Dan',
      lastName: 'White',
      email: 'dan@example.com',
      role: 'DRIVER',
      enabled: true,
      store: ID.s1,
    })

    assert.equal(result.firstName, 'Dan')
    // Nullable field not provided — OQL returns undefined (not in result set)
    assert.ok(result.lastLoginAt === null || result.lastLoginAt === undefined)
  })

  it('inserts a user with nullable field provided', async () => {
    const result = await insert(oql, user, {
      id: 'b0000000-0000-4000-8000-000000000011',
      firstName: 'Eve',
      lastName: 'Black',
      email: 'eve@example.com',
      role: 'ADMIN',
      enabled: true,
      store: ID.s1,
      lastLoginAt: null,
    })

    assert.equal(result.firstName, 'Eve')
  })
})

describe('typed update()', () => {
  before(async () => {
    oql = new OQL_PETRADB(dm)
    await oql.rawMulti(seedSQL)
  })

  it('updates a user and returns updated fields + pk', async () => {
    const result = await update(oql, user, ID.u1, {
      firstName: 'Alicia',
    })

    // update() returns {pk, ...updatedFields}, not the full row
    assert.equal(result.id, ID.u1)
    assert.equal(result.firstName, 'Alicia')
  })

  it('updates multiple fields', async () => {
    const result = await update(oql, user, ID.u2, {
      firstName: 'Robert',
      email: 'robert@example.com',
      enabled: false,
    })

    assert.equal(result.id, ID.u2)
    assert.equal(result.firstName, 'Robert')
    assert.equal(result.email, 'robert@example.com')
    assert.equal(result.enabled, false)
  })

  it('sets a nullable field to null', async () => {
    const result = await update(oql, user, ID.u1, {
      lastLoginAt: null,
    })

    assert.equal(result.id, ID.u1)
    assert.equal(result.lastLoginAt, null)
  })

  it('verify update persisted', async () => {
    // Verify the update from previous test via a query
    const result = await query(oql, user)
      .select('id', 'firstName')
      .where(eq(user.id, ID.u1))
      .one()

    assert.ok(result)
    assert.equal(result.firstName, 'Alicia')
  })
})

// ═══════════════════════════════════════════════════════════════════
// QUERYBUILDER TESTS
// ═══════════════════════════════════════════════════════════════════

describe('typed queryBuilder', () => {
  before(async () => {
    oql = new OQL_PETRADB(dm)
    await oql.rawMulti(seedSQL)
  })

  it('basic select with no conditions', async () => {
    const results = await queryBuilder(oql, user)
      .select('id', 'firstName', 'email')
      .many()

    type Result = typeof results[number]
    type _ = AssertTrue<AssertEqual<Result, {
      id: string; firstName: string; email: string
    }>>

    assert.equal(results.length, 3)
  })

  it('select with where', async () => {
    const results = await queryBuilder(oql, user)
      .select('id', 'firstName', 'role')
      .where(eq(user.enabled, true))
      .many()

    assert.equal(results.length, 2)
  })

  it('cond(truthy, filter) adds filter', async () => {
    const role = 'DRIVER'

    const results = await queryBuilder(oql, user)
      .select('id', 'firstName', 'role')
      .where(eq(user.enabled, true))
      .cond(role, eq(user.role, role))
      .many()

    assert.equal(results.length, 1)
    assert.equal(results[0].firstName, 'Bob')
  })

  it('cond(falsy, filter) skips filter', async () => {
    const role = undefined

    const results = await queryBuilder(oql, user)
      .select('id', 'firstName', 'role')
      .where(eq(user.enabled, true))
      .cond(role, eq(user.role, role!))
      .many()

    // filter skipped, returns all enabled
    assert.equal(results.length, 2)
  })

  it('cond(truthy) followed by .select() adds filter', async () => {
    const search = 'ali'

    const results = await queryBuilder(oql, user)
      .select('id', 'firstName', 'email')
      .where(eq(user.enabled, true))
      .cond(search)
      .select(or(ilike(user.firstName, `%${search}%`), ilike(user.email, `%${search}%`)))
      .many()

    assert.equal(results.length, 1)
    assert.equal(results[0].firstName, 'Alice')
  })

  it('cond(falsy) followed by .select() skips filter', async () => {
    const search = ''

    const results = await queryBuilder(oql, user)
      .select('id', 'firstName')
      .where(eq(user.enabled, true))
      .cond(search)
      .select(ilike(user.firstName, `%${search}%`))
      .many()

    // empty search → filter skipped → returns all enabled
    assert.equal(results.length, 2)
  })

  it('multiple cond() chains', async () => {
    const role = 'ADMIN'
    const search = ''

    const results = await queryBuilder(oql, user)
      .select('id', 'firstName', 'role')
      .where(eq(user.enabled, true))
      .cond(role, eq(user.role, role))
      .cond(search)
      .select(ilike(user.firstName, `%${search}%`))
      .many()

    // role filter applied, search skipped
    assert.equal(results.length, 1)
    assert.equal(results[0].role, 'ADMIN')
  })

  it('with orderBy, limit, offset', async () => {
    const results = await queryBuilder(oql, user)
      .select('id', 'firstName')
      .orderBy(asc(user.firstName))
      .limit(2)
      .offset(1)
      .many()

    assert.equal(results.length, 2)
    assert.equal(results[0].firstName, 'Bob')
    assert.equal(results[1].firstName, 'Charlie')
  })

  it('count()', async () => {
    const count = await queryBuilder(oql, user)
      .select('id')
      .where(eq(user.enabled, true))
      .count()

    assert.equal(count, 2)
  })

  it('one()', async () => {
    const result = await queryBuilder(oql, user)
      .select('id', 'firstName', 'email')
      .where(eq(user.id, ID.u1))
      .one()

    assert.ok(result)
    assert.equal(result.firstName, 'Alice')
  })

  it('toOQL() returns query and params', () => {
    const role = 'DRIVER'
    const search = 'bob'

    const { queryStr, params } = queryBuilder(oql, user)
      .select('id', 'firstName', 'role')
      .where(eq(user.enabled, true))
      .cond(role, eq(user.role, role))
      .cond(search, ilike(user.firstName, `%${search}%`))
      .orderBy(desc(user.firstName))
      .limit(10)
      .offset(0)
      .toOQL()

    assert.ok(queryStr.includes('user {id firstName role}'))
    assert.ok(queryStr.includes('enabled = :p0'))
    assert.ok(queryStr.includes('role = :p1'))
    assert.ok(queryStr.includes('firstName ILIKE :p2'))
    assert.equal(params.p0, true)
    assert.equal(params.p1, 'DRIVER')
    assert.equal(params.p2, '%bob%')
  })

  it('select with nested relations', async () => {
    const results = await queryBuilder(oql, user)
      .select('id', 'firstName', { store: ['id', 'name'] })
      .where(eq(user.id, ID.u1))
      .many()

    type Result = typeof results[number]
    type _ = AssertTrue<AssertEqual<Result, {
      id: string; firstName: string; store: { id: string; name: string }
    }>>

    assert.equal(results.length, 1)
    assert.equal(results[0].store.name, 'Downtown')
  })
})
