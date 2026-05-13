/**
 * COMPILE-TIME TYPE ASSERTIONS.
 *
 * These tests verify that TypeScript infers the correct types for every
 * pattern identified in the shuttlecontrol-api audit. They have minimal
 * runtime (just a single dummy test) — the real verification happens during
 * `tsc --project tsconfig.typecheck.json` (run before the runtime tests).
 *
 * Negative assertions use `@ts-expect-error` — if the directive is "unused",
 * that means the bad code compiled and the type system has a gap.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { typedOQL } from './db.js'
import { query } from './query.js'
import { queryBuilder } from './query-builder.js'
import { insert, update } from './mutations.js'
import { eq, ne, and, or, ilike, inList, isNull, isNotNull, between, exists, desc, asc } from './operators.js'
import { alias, aliasedRelation, fn, raw, ref, subquery } from './expressions.js'
import type { FieldRef, Prettify } from './types.js'

import { schema, ID, type Role, type TripState } from './test-schema.js'

// These tests are evaluated at TYPE-CHECK time, not runtime.
// We still need a runtime `db` value because the assertion helper types
// use `typeof db.x` — TypeScript evaluates those lazily, but to be safe
// we give it a dummy OQLInstance that's never called.
const oql: import('./db.js').OQLInstance = {
  queryOne: () => Promise.resolve(undefined),
  queryMany: () => Promise.resolve([]),
  count: () => Promise.resolve(0),
  entity: () => ({
    insert: () => Promise.resolve({}) as any,
    update: () => Promise.resolve({}) as any,
  }),
}
const db = typedOQL(oql, schema)

type AssertEqual<T, U> = [T] extends [U] ? ([U] extends [T] ? true : false) : false
type AssertTrue<T extends true> = T

// ═══════════════════════════════════════════════════════════════════
// FIELD REF INFERENCE
// ═══════════════════════════════════════════════════════════════════

describe('type: field ref inference', () => {
  it('placeholder (real assertions at type level)', () => assert.ok(true))

  // --- Direct scalar access ---
  type T1 = AssertTrue<AssertEqual<typeof db.user.id, FieldRef<string>>>
  type T2 = AssertTrue<AssertEqual<typeof db.user.firstName, FieldRef<string>>>
  type T3 = AssertTrue<AssertEqual<typeof db.user.enabled, FieldRef<boolean>>>
  type T4 = AssertTrue<AssertEqual<typeof db.user.role, FieldRef<Role>>>
  type T5 = AssertTrue<AssertEqual<typeof db.user.lastLoginAt, FieldRef<Date | null>>>

  // --- Dotted path: manyToOne through schema index ---
  type T6 = AssertTrue<AssertEqual<typeof db.user.account.id, FieldRef<string>>>
  type T7 = AssertTrue<AssertEqual<typeof db.user.account.name, FieldRef<string>>>
  type T8 = AssertTrue<AssertEqual<typeof db.user.account.enabled, FieldRef<boolean>>>

  // --- Multi-level dotted path ---
  type T9 = AssertTrue<AssertEqual<typeof db.trip.store.account.id, FieldRef<string>>>
  type T10 = AssertTrue<AssertEqual<typeof db.trip.store.account.name, FieldRef<string>>>

  // --- Self-referential manyToOne (trip.returnTripFor → trip) ---
  // returnTripFor is a nullable manyToOne: any field reached through it is
  // nullable regardless of the column's own nullability.
  type T11 = AssertTrue<AssertEqual<typeof db.trip.returnTripFor.id, FieldRef<string | null>>>
  type T12 = AssertTrue<
    AssertEqual<typeof db.trip.returnTripFor.state, FieldRef<TripState | null>>
  >
  // Chained through a nullable hop stays nullable even if subsequent hops are non-null
  type T11a = AssertTrue<
    AssertEqual<typeof db.trip.returnTripFor.store.id, FieldRef<string | null>>
  >

  // --- Enum type narrows to literal union ---
  type T13 = AssertTrue<AssertEqual<typeof db.trip.state, FieldRef<TripState>>>
})

// ═══════════════════════════════════════════════════════════════════
// NEGATIVE FIELD REF TESTS
// ═══════════════════════════════════════════════════════════════════

describe('type: field ref negatives', () => {
  it('placeholder', () => assert.ok(true))

  // @ts-expect-error — typo: firstName spelled wrong
  type N1 = typeof db.user.fistName

  // @ts-expect-error — oneToMany RelationRef has no scalar fields to dot into
  type N2 = typeof db.account.users.firstName

  // @ts-expect-error — manyToMany RelationRef has no scalar fields to dot into
  type N3 = typeof db.user.stores.name
})

// ═══════════════════════════════════════════════════════════════════
// PROJECTION RESULT TYPES
// ═══════════════════════════════════════════════════════════════════

describe('type: projection inference', () => {
  it('placeholder', () => assert.ok(true))

  // --- No selection — all scalars, no relations ---
  async function _all() {
    const r = await query(db, 'account').many()
    type _ = AssertTrue<
      AssertEqual<
        (typeof r)[number],
        { id: string; name: string; enabled: boolean; plan: string; createdAt: Date }
      >
    >
  }

  // --- Explicit scalar selection ---
  async function _scalars() {
    const r = await query(db, 'user').select('id', 'firstName', 'email').one()
    type _ = AssertTrue<
      AssertEqual<typeof r, { id: string; firstName: string; email: string } | undefined>
    >
  }

  // --- Nullable scalar preserves null ---
  async function _nullable() {
    const r = await query(db, 'user').select('id', 'lastLoginAt').one()
    type _ = AssertTrue<AssertEqual<typeof r, { id: string; lastLoginAt: Date | null } | undefined>>
  }

  // --- Nested manyToOne: non-nullable relation ---
  async function _m2oReq() {
    const r = await query(db, 'user')
      .select('id', { account: ['id', 'name'] })
      .one()
    type _ = AssertTrue<
      AssertEqual<typeof r, { id: string; account: { id: string; name: string } } | undefined>
    >
  }

  // --- Single-field shorthand: { account: 'name' } ≡ { account: ['name'] } ---
  async function _m2oShorthand() {
    const r = await query(db, 'user')
      .select('id', { account: 'name' })
      .one()
    type _ = AssertTrue<
      AssertEqual<typeof r, { id: string; account: { name: string } } | undefined>
    >
  }

  // --- Single-field shorthand on nullable manyToOne preserves null ---
  async function _m2oShorthandNullable() {
    const r = await query(db, 'trip')
      .select('id', { vehicle: 'make' })
      .one()
    type _ = AssertTrue<
      AssertEqual<typeof r, { id: string; vehicle: { make: string } | null } | undefined>
    >
  }

  // --- Single-field shorthand on oneToMany returns array ---
  async function _o2mShorthand() {
    const r = await query(db, 'store')
      .select('id', { trips: 'id' })
      .one()
    type _ = AssertTrue<
      AssertEqual<typeof r, { id: string; trips: { id: string }[] } | undefined>
    >
  }

  // --- Nested manyToOne: nullable relation ---
  async function _m2oNull() {
    const r = await query(db, 'trip')
      .select('id', { vehicle: ['id', 'make'] })
      .one()
    type _ = AssertTrue<
      AssertEqual<
        typeof r,
        { id: string; vehicle: { id: string; make: string } | null } | undefined
      >
    >
  }

  // Narrowing a nullable manyToOne in a projection result preserves the
  // fields' non-nullable types (regression test for a false-alarm bug
  // report that was actually caused by an entity class with `id: string |
  // undefined` being mixed into the inferred type via an `as Entity` cast
  // on a caller side).
  async function _m2oNullNarrowing() {
    const r = await query(db, 'trip')
      .select('id', { vehicle: ['id', 'make'] })
      .one()
    if (r && r.vehicle) {
      const vehicleId: string = r.vehicle.id
      type _V = AssertTrue<AssertEqual<typeof vehicleId, string>>
    }
  }

  // --- Nested oneToMany: array ---
  async function _o2m() {
    const r = await query(db, 'store')
      .select('id', { trips: ['id', 'state'] })
      .one()
    type _ = AssertTrue<
      AssertEqual<
        typeof r,
        { id: string; trips: { id: string; state: TripState }[] } | undefined
      >
    >
  }

  // --- Nested manyToMany: array ---
  async function _m2m() {
    const r = await query(db, 'user')
      .select('id', { stores: ['id', 'name'] })
      .one()
    type _ = AssertTrue<
      AssertEqual<typeof r, { id: string; stores: { id: string; name: string }[] } | undefined>
    >
  }

  // --- Deep nesting: trip → vehicle → driver (mixed nullables) ---
  async function _deep() {
    const r = await query(db, 'trip')
      .select('id', 'state', {
        vehicle: ['make', { driver: ['firstName', 'lastName'] }],
      })
      .one()
    type _ = AssertTrue<
      AssertEqual<
        typeof r,
        {
          id: string
          state: TripState
          vehicle: {
            make: string
            driver: { firstName: string; lastName: string } | null
          } | null
        } | undefined
      >
    >
  }

  // --- Filtered sub-collection ---
  async function _filtered() {
    const r = await query(db, 'store')
      .select('id', {
        trips: {
          fields: ['id', 'seats'],
          where: ne(db.trip.state, 'CANCELLED'),
          orderBy: [desc(db.trip.createdAt)],
        },
      })
      .one()
    type _ = AssertTrue<
      AssertEqual<
        typeof r,
        { id: string; trips: { id: string; seats: number }[] } | undefined
      >
    >
  }

  // --- Filtered sub-collection: fields shorthand (single string) ---
  async function _filteredShorthand() {
    const r = await query(db, 'store')
      .select('id', {
        trips: {
          fields: 'id',
          where: ne(db.trip.state, 'CANCELLED'),
        },
      })
      .one()
    type _ = AssertTrue<
      AssertEqual<typeof r, { id: string; trips: { id: string }[] } | undefined>
    >
  }

  // --- Aliased projection: contributes typed key to result ---
  async function _alias() {
    const r = await query(db, 'trip')
      .select('id', alias('returnTripId', db.trip.returnTripFor.id))
      .one()
    type _ = AssertTrue<
      AssertEqual<typeof r, { id: string; returnTripId: string | null } | undefined>
    >
  }

  // --- Aliased relation: explicit inner Shape, label inferred ---
  async function _aliasedRelation() {
    const r = await query(db, 'vehicle')
      .select(
        'id',
        'make',
        aliasedRelation<{ count: number }>('passengers', 'trips', {
          fields: [raw('count: sum(seats)')],
          where: ne(db.trip.state, 'COMPLETED'),
        }),
      )
      .one()
    // Direct field access is what matters in practice:
    type _Count = NonNullable<typeof r>['passengers'][number]['count']
    type _ = AssertTrue<AssertEqual<_Count, number>>
    type _Id = NonNullable<typeof r>['id']
    type __ = AssertTrue<AssertEqual<_Id, string>>
  }

  // --- Aliased relation: shape fully inferred from typed fields ---
  async function _aliasedRelationInferred() {
    const { sum } = await import('./functions.js')
    const r = await query(db, 'vehicle')
      .select(
        'id',
        aliasedRelation('passengers', 'trips', {
          fields: [alias('total', sum(db.trip.seats))],
        }),
      )
      .one()
    // Field-access style: typed fields produce typed row shape
    type _Total = NonNullable<typeof r>['passengers'][number]['total']
    type _ = AssertTrue<AssertEqual<_Total, number | null>>
  }
})

// ═══════════════════════════════════════════════════════════════════
// NEGATIVE PROJECTION TESTS
// ═══════════════════════════════════════════════════════════════════

describe('type: projection negatives', () => {
  it('placeholder', () => assert.ok(true))

  async function _typo() {
    // @ts-expect-error — 'fistName' isn't a field
    await query(db, 'user').select('fistName').one()
  }

  async function _wrongRelation() {
    // @ts-expect-error — 'bogus' isn't a relation on user
    await query(db, 'user').select({ bogus: ['id'] }).one()
  }

  async function _resultOutOfScope() {
    const r = await query(db, 'user').select('id').one()
    // @ts-expect-error — firstName wasn't selected
    r?.firstName
  }
})

// ═══════════════════════════════════════════════════════════════════
// FILTER OPERATORS
// ═══════════════════════════════════════════════════════════════════

describe('type: filter operators', () => {
  it('placeholder', () => assert.ok(true))

  // --- eq on scalar ---
  async function _eq() {
    await query(db, 'user').where(eq(db.user.enabled, true)).many()
  }

  // --- eq on manyToOne FK (auto-resolves to store.id) ---
  async function _eqFK() {
    await query(db, 'trip').where(eq(db.trip.store, ID.s1)).many()
  }

  // --- eq on dotted path (store.account.id = :accountId) ---
  async function _eqDotted() {
    await query(db, 'trip').where(eq(db.trip.store.account.id, ID.a1)).many()
  }

  // --- inList with parameter array ---
  async function _in() {
    await query(db, 'trip').where(inList(db.trip.state, ['CONFIRMED', 'REQUESTED'])).many()
  }

  // --- AND / OR / NOT combinations ---
  async function _compound() {
    await query(db, 'trip')
      .where(
        and(
          eq(db.trip.store, ID.s1),
          or(eq(db.trip.state, 'CONFIRMED'), eq(db.trip.state, 'REQUESTED')),
        ),
      )
      .many()
  }

  // --- EXISTS with inner filter ---
  async function _exists() {
    await query(db, 'user').where(exists(db.user.stores, eq(db.store.id, ID.s1))).many()
  }

  // --- IS NULL / IS NOT NULL on scalar ---
  async function _nulls() {
    await query(db, 'user').where(isNull(db.user.lastLoginAt)).many()
    await query(db, 'user').where(isNotNull(db.user.lastLoginAt)).many()
  }

  // --- & reference operator: &returnTripFor IS NULL ---
  async function _ref() {
    await query(db, 'trip').where(isNull(ref(db.trip.returnTripFor))).many()
  }

  // --- BETWEEN on timestamp ---
  async function _between() {
    await query(db, 'trip')
      .where(between(db.trip.createdAt, new Date('2024-01-01'), new Date('2024-12-31')))
      .many()
  }

  // --- ILIKE via function call: concat(first, ' ', last) ILIKE :search ---
  async function _concatIlike() {
    await query(db, 'customer')
      .where(
        ilike(fn<string>('concat', db.customer.firstName, raw("' '"), db.customer.lastName), '%john%'),
      )
      .many()
  }

  // --- count(*) subquery: (drivers {count(*)}) = 0 ---
  async function _subquery() {
    await query(db, 'vehicle').where(eq(subquery<number>(db.vehicle.trips, ['count(*)']), 0)).many()
  }
})

// ═══════════════════════════════════════════════════════════════════
// NEGATIVE FILTER TESTS
// ═══════════════════════════════════════════════════════════════════

describe('type: filter operator negatives', () => {
  it('placeholder', () => assert.ok(true))

  async function _wrongValueType() {
    // @ts-expect-error — enabled is boolean, not string
    eq(db.user.enabled, 'yes')
  }

  async function _wrongEnumValue() {
    // @ts-expect-error — 'SUPERADMIN' isn't in Role union
    eq(db.user.role, 'SUPERADMIN')
  }

  async function _ilikeOnNonString() {
    // @ts-expect-error — ilike requires FieldRef<string>, seats is number
    ilike(db.trip.seats, '%2%')
  }
})

// ═══════════════════════════════════════════════════════════════════
// findBy — sugar for .where(eq(...))
// ═══════════════════════════════════════════════════════════════════

describe('type: findBy', () => {
  it('placeholder', () => assert.ok(true))

  // --- findBy on scalar ---
  async function _findByScalar() {
    await query(db, 'user').findBy(db.user.enabled, true).many()
  }

  // --- findBy on enum ---
  async function _findByEnum() {
    await query(db, 'trip').findBy(db.trip.state, 'CONFIRMED').many()
  }

  // --- findBy on manyToOne FK (auto-resolves to .id) ---
  async function _findByFK() {
    await query(db, 'trip').findBy(db.trip.store, ID.s1).many()
  }

  // --- findBy on dotted path ---
  async function _findByDotted() {
    await query(db, 'trip').findBy(db.trip.store.account.id, ID.a1).many()
  }

  // --- starter findBy + terminator ---
  async function _starterFindBy() {
    const r = await db.user.findBy(db.user.id, ID.u1).one()
    void r
  }

  // --- starter findBy after select(): result is narrow projection ---
  async function _starterFindByWithSelect() {
    const r = await db.user.select('id', 'firstName').findBy(db.user.id, ID.u1).one()
    // r is { id; firstName } | undefined — accessing firstName must compile
    void r?.firstName
  }

  // --- chained findBy returns the builder (chainable) ---
  async function _findByChainable() {
    await query(db, 'user').findBy(db.user.enabled, true).findBy(db.user.role, 'DRIVER').many()
  }

  // --- findBy on queryBuilder() (CondQueryBuilder) ---
  async function _condFindBy() {
    await queryBuilder(db, 'user').select('id').findBy(db.user.enabled, true).many()
  }
})

describe('type: findBy negatives', () => {
  it('placeholder', () => assert.ok(true))

  async function _wrongValueType() {
    // @ts-expect-error — enabled is boolean, not string
    query(db, 'user').findBy(db.user.enabled, 'yes')
  }

  async function _wrongEnumValue() {
    // @ts-expect-error — 'SUPERADMIN' isn't in Role union
    query(db, 'user').findBy(db.user.role, 'SUPERADMIN')
  }

  async function _wrongFKValueType() {
    // @ts-expect-error — FK accepts string|number, not boolean
    query(db, 'trip').findBy(db.trip.store, true)
  }
})

// ═══════════════════════════════════════════════════════════════════
// findIn — sugar for .where(inList(...))
// ═══════════════════════════════════════════════════════════════════

describe('type: findIn', () => {
  it('placeholder', () => assert.ok(true))

  async function _findInEnum() {
    await query(db, 'trip').findIn(db.trip.state, ['CONFIRMED', 'REQUESTED']).many()
  }

  async function _findInFK() {
    await query(db, 'trip').findIn(db.trip.store, [ID.s1]).many()
  }

  async function _findInChainable() {
    await query(db, 'trip').findBy(db.trip.store, ID.s1).findIn(db.trip.state, ['CONFIRMED']).many()
  }

  async function _starterFindIn() {
    const r = await db.user.select('id').findIn(db.user.id, [ID.u1, ID.u2]).many()
    void r
  }

  async function _condFindIn() {
    await queryBuilder(db, 'trip').select('id').findIn(db.trip.state, ['CONFIRMED']).many()
  }
})

describe('type: findIn negatives', () => {
  it('placeholder', () => assert.ok(true))

  async function _wrongValueType() {
    // @ts-expect-error — enabled is boolean, not string
    query(db, 'user').findIn(db.user.enabled, ['yes', 'no'])
  }

  async function _wrongEnumValue() {
    // @ts-expect-error — 'SUPERADMIN' isn't in Role union
    query(db, 'user').findIn(db.user.role, ['SUPERADMIN'])
  }

  async function _bareValueNotArray() {
    // @ts-expect-error — findIn requires an array
    query(db, 'trip').findIn(db.trip.state, 'CONFIRMED')
  }
})

// ═══════════════════════════════════════════════════════════════════
// findById — PK lookup sugar, auto-terminates
// ═══════════════════════════════════════════════════════════════════

describe('type: findById', () => {
  it('placeholder', () => assert.ok(true))

  // --- starter findById returns Promise<DefaultProjection | undefined> ---
  async function _starterFindById() {
    const r = await db.user.findById(ID.u1)
    // r is DefaultProjection<'user'> | undefined
    void r?.firstName
    void r?.email
  }

  // --- findById after select() narrows the result shape ---
  async function _findByIdNarrowed() {
    const r = await db.user.select('id', 'firstName').findById(ID.u1)
    void r?.firstName
  }

  // --- query() entry point form ---
  async function _queryFindById() {
    const r = await query(db, 'trip').findById(ID.t1)
    void r?.state
  }

  // --- findById accepts the PK type (string for uuid) ---
  async function _findByIdString() {
    await query(db, 'user').findById('any-string-uuid')
  }
})

describe('type: findById negatives', () => {
  it('placeholder', () => assert.ok(true))

  async function _wrongIdType() {
    // @ts-expect-error — id is string (uuid), not number
    await query(db, 'user').findById(42)
  }

  async function _wrongIdTypeViaStarter() {
    // @ts-expect-error — id is string (uuid), not boolean
    await db.user.findById(true)
  }

  async function _narrowedShapeBlocksOtherFields() {
    const r = await db.user.select('id').findById(ID.u1)
    // @ts-expect-error — firstName is not in the projected shape
    void r?.firstName
  }
})

// ═══════════════════════════════════════════════════════════════════
// ORDERING / PAGINATION
// ═══════════════════════════════════════════════════════════════════

describe('type: ordering / pagination', () => {
  it('placeholder', () => assert.ok(true))

  async function _asc() {
    await query(db, 'user').select('id', 'firstName').orderBy(asc(db.user.firstName)).many()
  }
  async function _descMulti() {
    await query(db, 'trip')
      .select('id')
      .orderBy(desc(db.trip.createdAt), asc(db.trip.seats))
      .many()
  }
  async function _pagination() {
    await query(db, 'user').select('id').limit(20).offset(40).many()
  }
})

// ═══════════════════════════════════════════════════════════════════
// MUTATIONS
// ═══════════════════════════════════════════════════════════════════

describe('type: mutations', () => {
  it('placeholder', () => assert.ok(true))

  async function _insertBasic() {
    const r = await insert(db, 'account', {
      id: 'x',
      name: 'Foo',
      enabled: true,
      plan: 'pro',
      createdAt: new Date(),
    })
    type _ = AssertTrue<
      AssertEqual<
        typeof r,
        { id: string; name: string; enabled: boolean; plan: string; createdAt: Date }
      >
    >
  }

  async function _insertWithFK() {
    // manyToOne FK accepted as string (the target PK)
    await insert(db, 'user', {
      id: 'x',
      firstName: 'A',
      lastName: 'B',
      email: 'a@b',
      role: 'ADMIN',
      enabled: true,
      account: 'some-account-id', // FK accepts string
    })
  }

  async function _update() {
    const r = await update(db, 'user', 'some-id', { firstName: 'Alicia' })
    // update returns partial, so all fields optional
    type _ = AssertTrue<AssertEqual<typeof r, Prettify<Partial<{
      id: string
      firstName: string
      lastName: string
      email: string
      role: Role
      enabled: boolean
      lastLoginAt: Date | null
    }>>>>
  }
})

// ═══════════════════════════════════════════════════════════════════
// NEGATIVE MUTATION TESTS
// ═══════════════════════════════════════════════════════════════════

describe('type: mutation negatives', () => {
  it('placeholder', () => assert.ok(true))

  async function _insertMissingRequired() {
    // @ts-expect-error — missing required fields (name, enabled, plan, createdAt)
    await insert(db, 'account', { id: 'x' })
  }

  async function _insertWrongFieldType() {
    // @ts-expect-error — enabled should be boolean, not 'yes'
    await insert(db, 'account', { id: 'x', name: 'f', enabled: 'yes', plan: 'pro', createdAt: new Date() })
  }

  async function _updateBadField() {
    // @ts-expect-error — 'bogus' isn't a field
    await update(db, 'user', 'x', { bogus: 1 })
  }

  async function _updateWrongType() {
    // @ts-expect-error — firstName should be string
    await update(db, 'user', 'x', { firstName: 123 })
  }
})

// ═══════════════════════════════════════════════════════════════════
// CONDITIONAL QUERYBUILDER
// ═══════════════════════════════════════════════════════════════════

describe('type: queryBuilder', () => {
  it('placeholder', () => assert.ok(true))

  async function _twoArg() {
    const role: Role | undefined = undefined
    const search = ''
    const r = await queryBuilder(db, 'user')
      .select('id', 'firstName', 'role')
      .where(eq(db.user.enabled, true))
      .cond(role, eq(db.user.role, role!))
      .cond(search, ilike(db.user.firstName, `%${search}%`))
      .orderBy(desc(db.user.lastLoginAt))
      .limit(20)
      .offset(0)
      .many()
    type _ = AssertTrue<
      AssertEqual<(typeof r)[number], { id: string; firstName: string; role: Role }>
    >
  }

  async function _oneArg() {
    const search = ''
    const r = await queryBuilder(db, 'user')
      .select('id', 'firstName')
      .cond(search)
      .select(ilike(db.user.firstName, `%${search}%`))
      .many()
    type _ = AssertTrue<AssertEqual<(typeof r)[number], { id: string; firstName: string }>>
  }
})

// ═══════════════════════════════════════════════════════════════════
// .select() — undefined args drop out of the result type (SC-1483)
// ═══════════════════════════════════════════════════════════════════

describe('type: undefined select args do not pollute result type', () => {
  it('placeholder', () => assert.ok(true))

  // QueryBuilder: undefined args produce the same result type as omitting them.
  async function _qbUndefined() {
    const withUndef = await query(db, 'user').select('id', undefined, 'email').one()
    const withoutUndef = await query(db, 'user').select('id', 'email').one()
    type _ = AssertTrue<AssertEqual<typeof withUndef, typeof withoutUndef>>
  }

  // CondQueryBuilder: same property.
  async function _cqbUndefined() {
    const withUndef = await queryBuilder(db, 'user').select('id', undefined, 'email').many()
    const withoutUndef = await queryBuilder(db, 'user').select('id', 'email').many()
    type _ = AssertTrue<AssertEqual<typeof withUndef, typeof withoutUndef>>
  }

  // Conditional `cond ? 'field' : undefined` — when the literal is a union with
  // undefined, the field appears in the inferred result (narrowed by Extract).
  async function _condUndefined() {
    const include = true as boolean
    const r = await query(db, 'user')
      .select('id', include ? ('firstName' as const) : undefined, 'email')
      .one()
    type _ = AssertTrue<
      AssertEqual<typeof r, { id: string; firstName: string; email: string } | undefined>
    >
  }
})
