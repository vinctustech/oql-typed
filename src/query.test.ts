import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
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
import { parseDM, generateSchemaTS } from './parse-dm.js'

// ── Test schema ──

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
  tags: textArray().nullable(),
  metadata: json().nullable(),
})

// ── Mock OQL instance ──

function mockOQL() {
  const calls: { method: string; query: string; params?: Record<string, unknown> }[] = []
  return {
    calls,
    queryOne: async (q: string, params?: Record<string, unknown>) => {
      calls.push({ method: 'queryOne', query: q, params })
      return undefined
    },
    queryMany: async (q: string, params?: Record<string, unknown>) => {
      calls.push({ method: 'queryMany', query: q, params })
      return []
    },
    count: async (q: string, params?: Record<string, unknown>) => {
      calls.push({ method: 'count', query: q, params })
      return 0
    },
  }
}

// ── Type-level helpers ──

type AssertEqual<T, U> = [T] extends [U] ? ([U] extends [T] ? true : false) : false
type AssertTrue<T extends true> = T

// ═══════════════════════════════════════════════════════════════════
// COMPILE-TIME NEGATIVE TESTS — @ts-expect-error
//
// Each line below MUST produce a compile error. If any line compiles
// cleanly, tsc will flag the unused @ts-expect-error as an error.
// ═══════════════════════════════════════════════════════════════════

{
  const oql = mockOQL()

  // Invalid field name in selection
  // @ts-expect-error 'nonexistent' is not a field of user
  query(oql, user).select('id', 'nonexistent')

  // Misspelled field name
  // @ts-expect-error 'fistName' is not a field of user
  query(oql, user).select('fistName')

  // Relation name used as scalar in selection
  // @ts-expect-error 'account' is a relation, not a scalar key
  query(oql, user).select('account')

  // Invalid field inside relation selection
  // @ts-expect-error 'nonexistent' is not a field of account
  query(oql, user).select('id', { account: ['id', 'nonexistent'] })

  // Invalid relation name in selection object
  // @ts-expect-error 'foobar' is not a relation of user
  query(oql, user).select('id', { foobar: ['id'] })

  // Wrong value type: boolean field vs string
  // @ts-expect-error enabled is boolean, not string
  eq(user.enabled, 'yes')

  // Wrong value type: string field vs number
  // @ts-expect-error firstName is string, not number
  eq(user.firstName, 42)

  // Wrong value type: string field vs boolean
  // @ts-expect-error email is string, not boolean
  eq(user.email, true)

  // Wrong value type: boolean field with string array
  // @ts-expect-error enabled is boolean, values should be boolean[]
  inList(user.enabled, ['yes', 'no'])

  // Wrong value type: string field with number bounds
  // @ts-expect-error firstName is string, not number
  between(user.firstName, 1, 10)

  // ilike on non-string field
  // @ts-expect-error enabled is boolean, ilike requires string
  ilike(user.enabled, '%test%')

  // like on non-string field
  // @ts-expect-error enabled is boolean, like requires string
  like(user.enabled, '%test%')

  // exists with scalar field ref instead of relation ref
  // @ts-expect-error id is a scalar field, not a relation
  exists(user.id)

  // Wrong value type: number field vs string
  // @ts-expect-error seats is number, not string
  eq(trip.seats, 'five')

  // Wrong value type: Date field vs string
  // @ts-expect-error lastLoginAt is Date|null, not string
  gt(user.lastLoginAt, 'yesterday')

  // Invalid enum value
  // @ts-expect-error 'INVALID_ROLE' is not in the Role union
  eq(user.role, 'INVALID_ROLE')

  // Invalid enum value in list
  // @ts-expect-error 'BOGUS' is not a valid TripState
  inList(trip.state, ['REQUESTED', 'BOGUS'])
}

// ═══════════════════════════════════════════════════════════════════
// COMBINED TESTS — every test checks BOTH type inference AND query
// ═══════════════════════════════════════════════════════════════════

describe('simple selections', () => {
  it('three scalar fields', async () => {
    const oql = mockOQL()
    const qb = query(oql, user).select('id', 'firstName', 'lastName')

    type Result = Awaited<ReturnType<typeof qb.many>>[number]
    type _ = AssertTrue<AssertEqual<Result, { id: string; firstName: string; lastName: string }>>

    await qb.many()
    assert.equal(oql.calls[0].query, 'user {id firstName lastName}')
    assert.deepEqual(oql.calls[0].params, {})
  })

  it('single scalar field', async () => {
    const oql = mockOQL()
    const qb = query(oql, user).select('email')

    type Result = Awaited<ReturnType<typeof qb.many>>[number]
    type _ = AssertTrue<AssertEqual<Result, { email: string }>>

    await qb.many()
    assert.equal(oql.calls[0].query, 'user {email}')
  })

  it('no selection returns all scalar fields', async () => {
    const oql = mockOQL()
    const qb = query(oql, account)

    type Result = Awaited<ReturnType<typeof qb.many>>[number]
    type _ = AssertTrue<
      AssertEqual<Result, { id: string; name: string; enabled: boolean; plan: string; createdAt: Date }>
    >

    await qb.many()
    assert.equal(oql.calls[0].query, 'account')
  })

  it('nullable scalar includes null in type', async () => {
    const oql = mockOQL()
    const qb = query(oql, user).select('id', 'lastLoginAt')

    type Result = Awaited<ReturnType<typeof qb.many>>[number]
    type _ = AssertTrue<AssertEqual<Result, { id: string; lastLoginAt: Date | null }>>

    await qb.many()
    assert.equal(oql.calls[0].query, 'user {id lastLoginAt}')
  })

  it('enum field infers union type', async () => {
    const oql = mockOQL()
    const qb = query(oql, user).select('id', 'role')

    type Result = Awaited<ReturnType<typeof qb.many>>[number]
    type _ = AssertTrue<AssertEqual<Result, { id: string; role: Role }>>

    await qb.many()
    assert.equal(oql.calls[0].query, 'user {id role}')
  })

  it('integer field infers number', async () => {
    const oql = mockOQL()
    const qb = query(oql, trip).select('id', 'seats')

    type Result = Awaited<ReturnType<typeof qb.many>>[number]
    type _ = AssertTrue<AssertEqual<Result, { id: string; seats: number }>>

    await qb.many()
    assert.equal(oql.calls[0].query, 'trip {id seats}')
  })

  it('float field infers number', async () => {
    const oql = mockOQL()
    const qb = query(oql, place).select('latitude', 'longitude')

    type Result = Awaited<ReturnType<typeof qb.many>>[number]
    type _ = AssertTrue<AssertEqual<Result, { latitude: number; longitude: number }>>

    await qb.many()
    assert.equal(oql.calls[0].query, 'place {latitude longitude}')
  })

  it('textArray field infers string[] | null', async () => {
    const oql = mockOQL()
    const qb = query(oql, customer).select('id', 'tags')

    type Result = Awaited<ReturnType<typeof qb.many>>[number]
    type _ = AssertTrue<AssertEqual<Result, { id: string; tags: string[] | null }>>

    await qb.many()
    assert.equal(oql.calls[0].query, 'customer {id tags}')
  })

  it('json field infers unknown | null', async () => {
    const oql = mockOQL()
    const qb = query(oql, customer).select('id', 'metadata')

    type Result = Awaited<ReturnType<typeof qb.many>>[number]
    type _ = AssertTrue<AssertEqual<Result, { id: string; metadata: unknown }>>

    await qb.many()
    assert.equal(oql.calls[0].query, 'customer {id metadata}')
  })

  it('nullable integer field', async () => {
    const oql = mockOQL()
    const qb = query(oql, vehicle).select('id', 'year')

    type Result = Awaited<ReturnType<typeof qb.many>>[number]
    type _ = AssertTrue<AssertEqual<Result, { id: string; year: number | null }>>

    await qb.many()
    assert.equal(oql.calls[0].query, 'vehicle {id year}')
  })

  it('all scalars on entity with mixed nullability', async () => {
    const oql = mockOQL()
    const qb = query(oql, place)

    type Result = Awaited<ReturnType<typeof qb.many>>[number]
    type _ = AssertTrue<
      AssertEqual<Result, { id: string; latitude: number; longitude: number; address: string | null }>
    >

    await qb.many()
    assert.equal(oql.calls[0].query, 'place')
  })
})

describe('relation selections', () => {
  it('manyToOne (non-nullable) returns object', async () => {
    const oql = mockOQL()
    const qb = query(oql, user).select('id', { account: ['id', 'name'] })

    type Result = Awaited<ReturnType<typeof qb.many>>[number]
    type _ = AssertTrue<AssertEqual<Result, { id: string; account: { id: string; name: string } }>>

    await qb.many()
    assert.equal(oql.calls[0].query, 'user {id account {id name}}')
  })

  it('manyToOne (nullable) returns object | null', async () => {
    const oql = mockOQL()
    const qb = query(oql, vehicle).select('id', { driver: ['id', 'firstName'] })

    type Result = Awaited<ReturnType<typeof qb.many>>[number]
    type _ = AssertTrue<
      AssertEqual<Result, { id: string; driver: { id: string; firstName: string } | null }>
    >

    await qb.many()
    assert.equal(oql.calls[0].query, 'vehicle {id driver {id firstName}}')
  })

  it('oneToMany returns array', async () => {
    const oql = mockOQL()
    const qb = query(oql, store).select('id', { vehicles: ['id', 'make', 'model'] })

    type Result = Awaited<ReturnType<typeof qb.many>>[number]
    type _ = AssertTrue<
      AssertEqual<Result, { id: string; vehicles: { id: string; make: string; model: string }[] }>
    >

    await qb.many()
    assert.equal(oql.calls[0].query, 'store {id vehicles {id make model}}')
  })

  it('manyToMany returns array', async () => {
    const oql = mockOQL()
    const qb = query(oql, user).select('id', { stores: ['id', 'name'] })

    type Result = Awaited<ReturnType<typeof qb.many>>[number]
    type _ = AssertTrue<AssertEqual<Result, { id: string; stores: { id: string; name: string }[] }>>

    await qb.many()
    assert.equal(oql.calls[0].query, 'user {id stores {id name}}')
  })

  it('oneToOne (nullable) returns object | null', async () => {
    const oql = mockOQL()
    const qb = query(oql, user).select('id', { vehicle: ['id', 'make', 'model'] })

    type Result = Awaited<ReturnType<typeof qb.many>>[number]
    type _ = AssertTrue<
      AssertEqual<Result, { id: string; vehicle: { id: string; make: string; model: string } | null }>
    >

    await qb.many()
    assert.equal(oql.calls[0].query, 'user {id vehicle {id make model}}')
  })

  it('multiple relations in one selection object', async () => {
    const oql = mockOQL()
    const qb = query(oql, trip).select('id', 'state', {
      vehicle: ['id', 'make'],
      store: ['id', 'name'],
      customer: ['id', 'firstName'],
    })

    type Result = Awaited<ReturnType<typeof qb.many>>[number]
    type _ = AssertTrue<
      AssertEqual<
        Result,
        {
          id: string
          state: TripState
          vehicle: { id: string; make: string } | null
          store: { id: string; name: string }
          customer: { id: string; firstName: string }
        }
      >
    >

    await qb.many()
    assert.equal(
      oql.calls[0].query,
      'trip {id state vehicle {id make} store {id name} customer {id firstName}}',
    )
  })

  it('relation-only selection (no scalars)', async () => {
    const oql = mockOQL()
    const qb = query(oql, user).select({ stores: ['id'] })

    type Result = Awaited<ReturnType<typeof qb.many>>[number]
    type _ = AssertTrue<AssertEqual<Result, { stores: { id: string }[] }>>

    await qb.many()
    assert.equal(oql.calls[0].query, 'user {stores {id}}')
  })

  it('two-level nesting: user → stores → place', async () => {
    const oql = mockOQL()
    const qb = query(oql, user).select('id', {
      stores: ['id', 'name', { place: ['latitude', 'longitude'] }],
    })

    type Result = Awaited<ReturnType<typeof qb.many>>[number]
    type _ = AssertTrue<
      AssertEqual<
        Result,
        {
          id: string
          stores: {
            id: string
            name: string
            place: { latitude: number; longitude: number }
          }[]
        }
      >
    >

    await qb.many()
    assert.equal(oql.calls[0].query, 'user {id stores {id name place {latitude longitude}}}')
  })

  it('three-level nesting: store → trips → customer → places', async () => {
    const oql = mockOQL()
    const qb = query(oql, store).select('id', 'name', {
      trips: ['id', 'state', { customer: ['id', 'firstName', { places: ['id', 'address'] }] }],
    })

    type Result = Awaited<ReturnType<typeof qb.many>>[number]
    type _ = AssertTrue<
      AssertEqual<
        Result,
        {
          id: string
          name: string
          trips: {
            id: string
            state: TripState
            customer: {
              id: string
              firstName: string
              places: { id: string; address: string | null }[]
            }
          }[]
        }
      >
    >

    await qb.many()
    assert.equal(
      oql.calls[0].query,
      'store {id name trips {id state customer {id firstName places {id address}}}}',
    )
  })

  it('three-level nesting: user → stores → vehicles → trips', async () => {
    const oql = mockOQL()
    const qb = query(oql, user).select('id', {
      stores: ['id', { vehicles: ['id', 'make', { trips: ['id', 'state'] }] }],
    })

    type Result = Awaited<ReturnType<typeof qb.many>>[number]
    type _ = AssertTrue<
      AssertEqual<
        Result,
        {
          id: string
          stores: {
            id: string
            vehicles: {
              id: string
              make: string
              trips: { id: string; state: TripState }[]
            }[]
          }[]
        }
      >
    >

    await qb.many()
    assert.equal(
      oql.calls[0].query,
      'user {id stores {id vehicles {id make trips {id state}}}}',
    )
  })

  it('mixed nullable and non-nullable relations in deep nesting', async () => {
    const oql = mockOQL()
    const qb = query(oql, trip).select('id', {
      vehicle: ['id', { driver: ['id', 'firstName'] }],
      store: ['id', { place: ['latitude', 'longitude', 'address'] }],
    })

    type Result = Awaited<ReturnType<typeof qb.many>>[number]
    type _ = AssertTrue<
      AssertEqual<
        Result,
        {
          id: string
          vehicle: {
            id: string
            driver: { id: string; firstName: string } | null
          } | null
          store: {
            id: string
            place: { latitude: number; longitude: number; address: string | null }
          }
        }
      >
    >

    await qb.many()
    assert.equal(
      oql.calls[0].query,
      'trip {id vehicle {id driver {id firstName}} store {id place {latitude longitude address}}}',
    )
  })
})

describe('execution methods', () => {
  it('.one() calls queryOne and returns T | undefined', async () => {
    const oql = mockOQL()
    const qb = query(oql, user).select('id', 'firstName').where(eq(user.id, 'abc'))

    type Result = Awaited<ReturnType<typeof qb.one>>
    type _ = AssertTrue<AssertEqual<Result, { id: string; firstName: string } | undefined>>

    await qb.one()
    assert.equal(oql.calls[0].method, 'queryOne')
    assert.equal(oql.calls[0].query, 'user {id firstName} [id = :p0]')
  })

  it('.many() calls queryMany and returns T[]', async () => {
    const oql = mockOQL()
    const qb = query(oql, user).select('id')

    type Result = Awaited<ReturnType<typeof qb.many>>
    type _ = AssertTrue<AssertEqual<Result, { id: string }[]>>

    await qb.many()
    assert.equal(oql.calls[0].method, 'queryMany')
  })

  it('.count() calls count and returns number', async () => {
    const oql = mockOQL()
    const qb = query(oql, user).where(eq(user.enabled, true))

    type Result = Awaited<ReturnType<typeof qb.count>>
    type _ = AssertTrue<AssertEqual<Result, number>>

    await qb.count()
    assert.equal(oql.calls[0].method, 'count')
    assert.equal(oql.calls[0].query, 'user [enabled = :p0]')
  })
})

describe('filters', () => {
  it('eq', async () => {
    const oql = mockOQL()
    await query(oql, account).select('id').where(eq(account.id, 'abc')).one()
    assert.equal(oql.calls[0].query, 'account {id} [id = :p0]')
    assert.deepEqual(oql.calls[0].params, { p0: 'abc' })
  })

  it('ne', async () => {
    const oql = mockOQL()
    await query(oql, trip).select('id').where(ne(trip.state, 'CANCELLED')).many()
    assert.equal(oql.calls[0].query, 'trip {id} [state != :p0]')
    assert.deepEqual(oql.calls[0].params, { p0: 'CANCELLED' })
  })

  it('gt / gte / lt / lte', async () => {
    const oql = mockOQL()
    await query(oql, trip).select('id').where(gt(trip.seats, 3)).many()
    assert.equal(oql.calls[0].query, 'trip {id} [seats > :p0]')

    await query(oql, trip).select('id').where(gte(trip.seats, 1)).many()
    assert.equal(oql.calls[1].query, 'trip {id} [seats >= :p0]')

    await query(oql, trip).select('id').where(lt(trip.seats, 10)).many()
    assert.equal(oql.calls[2].query, 'trip {id} [seats < :p0]')

    await query(oql, trip).select('id').where(lte(trip.seats, 5)).many()
    assert.equal(oql.calls[3].query, 'trip {id} [seats <= :p0]')
  })

  it('and', async () => {
    const oql = mockOQL()
    await query(oql, user)
      .select('id')
      .where(and(eq(user.enabled, true), eq(user.role, 'ADMIN')))
      .many()
    assert.equal(oql.calls[0].query, 'user {id} [enabled = :p0 AND role = :p1]')
    assert.deepEqual(oql.calls[0].params, { p0: true, p1: 'ADMIN' })
  })

  it('or wraps in parens', async () => {
    const oql = mockOQL()
    await query(oql, user)
      .select('id')
      .where(or(eq(user.role, 'ADMIN'), eq(user.role, 'DISPATCHER')))
      .many()
    assert.equal(oql.calls[0].query, 'user {id} [(role = :p0 OR role = :p1)]')
  })

  it('not', async () => {
    const oql = mockOQL()
    await query(oql, user).select('id').where(not(eq(user.enabled, false))).many()
    assert.equal(oql.calls[0].query, 'user {id} [NOT (enabled = :p0)]')
  })

  it('nested and/or', async () => {
    const oql = mockOQL()
    await query(oql, user)
      .select('id')
      .where(and(eq(user.enabled, true), or(eq(user.role, 'ADMIN'), eq(user.role, 'DISPATCHER'))))
      .many()
    assert.equal(oql.calls[0].query, 'user {id} [enabled = :p0 AND (role = :p1 OR role = :p2)]')
  })

  it('inList', async () => {
    const oql = mockOQL()
    await query(oql, user).select('id').where(inList(user.role, ['ADMIN', 'DISPATCHER'])).many()
    assert.equal(oql.calls[0].query, 'user {id} [role IN :p0]')
    assert.deepEqual(oql.calls[0].params, { p0: ['ADMIN', 'DISPATCHER'] })
  })

  it('notInList', async () => {
    const oql = mockOQL()
    await query(oql, trip)
      .select('id')
      .where(notInList(trip.state, ['COMPLETED', 'CANCELLED']))
      .many()
    assert.equal(oql.calls[0].query, 'trip {id} [state NOT IN :p0]')
  })

  it('like', async () => {
    const oql = mockOQL()
    await query(oql, user).select('id').where(like(user.email, '%@example.com')).many()
    assert.equal(oql.calls[0].query, 'user {id} [email LIKE :p0]')
  })

  it('ilike', async () => {
    const oql = mockOQL()
    await query(oql, user).select('id').where(ilike(user.firstName, '%john%')).many()
    assert.equal(oql.calls[0].query, 'user {id} [firstName ILIKE :p0]')
    assert.deepEqual(oql.calls[0].params, { p0: '%john%' })
  })

  it('between', async () => {
    const oql = mockOQL()
    const start = new Date('2026-01-01')
    const end = new Date('2026-02-01')
    await query(oql, user).select('id').where(between(user.lastLoginAt, start, end)).many()
    assert.equal(oql.calls[0].query, 'user {id} [lastLoginAt BETWEEN :p0 AND :p1]')
    assert.deepEqual(oql.calls[0].params, { p0: start, p1: end })
  })

  it('isNull', async () => {
    const oql = mockOQL()
    await query(oql, user).select('id').where(isNull(user.lastLoginAt)).many()
    assert.equal(oql.calls[0].query, 'user {id} [lastLoginAt IS NULL]')
    assert.deepEqual(oql.calls[0].params, {})
  })

  it('isNotNull', async () => {
    const oql = mockOQL()
    await query(oql, user).select('id').where(isNotNull(user.lastLoginAt)).many()
    assert.equal(oql.calls[0].query, 'user {id} [lastLoginAt IS NOT NULL]')
  })

  it('exists with inner filter', async () => {
    const oql = mockOQL()
    await query(oql, user)
      .select('id')
      .where(exists(user.stores, inList(store.id, ['s1', 's2'])))
      .many()
    assert.equal(oql.calls[0].query, 'user {id} [EXISTS(stores [id IN :p0])]')
    assert.deepEqual(oql.calls[0].params, { p0: ['s1', 's2'] })
  })

  it('exists without inner filter', async () => {
    const oql = mockOQL()
    await query(oql, user).select('id').where(exists(user.stores)).many()
    assert.equal(oql.calls[0].query, 'user {id} [EXISTS(stores)]')
  })
})

describe('ordering and pagination', () => {
  it('single orderBy desc', async () => {
    const oql = mockOQL()
    await query(oql, user).select('id').orderBy(desc(user.lastLoginAt)).many()
    assert.equal(oql.calls[0].query, 'user {id} <lastLoginAt DESC>')
  })

  it('multiple orderBy', async () => {
    const oql = mockOQL()
    await query(oql, user).select('id').orderBy(asc(user.lastName), asc(user.firstName)).many()
    assert.equal(oql.calls[0].query, 'user {id} <lastName ASC, firstName ASC>')
  })

  it('mixed asc/desc', async () => {
    const oql = mockOQL()
    await query(oql, trip).select('id').orderBy(desc(trip.createdAt), asc(trip.state)).many()
    assert.equal(oql.calls[0].query, 'trip {id} <createdAt DESC, state ASC>')
  })

  it('limit only', async () => {
    const oql = mockOQL()
    await query(oql, user).select('id').limit(10).many()
    assert.equal(oql.calls[0].query, 'user {id} |, 10|')
  })

  it('offset only', async () => {
    const oql = mockOQL()
    await query(oql, user).select('id').offset(20).many()
    assert.equal(oql.calls[0].query, 'user {id} |20|')
  })

  it('limit and offset', async () => {
    const oql = mockOQL()
    await query(oql, user).select('id').limit(10).offset(20).many()
    assert.equal(oql.calls[0].query, 'user {id} |20, 10|')
  })
})

describe('toOQL', () => {
  it('returns query string and params without executing', () => {
    const oql = mockOQL()
    const { queryStr, params } = query(oql, user)
      .select('id', 'firstName')
      .where(eq(user.enabled, true))
      .toOQL()
    assert.equal(queryStr, 'user {id firstName} [enabled = :p0]')
    assert.deepEqual(params, { p0: true })
    assert.equal(oql.calls.length, 0)
  })
})

describe('complex end-to-end queries', () => {
  it('paginated user list with search, role filter, EXISTS', async () => {
    const oql = mockOQL()
    const storeIds = ['s1', 's2']
    const search = '%john%'

    const qb = query(oql, user)
      .select('id', 'firstName', 'lastName', 'role', 'email', {
        account: ['id', 'name', 'plan'],
        stores: ['id', 'name'],
      })
      .where(
        and(
          exists(user.stores, inList(store.id, storeIds)),
          eq(user.enabled, true),
          or(ilike(user.firstName, search), ilike(user.lastName, search)),
          eq(user.role, 'DISPATCHER'),
        ),
      )
      .orderBy(desc(user.lastLoginAt))
      .limit(25)
      .offset(0)

    type Result = Awaited<ReturnType<typeof qb.many>>[number]
    type _ = AssertTrue<
      AssertEqual<
        Result,
        {
          id: string
          firstName: string
          lastName: string
          role: Role
          email: string
          account: { id: string; name: string; plan: string }
          stores: { id: string; name: string }[]
        }
      >
    >

    await qb.many()
    assert.equal(
      oql.calls[0].query,
      'user {id firstName lastName role email account {id name plan} stores {id name}} [EXISTS(stores [id IN :p0]) AND enabled = :p1 AND (firstName ILIKE :p2 OR lastName ILIKE :p3) AND role = :p4] <lastLoginAt DESC> |0, 25|',
    )
    assert.deepEqual(oql.calls[0].params, {
      p0: storeIds,
      p1: true,
      p2: search,
      p3: search,
      p4: 'DISPATCHER',
    })
  })

  it('trip detail with 3-level nesting and compound filter', async () => {
    const oql = mockOQL()

    const qb = query(oql, trip)
      .select('id', 'state', 'seats', 'notes', 'createdAt', {
        vehicle: ['id', 'make', 'model', { driver: ['id', 'firstName', 'lastName', 'email'] }],
        store: ['id', 'name', 'color', { place: ['latitude', 'longitude', 'address'] }],
        customer: ['id', 'firstName', 'lastName', 'phone', { places: ['id', 'address'] }],
      })
      .where(
        and(
          inList(trip.state, ['REQUESTED', 'CONFIRMED', 'EN_ROUTE']),
          isNotNull(trip.vehicle),
          gt(trip.seats, 0),
        ),
      )
      .orderBy(desc(trip.createdAt))
      .limit(50)

    type Result = Awaited<ReturnType<typeof qb.many>>[number]
    type _ = AssertTrue<
      AssertEqual<
        Result,
        {
          id: string
          state: TripState
          seats: number
          notes: string | null
          createdAt: Date
          vehicle: {
            id: string
            make: string
            model: string
            driver: { id: string; firstName: string; lastName: string; email: string } | null
          } | null
          store: {
            id: string
            name: string
            color: string
            place: { latitude: number; longitude: number; address: string | null }
          }
          customer: {
            id: string
            firstName: string
            lastName: string
            phone: string
            places: { id: string; address: string | null }[]
          }
        }
      >
    >

    await qb.many()
    assert.equal(
      oql.calls[0].query,
      'trip {id state seats notes createdAt vehicle {id make model driver {id firstName lastName email}} store {id name color place {latitude longitude address}} customer {id firstName lastName phone places {id address}}} [state IN :p0 AND vehicle IS NOT NULL AND seats > :p1] <createdAt DESC> |, 50|',
    )
    assert.deepEqual(oql.calls[0].params, {
      p0: ['REQUESTED', 'CONFIRMED', 'EN_ROUTE'],
      p1: 0,
    })
  })

  it('store dashboard: vehicles with driver info and trip counts', async () => {
    const oql = mockOQL()

    const qb = query(oql, store)
      .select('id', 'name', 'enabled', {
        place: ['latitude', 'longitude'],
        vehicles: [
          'id',
          'make',
          'model',
          'active',
          { driver: ['id', 'firstName', 'lastName', 'role'] },
          { trips: ['id', 'state'] },
        ],
        users: ['id', 'firstName', 'lastName', 'role', 'enabled'],
      })
      .where(and(eq(store.enabled, true), inList(store.id, ['s1', 's2', 's3'])))
      .orderBy(asc(store.name))

    type Result = Awaited<ReturnType<typeof qb.many>>[number]
    type _ = AssertTrue<
      AssertEqual<
        Result,
        {
          id: string
          name: string
          enabled: boolean
          place: { latitude: number; longitude: number }
          vehicles: {
            id: string
            make: string
            model: string
            active: boolean
            driver: { id: string; firstName: string; lastName: string; role: Role } | null
            trips: { id: string; state: TripState }[]
          }[]
          users: {
            id: string
            firstName: string
            lastName: string
            role: Role
            enabled: boolean
          }[]
        }
      >
    >

    await qb.many()
    assert.equal(
      oql.calls[0].query,
      'store {id name enabled place {latitude longitude} vehicles {id make model active driver {id firstName lastName role} trips {id state}} users {id firstName lastName role enabled}} [enabled = :p0 AND id IN :p1] <name ASC>',
    )
  })

  it('find unassigned trips in specific stores with customer details', async () => {
    const oql = mockOQL()
    const now = new Date('2026-03-11T12:00:00Z')
    const hourAgo = new Date('2026-03-11T11:00:00Z')

    const qb = query(oql, trip)
      .select('id', 'state', 'seats', 'createdAt', {
        customer: ['id', 'firstName', 'lastName', 'phone'],
        store: ['id', 'name'],
      })
      .where(
        and(
          isNull(trip.vehicle),
          inList(trip.state, ['REQUESTED']),
          inList(trip.store, ['s1', 's2']),
          between(trip.createdAt, hourAgo, now),
        ),
      )
      .orderBy(asc(trip.createdAt))
      .limit(100)
      .offset(0)

    type Result = Awaited<ReturnType<typeof qb.many>>[number]
    type _ = AssertTrue<
      AssertEqual<
        Result,
        {
          id: string
          state: TripState
          seats: number
          createdAt: Date
          customer: { id: string; firstName: string; lastName: string; phone: string }
          store: { id: string; name: string }
        }
      >
    >

    await qb.many()
    assert.equal(
      oql.calls[0].query,
      'trip {id state seats createdAt customer {id firstName lastName phone} store {id name}} [vehicle IS NULL AND state IN :p0 AND store IN :p1 AND createdAt BETWEEN :p2 AND :p3] <createdAt ASC> |0, 100|',
    )
    assert.deepEqual(oql.calls[0].params, {
      p0: ['REQUESTED'],
      p1: ['s1', 's2'],
      p2: hourAgo,
      p3: now,
    })
  })

  it('user with full profile: account, stores with places, vehicle', async () => {
    const oql = mockOQL()

    const qb = query(oql, user)
      .select('id', 'firstName', 'lastName', 'email', 'role', 'enabled', 'lastLoginAt', {
        account: ['id', 'name', 'enabled', 'plan', 'createdAt'],
        stores: ['id', 'name', 'enabled', 'color', { place: ['id', 'latitude', 'longitude', 'address'] }],
        vehicle: ['id', 'make', 'model', 'year', 'active'],
      })
      .where(eq(user.id, 'user-123'))

    type Result = Awaited<ReturnType<typeof qb.one>>
    type _ = AssertTrue<
      AssertEqual<
        Result,
        | {
            id: string
            firstName: string
            lastName: string
            email: string
            role: Role
            enabled: boolean
            lastLoginAt: Date | null
            account: {
              id: string
              name: string
              enabled: boolean
              plan: string
              createdAt: Date
            }
            stores: {
              id: string
              name: string
              enabled: boolean
              color: string
              place: {
                id: string
                latitude: number
                longitude: number
                address: string | null
              }
            }[]
            vehicle: {
              id: string
              make: string
              model: string
              year: number | null
              active: boolean
            } | null
          }
        | undefined
      >
    >

    await qb.one()
    assert.equal(
      oql.calls[0].query,
      'user {id firstName lastName email role enabled lastLoginAt account {id name enabled plan createdAt} stores {id name enabled color place {id latitude longitude address}} vehicle {id make model year active}} [id = :p0]',
    )
  })

  it('all four relation types in one query with EXISTS on two relations', async () => {
    const oql = mockOQL()

    // user has: manyToOne (account), manyToMany (stores), oneToOne (vehicle)
    // store has: oneToMany (vehicles, trips)
    const qb = query(oql, user)
      .select('id', 'firstName', 'role', {
        account: ['id', 'name'],
        stores: ['id', 'name', { vehicles: ['id', 'make', 'active'] }],
        vehicle: ['id', 'make', 'model', { store: ['id', 'name'] }],
      })
      .where(
        and(
          eq(user.enabled, true),
          exists(user.stores, eq(store.enabled, true)),
          not(exists(user.stores, eq(store.name, 'Closed Store'))),
        ),
      )
      .orderBy(asc(user.lastName))
      .limit(20)

    type Result = Awaited<ReturnType<typeof qb.many>>[number]
    type _ = AssertTrue<
      AssertEqual<
        Result,
        {
          id: string
          firstName: string
          role: Role
          account: { id: string; name: string }
          stores: {
            id: string
            name: string
            vehicles: { id: string; make: string; active: boolean }[]
          }[]
          vehicle: {
            id: string
            make: string
            model: string
            store: { id: string; name: string }
          } | null
        }
      >
    >

    await qb.many()
    assert.equal(
      oql.calls[0].query,
      'user {id firstName role account {id name} stores {id name vehicles {id make active}} vehicle {id make model store {id name}}} [enabled = :p0 AND EXISTS(stores [enabled = :p1]) AND NOT (EXISTS(stores [name = :p2]))] <lastName ASC> |, 20|',
    )
    assert.deepEqual(oql.calls[0].params, {
      p0: true,
      p1: true,
      p2: 'Closed Store',
    })
  })

  it('4-level nesting with nullable propagation at each level', async () => {
    const oql = mockOQL()

    // trip → vehicle (nullable) → driver (nullable) → account → (scalars)
    // trip → store → place → (scalars)
    const qb = query(oql, trip)
      .select('id', 'state', {
        vehicle: ['id', {
          driver: ['id', 'firstName', {
            account: ['id', 'name', 'plan'],
          }],
          store: ['id', 'name'],
        }],
        store: ['id', {
          place: ['id', 'latitude', 'longitude', 'address'],
        }],
      })
      .where(eq(trip.id, 't-1'))

    type Result = Awaited<ReturnType<typeof qb.one>>
    type _ = AssertTrue<
      AssertEqual<
        Result,
        | {
            id: string
            state: TripState
            vehicle: {
              id: string
              driver: {
                id: string
                firstName: string
                account: { id: string; name: string; plan: string }
              } | null
              store: { id: string; name: string }
            } | null
            store: {
              id: string
              place: {
                id: string
                latitude: number
                longitude: number
                address: string | null
              }
            }
          }
        | undefined
      >
    >

    await qb.one()
    assert.equal(
      oql.calls[0].query,
      'trip {id state vehicle {id driver {id firstName account {id name plan}} store {id name}} store {id place {id latitude longitude address}}} [id = :p0]',
    )
  })

  it('same entity reached through different relation paths', async () => {
    const oql = mockOQL()

    // store appears twice: once through trip.store, once through trip.vehicle.store
    // place appears through both store paths
    const qb = query(oql, trip)
      .select('id', {
        store: ['id', 'name', { place: ['latitude', 'longitude'] }],
        vehicle: ['id', { store: ['id', 'name', { place: ['latitude', 'longitude'] }] }],
      })
      .where(inList(trip.state, ['REQUESTED', 'CONFIRMED']))

    type Result = Awaited<ReturnType<typeof qb.many>>[number]
    type _ = AssertTrue<
      AssertEqual<
        Result,
        {
          id: string
          store: {
            id: string
            name: string
            place: { latitude: number; longitude: number }
          }
          vehicle: {
            id: string
            store: {
              id: string
              name: string
              place: { latitude: number; longitude: number }
            }
          } | null
        }
      >
    >

    await qb.many()
    assert.equal(
      oql.calls[0].query,
      'trip {id store {id name place {latitude longitude}} vehicle {id store {id name place {latitude longitude}}}} [state IN :p0]',
    )
  })

  it('oneToMany with nested manyToMany and filtering', async () => {
    const oql = mockOQL()

    // store → trips (oneToMany) → customer → places (manyToMany)
    // store → users (manyToMany) with scalar selection
    const qb = query(oql, store)
      .select('id', 'name', {
        trips: ['id', 'state', 'seats', {
          customer: ['id', 'firstName', 'phone', {
            places: ['id', 'latitude', 'longitude'],
          }],
        }],
        users: ['id', 'firstName', 'lastName', 'email', 'role'],
      })
      .where(
        and(
          eq(store.enabled, true),
          exists(store.trips, inList(trip.state, ['REQUESTED', 'EN_ROUTE'])),
          exists(store.users, eq(user.role, 'DRIVER')),
        ),
      )
      .orderBy(asc(store.name))

    type Result = Awaited<ReturnType<typeof qb.many>>[number]
    type _ = AssertTrue<
      AssertEqual<
        Result,
        {
          id: string
          name: string
          trips: {
            id: string
            state: TripState
            seats: number
            customer: {
              id: string
              firstName: string
              phone: string
              places: { id: string; latitude: number; longitude: number }[]
            }
          }[]
          users: {
            id: string
            firstName: string
            lastName: string
            email: string
            role: Role
          }[]
        }
      >
    >

    await qb.many()
    assert.equal(
      oql.calls[0].query,
      'store {id name trips {id state seats customer {id firstName phone places {id latitude longitude}}} users {id firstName lastName email role}} [enabled = :p0 AND EXISTS(trips [state IN :p1]) AND EXISTS(users [role = :p2])] <name ASC>',
    )
    assert.deepEqual(oql.calls[0].params, {
      p0: true,
      p1: ['REQUESTED', 'EN_ROUTE'],
      p2: 'DRIVER',
    })
  })

  it('vehicle with bidirectional relation traversal', async () => {
    const oql = mockOQL()

    // vehicle → driver (manyToOne, nullable) → stores (manyToMany) → place (manyToOne)
    // vehicle → store (manyToOne) → users (manyToMany)
    // vehicle → trips (oneToMany) → customer
    const qb = query(oql, vehicle)
      .select('id', 'make', 'model', 'active', {
        driver: ['id', 'firstName', 'lastName', {
          stores: ['id', 'name'],
        }],
        store: ['id', 'name', {
          users: ['id', 'firstName', 'role'],
          place: ['latitude', 'longitude'],
        }],
        trips: ['id', 'state', {
          customer: ['id', 'firstName', 'lastName'],
        }],
      })
      .where(
        and(
          eq(vehicle.active, true),
          isNotNull(vehicle.driver),
          exists(vehicle.trips, ne(trip.state, 'CANCELLED')),
        ),
      )
      .orderBy(desc(vehicle.make), asc(vehicle.model))
      .limit(50)
      .offset(100)

    type Result = Awaited<ReturnType<typeof qb.many>>[number]
    type _ = AssertTrue<
      AssertEqual<
        Result,
        {
          id: string
          make: string
          model: string
          active: boolean
          driver: {
            id: string
            firstName: string
            lastName: string
            stores: { id: string; name: string }[]
          } | null
          store: {
            id: string
            name: string
            users: { id: string; firstName: string; role: Role }[]
            place: { latitude: number; longitude: number }
          }
          trips: {
            id: string
            state: TripState
            customer: { id: string; firstName: string; lastName: string }
          }[]
        }
      >
    >

    await qb.many()
    assert.equal(
      oql.calls[0].query,
      'vehicle {id make model active driver {id firstName lastName stores {id name}} store {id name users {id firstName role} place {latitude longitude}} trips {id state customer {id firstName lastName}}} [active = :p0 AND driver IS NOT NULL AND EXISTS(trips [state != :p1])] <make DESC, model ASC> |100, 50|',
    )
    assert.deepEqual(oql.calls[0].params, {
      p0: true,
      p1: 'CANCELLED',
    })
  })

  it('customer with manyToMany places, queried through trip with full chain', async () => {
    const oql = mockOQL()

    // trip → customer → places (manyToMany)
    // trip → store → vehicles → driver (nullable)
    const qb = query(oql, trip)
      .select('id', 'state', 'createdAt', {
        customer: ['id', 'firstName', 'lastName', 'phone', 'tags', {
          places: ['id', 'latitude', 'longitude', 'address'],
        }],
        store: ['id', 'name', {
          vehicles: ['id', 'make', 'active', {
            driver: ['id', 'firstName'],
          }],
        }],
      })
      .where(
        and(
          inList(trip.state, ['CONFIRMED', 'EN_ROUTE']),
          gt(trip.seats, 0),
          between(trip.createdAt, new Date('2026-03-01'), new Date('2026-03-11')),
          not(isNull(trip.customer)),
        ),
      )
      .orderBy(desc(trip.createdAt))

    type Result = Awaited<ReturnType<typeof qb.many>>[number]
    type _ = AssertTrue<
      AssertEqual<
        Result,
        {
          id: string
          state: TripState
          createdAt: Date
          customer: {
            id: string
            firstName: string
            lastName: string
            phone: string
            tags: string[] | null
            places: {
              id: string
              latitude: number
              longitude: number
              address: string | null
            }[]
          }
          store: {
            id: string
            name: string
            vehicles: {
              id: string
              make: string
              active: boolean
              driver: { id: string; firstName: string } | null
            }[]
          }
        }
      >
    >

    await qb.many()
    assert.equal(
      oql.calls[0].query,
      'trip {id state createdAt customer {id firstName lastName phone tags places {id latitude longitude address}} store {id name vehicles {id make active driver {id firstName}}}} [state IN :p0 AND seats > :p1 AND createdAt BETWEEN :p2 AND :p3 AND NOT (customer IS NULL)] <createdAt DESC>',
    )
  })
})

describe('generateDM', () => {
  it('generates entity with table alias', () => {
    const dm = generateDM(account)
    assert.ok(dm.includes('entity account (accounts)'))
  })

  it('generates primary key', () => {
    const dm = generateDM(account)
    assert.ok(dm.includes('*id: uuid'))
  })

  it('generates required text field', () => {
    const dm = generateDM(account)
    assert.ok(dm.includes(' name: text!'))
  })

  it('generates nullable field without !', () => {
    const dm = generateDM(place)
    assert.match(dm, / address: text\n/)
  })

  it('generates manyToOne with column alias', () => {
    const dm = generateDM(store)
    assert.ok(dm.includes('place (place_id): place!'))
  })

  it('generates oneToMany', () => {
    const dm = generateDM(store)
    assert.ok(dm.includes('vehicles: [vehicle]'))
  })

  it('generates manyToMany with junction', () => {
    const dm = generateDM(store)
    assert.ok(dm.includes('users: [user] (users_stores)'))
  })

  it('generates oneToOne with reference', () => {
    const dm = generateDM(user)
    assert.ok(dm.includes('vehicle: <vehicle>.driver'))
  })

  it('generates enum', () => {
    const dm = generateDM(user)
    assert.ok(dm.includes('enum Role { ADMIN DISPATCHER DRIVER }'))
  })

  it('generates boolean as bool', () => {
    const dm = generateDM(account)
    assert.ok(dm.includes(' enabled: bool!'))
  })

  it('generates nullable manyToOne without !', () => {
    const dm = generateDM(vehicle)
    assert.match(dm, /driver \(driver_id\): user\n/)
  })

  it('generates required manyToOne with !', () => {
    const dm = generateDM(vehicle)
    assert.ok(dm.includes('store (store_id): store!'))
  })
})

describe('parseDM', () => {
  it('parses enum', () => {
    const r = parseDM("enum Role { 'ADMIN' 'DRIVER' }")
    assert.equal(r.enums.length, 1)
    assert.equal(r.enums[0].name, 'Role')
    assert.deepEqual(r.enums[0].values, ['ADMIN', 'DRIVER'])
  })

  it('parses entity with table alias', () => {
    const r = parseDM('entity account (accounts) { *id: uuid }')
    assert.equal(r.entities[0].name, 'account')
    assert.equal(r.entities[0].tableName, 'accounts')
  })

  it('parses entity without table alias', () => {
    const r = parseDM('entity account { *id: uuid }')
    assert.equal(r.entities[0].tableName, undefined)
  })

  it('parses primary key', () => {
    const r = parseDM('entity foo { *id: uuid }')
    assert.equal(r.entities[0].fields[0].isPrimaryKey, true)
  })

  it('parses required field', () => {
    const r = parseDM('entity foo { *id: uuid\n name: text! }')
    assert.equal(r.entities[0].fields[1].isRequired, true)
  })

  it('parses nullable field', () => {
    const r = parseDM('entity foo { *id: uuid\n name: text }')
    assert.equal(r.entities[0].fields[1].isRequired, false)
  })

  it('parses column alias', () => {
    const r = parseDM('entity foo { *id: uuid\n firstName (first_name): text! }')
    assert.equal(r.entities[0].fields[1].columnAlias, 'first_name')
  })

  it('parses manyToOne', () => {
    const r = parseDM('entity foo { *id: uuid\n bar (bar_id): bar! }')
    const f = r.entities[0].fields[1]
    assert.equal(f.type.kind, 'manyToOne')
    if (f.type.kind === 'manyToOne') assert.equal(f.type.target, 'bar')
  })

  it('parses oneToMany', () => {
    const r = parseDM('entity foo { *id: uuid\n bars: [bar] }')
    assert.equal(r.entities[0].fields[1].type.kind, 'oneToMany')
  })

  it('parses manyToMany', () => {
    const r = parseDM('entity foo { *id: uuid\n bars: [bar] (foo_bars) }')
    const f = r.entities[0].fields[1]
    assert.equal(f.type.kind, 'manyToMany')
    if (f.type.kind === 'manyToMany') assert.equal(f.type.junction, 'foo_bars')
  })

  it('parses oneToOne with reference', () => {
    const r = parseDM('entity foo { *id: uuid\n bar: <bar>.baz }')
    const f = r.entities[0].fields[1]
    assert.equal(f.type.kind, 'oneToOne')
    if (f.type.kind === 'oneToOne') assert.equal(f.type.reference, 'baz')
  })

  it('parses multiple entities', () => {
    const r = parseDM(`
      entity account { *id: uuid name: text! }
      entity user { *id: uuid email: text! account (account_id): account! }
    `)
    assert.equal(r.entities.length, 2)
  })
})

describe('generateSchemaTS', () => {
  it('generates valid TypeScript from parsed DM', () => {
    const dm = `
      enum Role { 'ADMIN' 'DRIVER' }
      entity account (accounts) {
        *id: uuid
        name: text!
        enabled: bool!
      }
      entity user (users) {
        *id: uuid
        firstName (first_name): text!
        enabled: bool!
        account (account_id): account!
        stores: [store] (users_stores)
      }
    `
    const ts = generateSchemaTS(parseDM(dm))

    assert.ok(ts.includes("from '@vinctus/oql-typed'"))
    assert.ok(ts.includes("export type Role = 'ADMIN' | 'DRIVER'"))
    assert.ok(ts.includes("export const account = entity('account', 'accounts'"))
    assert.ok(ts.includes('id: uuid().primaryKey()'))
    assert.ok(ts.includes('name: text()'))
    assert.ok(ts.includes('enabled: boolean_()'))
    assert.ok(ts.includes("firstName: text().column('first_name')"))
    assert.ok(ts.includes("manyToOne(() => account, { column: 'account_id' })"))
    assert.ok(ts.includes("manyToMany(() => store, { junction: 'users_stores' })"))
  })
})
