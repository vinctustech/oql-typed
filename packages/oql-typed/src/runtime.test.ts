/**
 * RUNTIME TESTS — every API pattern from the shuttlecontrol-api audit,
 * executed end-to-end against the in-memory petradb backend.
 *
 * Type assertions live in type-assertions.test.ts (compile-time).
 * This file proves the generated OQL actually runs and returns correct data.
 */
import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import { OQL_PETRADB } from '@vinctus/oql-petradb'

import { typedOQL } from './db.js'
import { query } from './query.js'
import { queryBuilder } from './query-builder.js'
import { insert, update } from './mutations.js'
import { eq, ne, and, or, ilike, inList, isNull, isNotNull, between, exists, desc, asc } from './operators.js'
import { fn, raw, ref, alias, aliasedRelation } from './expressions.js'
import { sum, avg, min, max } from './functions.js'

import { schema, seedSQL, dataSQL, ID } from './test-schema.js'

// ═══════════════════════════════════════════════════════════════════
// Generate a .dm string from our schema for petradb's DataModel constructor.
// This is a bit ugly — we'll replace it with a proper generator later.
// ═══════════════════════════════════════════════════════════════════

import type { EntityMeta, Column, Relation } from './schema.js'

function schemaToDM(s: typeof schema): string {
  const parts: string[] = []

  // Collect enum definitions
  const enums = new Map<string, readonly string[]>()
  for (const [, entry] of Object.entries(s)) {
    const def = (entry as EntityMeta).definition
    for (const [, field] of Object.entries(def)) {
      if (field instanceof Object && (field as any).__kind === 'column') {
        const col = field as Column
        if (col.enumName && col.enumValues) enums.set(col.enumName, col.enumValues)
      }
    }
  }

  for (const [name, values] of enums) {
    parts.push(`enum ${name} { ${values.join(' ')} }`)
  }

  for (const [entityName, entry] of Object.entries(s)) {
    const meta = entry as EntityMeta
    const tableName = meta.tableName
    const header = tableName ? `entity ${entityName} (${tableName})` : `entity ${entityName}`
    const lines: string[] = []

    for (const [fieldName, field] of Object.entries(meta.definition)) {
      if ((field as any).__kind === 'column') {
        const col = field as Column
        const pk = col.isPrimaryKey ? '*' : ' '
        const alias = col.columnAlias ? ` (${col.columnAlias})` : ''
        const req = !col.isNullable && !col.isPrimaryKey ? '!' : ''
        let typeName: string
        switch (col.columnKind) {
          case 'boolean': typeName = 'bool'; break
          case 'enum': typeName = col.enumName as string; break
          case 'decimal':
            typeName = col.precision !== undefined
              ? col.scale !== undefined
                ? `decimal(${col.precision}, ${col.scale})`
                : `decimal(${col.precision})`
              : 'decimal'
            break
          case 'float': typeName = 'float'; break
          default: typeName = col.columnKind; break
        }
        lines.push(`  ${pk}${fieldName}${alias}: ${typeName}${req}`)
      } else {
        const rel = field as Relation
        switch (rel.relationKind) {
          case 'manyToOne': {
            const alias = rel.column ? ` (${rel.column})` : ''
            const req = rel.isNullable ? '' : '!'
            lines.push(`  ${fieldName}${alias}: ${rel.target}${req}`)
            break
          }
          case 'oneToMany':
            lines.push(`  ${fieldName}: [${rel.target}]`)
            break
          case 'manyToMany':
            lines.push(`  ${fieldName}: [${rel.target}] (${rel.junction})`)
            break
          case 'oneToOne': {
            const refPart = rel.reference ? `.${rel.reference}` : ''
            lines.push(`  ${fieldName}: <${rel.target}>${refPart}`)
            break
          }
        }
      }
    }

    parts.push(`${header} {\n${lines.join('\n')}\n}`)
  }

  // Junction tables
  const junctions = new Map<string, { from: string; to: string }>()
  for (const [entityName, entry] of Object.entries(s)) {
    const meta = entry as EntityMeta
    for (const [, field] of Object.entries(meta.definition)) {
      if ((field as any).__kind === 'relation') {
        const rel = field as Relation
        if (rel.relationKind === 'manyToMany' && rel.junction && !junctions.has(rel.junction)) {
          junctions.set(rel.junction, { from: entityName, to: rel.target })
        }
      }
    }
  }
  for (const [junction, { from, to }] of junctions) {
    parts.push(`entity ${junction} {\n  ${from} (${from}_id): ${from}\n  ${to} (${to}_id): ${to}\n}`)
  }

  return parts.join('\n\n')
}

// ═══════════════════════════════════════════════════════════════════

let oql: OQL_PETRADB
let db: ReturnType<typeof typedOQL<typeof schema>>

before(async () => {
  const dm = schemaToDM(schema)
  oql = new OQL_PETRADB(dm)
  db = typedOQL(oql, schema)
  await oql.rawMulti(seedSQL + dataSQL)
})

// ═══════════════════════════════════════════════════════════════════
// QUERIES
// ═══════════════════════════════════════════════════════════════════

describe('runtime: basic queries', () => {
  it('queryMany returns all scalars when no .select()', async () => {
    const r = await query(db, 'account').many()
    assert.equal(r.length, 1)
    assert.equal(r[0].name, 'Acme Corp')
    assert.equal(r[0].enabled, true)
  })

  it('shorthand: db.account.many() equivalent to query(db, "account").many()', async () => {
    const r = await db.account.many()
    assert.equal(r.length, 1)
    assert.equal(r[0].name, 'Acme Corp')
  })

  it('shorthand: db.user.select(...).where(...).one()', async () => {
    const r = await db.user.select('id', 'firstName').where(eq(db.user.id, ID.u1)).one()
    assert.ok(r)
    assert.equal(r.firstName, 'Alice')
  })

  it('queryOne returns typed single row', async () => {
    const r = await query(db, 'user').select('id', 'firstName', 'email').where(eq(db.user.id, ID.u1)).one()
    assert.ok(r)
    assert.equal(r.firstName, 'Alice')
    assert.equal(r.email, 'alice@example.com')
  })

  it('queryOne returns undefined on no match', async () => {
    const r = await query(db, 'user').where(eq(db.user.email, 'nobody@x.com')).one()
    assert.equal(r, undefined)
  })

  it('count()', async () => {
    assert.equal(await query(db, 'trip').count(), 4)
    assert.equal(await query(db, 'trip').where(eq(db.trip.state, 'CONFIRMED')).count(), 1)
  })
})

describe('runtime: projections', () => {
  it('nested manyToOne', async () => {
    const r = await query(db, 'user').select('id', { account: ['id', 'name'] }).where(eq(db.user.id, ID.u1)).one()
    assert.ok(r)
    assert.equal(r.account.name, 'Acme Corp')
  })

  it('single-field shorthand: { account: "name" } equivalent to { account: ["name"] }', async () => {
    const r = await query(db, 'user').select('id', { account: 'name' }).where(eq(db.user.id, ID.u1)).one()
    assert.ok(r)
    assert.equal(r.account.name, 'Acme Corp')
  })

  it('nested oneToMany', async () => {
    const r = await query(db, 'store').select('id', 'name', { trips: ['id', 'state'] }).where(eq(db.store.id, ID.s1)).one()
    assert.ok(r)
    assert.equal(r.trips.length, 2)
  })

  it('nested manyToMany', async () => {
    const r = await query(db, 'user').select('id', { stores: ['id', 'name'] }).where(eq(db.user.id, ID.u1)).one()
    assert.ok(r)
    assert.equal(r.stores.length, 2)
  })

  it('nullable manyToOne returns null', async () => {
    const r = await query(db, 'trip').select('id', { vehicle: ['id', 'make'] }).where(eq(db.trip.id, ID.t2)).one()
    assert.ok(r)
    assert.equal(r.vehicle, null)
  })

  it('deep nesting: trip → vehicle → driver', async () => {
    const r = await query(db, 'trip')
      .select('id', { vehicle: ['make', { driver: ['firstName'] }] })
      .where(eq(db.trip.id, ID.t1))
      .one()
    assert.ok(r)
    assert.equal(r.vehicle?.make, 'Toyota')
    assert.equal(r.vehicle?.driver?.firstName, 'Bob')
  })

  it('filtered sub-collection', async () => {
    const r = await query(db, 'store')
      .select('id', {
        trips: {
          fields: ['id', 'state'],
          where: ne(db.trip.state, 'CANCELLED'),
          orderBy: [desc(db.trip.createdAt)],
        },
      })
      .where(eq(db.store.id, ID.s1))
      .one()
    assert.ok(r)
    assert.equal(r.trips.length, 2)
    // Desc order: t2 (Jun 2) before t1 (Jun 1)
    assert.equal(r.trips[0].state, 'REQUESTED')
  })

  it('filtered sub-collection: fields shorthand (single string)', async () => {
    const r = await query(db, 'store')
      .select('id', {
        trips: {
          fields: 'id',
          where: ne(db.trip.state, 'CANCELLED'),
        },
      })
      .where(eq(db.store.id, ID.s1))
      .one()
    assert.ok(r)
    assert.ok(Array.isArray(r.trips))
    assert.ok(r.trips.length > 0)
    // Only `id` projected — no `state` property on the items
    assert.equal(typeof r.trips[0].id, 'string')
  })

  it('filtered sub-collection: fields shorthand generates same OQL as array form', () => {
    const arrayForm = query(db, 'store')
      .select('id', { trips: { fields: ['id'], where: ne(db.trip.state, 'CANCELLED') } })
      .toOQL()
    const stringForm = query(db, 'store')
      .select('id', { trips: { fields: 'id', where: ne(db.trip.state, 'CANCELLED') } })
      .toOQL()
    assert.equal(arrayForm.queryStr, stringForm.queryStr)
  })

  it('aliased projection: returnTripId: (returnTripFor.id)', async () => {
    const r = await query(db, 'trip')
      .select('id', alias('returnTripId', db.trip.returnTripFor.id))
      .where(eq(db.trip.id, ID.t3))
      .one()
    assert.ok(r)
    // t3's returnTripFor is t1
    assert.equal(r.returnTripId, ID.t1)
  })

  it('aliased aggregate: passengers: trips {count: sum(seats)}', async () => {
    const r = await query(db, 'vehicle')
      .select('id', 'make', {
        trips: {
          fields: [raw('count: sum(seats)')],
          where: and(ne(db.trip.state, 'COMPLETED'), ne(db.trip.state, 'CANCELLED')),
        },
      })
      .where(eq(db.vehicle.id, ID.v1))
      .one()
    assert.ok(r)
    const trips = (r as any).trips
    assert.ok(Array.isArray(trips))
    // v1's t1 (CONFIRMED, 2 seats); t3 is COMPLETED so excluded
    assert.equal(trips[0].count, 2)
  })

  it('aliasedRelation: passengers: trips {count: sum(seats)} [filter]', async () => {
    const r = await query(db, 'vehicle')
      .select(
        'id',
        'make',
        aliasedRelation<{ count: number }>('passengers', 'trips', {
          fields: [raw('count: sum(seats)')],
          where: and(ne(db.trip.state, 'COMPLETED'), ne(db.trip.state, 'CANCELLED')),
        }),
      )
      .where(eq(db.vehicle.id, ID.v1))
      .one()
    assert.ok(r)
    // Shape-typed access: no cast needed
    assert.ok(Array.isArray(r.passengers))
    assert.equal(r.passengers[0].count, 2)
  })

  it('aliasedRelation: OQL string uses alias-colon-relation form', () => {
    const { queryStr } = query(db, 'vehicle')
      .select(
        'id',
        aliasedRelation<{ count: number }>('passengers', 'trips', {
          fields: [raw('count: sum(seats)')],
          where: ne(db.trip.state, 'COMPLETED'),
        }),
      )
      .where(eq(db.vehicle.id, ID.v1))
      .toOQL()
    assert.ok(queryStr.includes('passengers: trips {count: sum(seats)}'))
    assert.ok(queryStr.includes('[state != :p0]'))
  })

  it('aliasedRelation: scalar fields and orderBy', async () => {
    const r = await query(db, 'vehicle')
      .select(
        'id',
        aliasedRelation<{ id: string; state: string }>('activeTrips', 'trips', {
          fields: ['id', 'state'],
          where: ne(db.trip.state, 'COMPLETED'),
          orderBy: [desc(db.trip.createdAt)],
        }),
      )
      .where(eq(db.vehicle.id, ID.v1))
      .one()
    assert.ok(r)
    assert.ok(Array.isArray(r.activeTrips))
    // v1's non-COMPLETED trip: just t1 (t3 is COMPLETED)
    assert.equal(r.activeTrips.length, 1)
    assert.equal(r.activeTrips[0].state, 'CONFIRMED')
  })

  it('aliasedRelation: no filter, no orderBy', () => {
    const { queryStr } = query(db, 'vehicle')
      .select(
        'id',
        aliasedRelation<{ id: string }>('allTrips', 'trips', {
          fields: ['id'],
        }),
      )
      .where(eq(db.vehicle.id, ID.v1))
      .toOQL()
    assert.ok(queryStr.includes('allTrips: trips {id}'))
    // No filter brackets on the aliased relation
    assert.ok(!queryStr.includes('allTrips: trips {id} ['))
  })
})

describe('runtime: filters', () => {
  it('eq on manyToOne FK auto-resolves to .id', async () => {
    const { queryStr } = query(db, 'trip').select('id').where(eq(db.trip.store, ID.s1)).toOQL()
    assert.ok(queryStr.includes('store.id = :p0'))
  })

  it('eq on dotted path', async () => {
    const r = await query(db, 'trip').where(eq(db.trip.store.account.id, ID.a1)).many()
    assert.equal(r.length, 4) // all 4 trips belong to Acme's stores
  })

  it('inList with literal array', async () => {
    const r = await query(db, 'trip').where(inList(db.trip.state, ['CONFIRMED', 'REQUESTED'])).many()
    assert.equal(r.length, 2)
  })

  it('EXISTS with inner filter', async () => {
    const r = await query(db, 'user').select('id', 'firstName').where(exists(db.user.stores, eq(db.store.id, ID.s1))).many()
    assert.equal(r.length, 2) // Alice and Bob linked to s1
  })

  it('IS NULL on scalar', async () => {
    const r = await query(db, 'user').where(isNull(db.user.lastLoginAt)).many()
    assert.equal(r.length, 1) // Bob
  })

  it('bare boolean field ref means "= true"', async () => {
    // Stores: s1 enabled, s2 disabled — expect only s1
    const r = await db.store.where(db.store.enabled).many()
    assert.equal(r.length, 1)
    assert.equal(r[0].name, 'Downtown')
  })

  it('bare boolean composes with other filters via and()', async () => {
    // Users with stores where enabled = true via store's bool field
    const r = await db.store
      .select('id', 'name')
      .where(and(db.store.enabled, eq(db.store.color, '#ff0000')))
      .many()
    assert.equal(r.length, 1)
    assert.equal(r[0].name, 'Downtown')
  })

  it('& reference operator: &returnTripFor IS NULL', async () => {
    const r = await query(db, 'trip').where(isNull(ref(db.trip.returnTripFor))).many()
    assert.equal(r.length, 2) // t1, t2
  })

  it('BETWEEN on timestamp', async () => {
    const r = await query(db, 'trip')
      .where(between(db.trip.createdAt, new Date('2024-06-01T00:00:00Z') as any, new Date('2024-06-02T23:59:59Z') as any))
      .many()
    assert.equal(r.length, 2)
  })

  it('concat() ILIKE for search', async () => {
    const r = await query(db, 'customer')
      .where(ilike(fn<string>('concat', db.customer.firstName, raw("' '"), db.customer.lastName), '%Dan%'))
      .many()
    assert.equal(r.length, 1)
    assert.equal(r[0].firstName, 'Dan')
  })

  it('compound AND/OR', async () => {
    const r = await query(db, 'user')
      .select('id', 'firstName')
      .where(
        and(
          exists(db.user.stores, eq(db.store.id, ID.s1)),
          eq(db.user.enabled, true),
          or(ilike(db.user.firstName, '%ali%'), ilike(db.user.lastName, '%jon%')),
        ),
      )
      .many()
    assert.equal(r.length, 2) // Alice (firstName), Bob (lastName)
  })
})

describe('runtime: ordering + pagination', () => {
  it('order asc + limit + offset', async () => {
    const r = await query(db, 'user').select('id', 'firstName').orderBy(asc(db.user.firstName)).limit(2).offset(1).many()
    assert.equal(r.length, 2)
    assert.equal(r[0].firstName, 'Bob')
    assert.equal(r[1].firstName, 'Charlie')
  })
})

// ═══════════════════════════════════════════════════════════════════
// TYPED AGGREGATES
// ═══════════════════════════════════════════════════════════════════

describe('runtime: typed aggregates', () => {
  it('sum(seats) inside aliasedRelation — shape fully inferred', async () => {
    const r = await query(db, 'vehicle')
      .select(
        'id',
        aliasedRelation('passengers', 'trips', {
          fields: [alias('total', sum(db.trip.seats))],
          where: ne(db.trip.state, 'COMPLETED'),
        }),
      )
      .where(eq(db.vehicle.id, ID.v1))
      .one()
    assert.ok(r)
    // v1's non-COMPLETED trip: t1 (2 seats)
    assert.equal(r.passengers[0].total, 2)
  })

  it('avg(seats) renders avg(seats)', () => {
    const { queryStr } = query(db, 'vehicle')
      .select(
        'id',
        aliasedRelation('avg', 'trips', {
          fields: [alias('avgSeats', avg(db.trip.seats))],
        }),
      )
      .where(eq(db.vehicle.id, ID.v1))
      .toOQL()
    assert.ok(queryStr.includes('avgSeats: (avg(seats))'))
  })

  it('min/max render correctly', () => {
    const { queryStr: q1 } = query(db, 'user')
      .select(alias('earliest', min(db.user.lastLoginAt)))
      .toOQL()
    assert.ok(q1.includes('earliest: (min(lastLoginAt))'))

    const { queryStr: q2 } = query(db, 'user')
      .select(alias('latest', max(db.user.lastLoginAt)))
      .toOQL()
    assert.ok(q2.includes('latest: (max(lastLoginAt))'))
  })
})

// ═══════════════════════════════════════════════════════════════════
// CONDITIONAL QUERYBUILDER
// ═══════════════════════════════════════════════════════════════════

describe('runtime: queryBuilder cond()', () => {
  it('two-arg cond adds filter when truthy', async () => {
    const role = 'DRIVER'
    const r = await queryBuilder(db, 'user')
      .select('id', 'firstName', 'role')
      .where(eq(db.user.enabled, true))
      .cond(role, eq(db.user.role, role))
      .many()
    assert.equal(r.length, 1)
    assert.equal(r[0].firstName, 'Bob')
  })

  it('two-arg cond skips filter when falsy', async () => {
    const role: string | undefined = undefined
    const r = await queryBuilder(db, 'user')
      .select('id', 'firstName')
      .where(eq(db.user.enabled, true))
      .cond(role, eq(db.user.role, role as any))
      .many()
    assert.equal(r.length, 2) // all enabled
  })

  it('one-arg cond + .select() branching (both branches)', async () => {
    const storeId: string | undefined = ID.s1
    const r = await queryBuilder(db, 'zone')
      .select('id', 'name')
      .where(eq(db.zone.enabled, true))
      .cond(storeId)
      .select(eq(db.zone.store, storeId as string))
      .cond(!storeId)
      .select(inList(db.zone.store, ['any']))
      .many()
    assert.equal(r.length, 2) // both zones belong to s1
  })
})

// ═══════════════════════════════════════════════════════════════════
// MUTATIONS
// ═══════════════════════════════════════════════════════════════════

describe('runtime: mutations', () => {
  it('insert returns full row', async () => {
    const r = await insert(db, 'account', {
      id: 'a0000000-0000-4000-8000-0000000000ff',
      name: 'Beta',
      enabled: true,
      plan: 'free',
      createdAt: new Date('2024-07-01T00:00:00Z'),
    })
    assert.equal(r.name, 'Beta')
    assert.equal(r.enabled, true)
  })

  it('update returns updated fields + pk', async () => {
    const r = await update(db, 'user', ID.u1, { firstName: 'Alicia' })
    assert.equal(r.id, ID.u1)
    assert.equal(r.firstName, 'Alicia')
  })

  it('update persists', async () => {
    const r = await query(db, 'user').select('id', 'firstName').where(eq(db.user.id, ID.u1)).one()
    assert.ok(r)
    assert.equal(r.firstName, 'Alicia')
  })
})
