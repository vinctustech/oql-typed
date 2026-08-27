/**
 * MANY-TO-ONE RELATION REFERENCES — a relation used as a value (db.trip.store)
 * resolves to the foreign-key column (`&store`), never to a join on the target
 * table's primary key (`store.id`). The two forms select the same rows; only
 * the FK form lets the database use an index on that column.
 *
 * Every operator, position and path shape that can carry a relation ref is
 * covered here in all three surfaces: the OQL string, the AST handed to
 * fromJS, and the rows the query actually returns.
 */
import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import { OQL_PETRADB } from '@vinctus/oql-petradb'

import { typedOQL, type OQLInstance } from './db.js'
import { query } from './query.js'
import { queryBuilder } from './query-builder.js'
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
  between,
  isNull,
  isNotNull,
  exists,
  asc,
  desc,
} from './operators.js'
import { fn, ref, outer, alias, caseWhen, subquery } from './expressions.js'

import { count } from './functions.js'
import { schema, schemaToDM, seedSQL, dataSQL, ID } from './test-schema.js'
import { fieldRefToAST, fieldRefToOQL, isManyToOneRef, joinedFieldPath } from './ast.js'

// ═══════════════════════════════════════════════════════════════════
// Shape helpers — a stub instance is enough for toOQL()/toAST().
// ═══════════════════════════════════════════════════════════════════

const stub: OQLInstance = {
  queryOne: () => Promise.resolve(undefined),
  queryMany: () => Promise.resolve([]),
  count: () => Promise.resolve(0),
  queryOneAST: () => Promise.resolve(undefined),
  queryManyAST: () => Promise.resolve([]),
  countAST: () => Promise.resolve(0),
  entity: () => ({
    insert: () => Promise.resolve({}) as any,
    update: () => Promise.resolve({}) as any,
    delete: () => Promise.resolve(),
    bulkDelete: () => Promise.resolve(),
  }),
}
const shape = typedOQL(stub, schema)

// Both engines build the same query text and AST; run under whichever is set.
const engine = (process.env.OQL_TYPED_ENGINE as 'ast' | 'string' | undefined) ?? 'ast'

// The filter text of `trip [<filter>]`, with the projection stripped.
const filterOQL = (filter: any): string => {
  const { queryStr } = query(shape, 'trip').select('id').where(filter).toOQL()
  const match = /\[(.*)\]/s.exec(queryStr)
  assert.ok(match, `no filter section in: ${queryStr}`)
  return match[1]
}

const filterAST = (filter: any): any => (query(shape, 'trip').select('id').where(filter).toAST() as any).select

describe('relation refs: field resolution primitives', () => {
  it('recognizes a manyToOne ref and nothing else', () => {
    assert.equal(isManyToOneRef(shape.trip.store), true)
    assert.equal(isManyToOneRef(shape.trip.store.account), true)
    assert.equal(isManyToOneRef(shape.trip.state), false)
    assert.equal(isManyToOneRef(shape.trip.store.name), false)
    assert.equal(isManyToOneRef(shape.store.trips), false)
    assert.equal(isManyToOneRef(shape.store.users), false)
    assert.equal(isManyToOneRef(shape.user.vehicle), false)
    assert.equal(isManyToOneRef(null), false)
    assert.equal(isManyToOneRef(undefined), false)
  })

  it('string and AST forms agree on every field shape', () => {
    assert.equal(fieldRefToOQL(shape.trip.store), '&store')
    assert.deepStrictEqual(fieldRefToAST(shape.trip.store), { kind: 'ref', ids: ['store'] })

    assert.equal(fieldRefToOQL(shape.trip.store.account), '&store.account')
    assert.deepStrictEqual(fieldRefToAST(shape.trip.store.account), { kind: 'ref', ids: ['store', 'account'] })

    assert.equal(fieldRefToOQL(shape.trip.state), 'state')
    assert.deepStrictEqual(fieldRefToAST(shape.trip.state), { kind: 'attr', ids: ['state'] })

    assert.equal(fieldRefToOQL(shape.trip.store.name), 'store.name')
    assert.deepStrictEqual(fieldRefToAST(shape.trip.store.name), { kind: 'attr', ids: ['store', 'name'] })
  })

  it('the joined path — what outer() correlates on — keeps the .id hop', () => {
    assert.deepStrictEqual(joinedFieldPath(shape.trip.store), ['store', 'id'])
    assert.deepStrictEqual(joinedFieldPath(shape.trip.store.place), ['store', 'place', 'id'])
    assert.deepStrictEqual(joinedFieldPath(shape.trip.store.name), ['store', 'name'])
  })
})

describe('relation refs: comparison operators', () => {
  const cases: Array<[string, any, string, string]> = [
    ['eq', eq(shape.trip.store, ID.s1), '=', '&store'],
    ['ne', ne(shape.trip.store, ID.s1), '!=', '&store'],
    ['gt', gt(shape.trip.store, ID.s1), '>', '&store'],
    ['gte', gte(shape.trip.store, ID.s1), '>=', '&store'],
    ['lt', lt(shape.trip.store, ID.s1), '<', '&store'],
    ['lte', lte(shape.trip.store, ID.s1), '<=', '&store'],
  ]

  for (const [name, filter, op, lhs] of cases) {
    it(`${name} puts the foreign-key column on the left`, () => {
      assert.equal(filterOQL(filter), `${lhs} ${op} :p0`)
      assert.deepStrictEqual(filterAST(filter), {
        kind: 'infix',
        op,
        left: { kind: 'ref', ids: ['store'] },
        right: { kind: 'str', v: ID.s1 },
      })
    })
  }

  it('a nullable relation compares the same way', () => {
    assert.equal(filterOQL(eq(shape.trip.vehicle, ID.v1)), '&vehicle = :p0')
    assert.deepStrictEqual(filterAST(eq(shape.trip.vehicle, ID.v1)), {
      kind: 'infix',
      op: '=',
      left: { kind: 'ref', ids: ['vehicle'] },
      right: { kind: 'str', v: ID.v1 },
    })
  })

  it('a self-referencing relation compares the same way', () => {
    assert.equal(filterOQL(eq(shape.trip.returnTripFor, ID.t1)), '&returnTripFor = :p0')
  })

  it('a relation on the right-hand side is a column, not a parameter', () => {
    assert.equal(filterOQL(eq(shape.trip.id, ref(shape.trip.returnTripFor))), 'id = &returnTripFor')
    assert.equal(filterOQL(eq(shape.trip.id, shape.trip.returnTripFor as any)), 'id = &returnTripFor')
    assert.deepStrictEqual(filterAST(eq(shape.trip.id, ref(shape.trip.returnTripFor))), {
      kind: 'infix',
      op: '=',
      left: { kind: 'attr', ids: ['id'] },
      right: { kind: 'ref', ids: ['returnTripFor'] },
    })
  })

  it('relations on both sides', () => {
    assert.equal(filterOQL(ne(shape.trip.store, ref(shape.trip.customer))), '&store != &customer')
    assert.equal(filterOQL(ne(shape.trip.store, shape.trip.customer as any)), '&store != &customer')
    assert.deepStrictEqual(filterAST(ne(shape.trip.store, ref(shape.trip.customer))), {
      kind: 'infix',
      op: '!=',
      left: { kind: 'ref', ids: ['store'] },
      right: { kind: 'ref', ids: ['customer'] },
    })
  })
})

describe('relation refs: list, range and null operators', () => {
  it('inList', () => {
    assert.equal(filterOQL(inList(shape.trip.store, [ID.s1, ID.s2])), '&store IN :p0')
    assert.deepStrictEqual(filterAST(inList(shape.trip.store, [ID.s1, ID.s2])), {
      kind: 'in',
      op: 'IN',
      left: { kind: 'ref', ids: ['store'] },
      values: [
        { kind: 'str', v: ID.s1 },
        { kind: 'str', v: ID.s2 },
      ],
    })
  })

  it('inList with a single value', () => {
    assert.equal(filterOQL(inList(shape.trip.store, [ID.s1])), '&store IN :p0')
  })

  it('inList with an empty list', () => {
    assert.equal(filterOQL(inList(shape.trip.store, [])), '&store IN :p0')
    assert.deepStrictEqual(filterAST(inList(shape.trip.store, [])), {
      kind: 'in',
      op: 'IN',
      left: { kind: 'ref', ids: ['store'] },
      values: [],
    })
  })

  it('notInList', () => {
    assert.equal(filterOQL(notInList(shape.trip.store, [ID.s1])), '&store NOT IN :p0')
    assert.deepStrictEqual(filterAST(notInList(shape.trip.store, [ID.s1])), {
      kind: 'in',
      op: 'NOT IN',
      left: { kind: 'ref', ids: ['store'] },
      values: [{ kind: 'str', v: ID.s1 }],
    })
  })

  it('between', () => {
    assert.equal(filterOQL(between(shape.trip.store, ID.s1, ID.s2)), '&store BETWEEN :p0 AND :p1')
    assert.deepStrictEqual(filterAST(between(shape.trip.store, ID.s1, ID.s2)), {
      kind: 'between',
      expr: { kind: 'ref', ids: ['store'] },
      lower: { kind: 'str', v: ID.s1 },
      upper: { kind: 'str', v: ID.s2 },
    })
  })

  it('isNull / isNotNull', () => {
    assert.equal(filterOQL(isNull(shape.trip.vehicle)), '&vehicle IS NULL')
    assert.equal(filterOQL(isNotNull(shape.trip.vehicle)), '&vehicle IS NOT NULL')
    assert.deepStrictEqual(filterAST(isNull(shape.trip.vehicle)), {
      kind: 'postfix',
      op: 'IS NULL',
      expr: { kind: 'ref', ids: ['vehicle'] },
    })
    assert.deepStrictEqual(filterAST(isNotNull(shape.trip.vehicle)), {
      kind: 'postfix',
      op: 'IS NOT NULL',
      expr: { kind: 'ref', ids: ['vehicle'] },
    })
  })
})

describe('relation refs: composed filters', () => {
  it('and / or / not carry the FK form through', () => {
    assert.equal(
      filterOQL(and(inList(shape.trip.store, [ID.s1]), eq(shape.trip.state, 'CONFIRMED'))),
      '&store IN :p0 AND state = :p1',
    )
    assert.equal(
      filterOQL(or(eq(shape.trip.store, ID.s1), eq(shape.trip.store, ID.s2))),
      '(&store = :p0 OR &store = :p1)',
    )
    assert.equal(filterOQL(not(eq(shape.trip.store, ID.s1))), 'NOT (&store = :p0)')
  })

  it('EXISTS filters its inner entity on the inner foreign key', () => {
    const { queryStr } = query(shape, 'store')
      .select('id')
      .where(exists(shape.store.trips, eq(shape.trip.customer, ID.c1)))
      .toOQL()
    assert.ok(queryStr.includes('EXISTS(trips [&customer = :p0])'), queryStr)

    const ast = query(shape, 'store')
      .select('id')
      .where(exists(shape.store.trips, eq(shape.trip.customer, ID.c1)))
      .toAST() as any
    assert.deepStrictEqual(ast.select, {
      kind: 'exists',
      source: 'trips',
      select: { kind: 'infix', op: '=', left: { kind: 'ref', ids: ['customer'] }, right: { kind: 'str', v: ID.c1 } },
    })
  })

  it('EXISTS still names the relation itself as its source', () => {
    const { queryStr } = query(shape, 'store').select('id').where(exists(shape.store.trips)).toOQL()
    assert.ok(queryStr.includes('EXISTS(trips)'), queryStr)
  })

  it('outer() keeps the joined path — a correlated ref names the row, not the FK', () => {
    const { queryStr } = query(shape, 'vehicle')
      .select('id')
      .where(exists(shape.vehicle.trips, ne(shape.trip.store, outer(shape.vehicle.store))))
      .toOQL()
    assert.ok(queryStr.includes('EXISTS(trips [&store != vehicle.store.id])'), queryStr)
  })

  it('outer() multi-hop keeps the joined path', () => {
    const { queryStr } = query(shape, 'trip')
      .select('id')
      .where(exists(shape.trip.steps, ne(shape.tripStep.place, outer(shape.trip.store.place))))
      .toOQL()
    assert.ok(queryStr.includes('EXISTS(steps [&place != trip.store.place.id])'), queryStr)
  })
})

describe('relation refs: nested paths', () => {
  it('a relation reached through a relation folds only the last hop', () => {
    assert.equal(filterOQL(eq(shape.trip.store.account, ID.a1)), '&store.account = :p0')
    assert.deepStrictEqual(filterAST(eq(shape.trip.store.account, ID.a1)), {
      kind: 'infix',
      op: '=',
      left: { kind: 'ref', ids: ['store', 'account'] },
      right: { kind: 'str', v: ID.a1 },
    })
  })

  it('an explicit .id on the target still joins — the caller asked for the row', () => {
    assert.equal(filterOQL(eq(shape.trip.store.account.id, ID.a1)), 'store.account.id = :p0')
    assert.deepStrictEqual(filterAST(eq(shape.trip.store.account.id, ID.a1)), {
      kind: 'infix',
      op: '=',
      left: { kind: 'attr', ids: ['store', 'account', 'id'] },
      right: { kind: 'str', v: ID.a1 },
    })
  })

  it('a non-key column on the target joins', () => {
    assert.equal(filterOQL(eq(shape.trip.store.name, 'Downtown')), 'store.name = :p0')
  })

  it('a three-hop relation path', () => {
    assert.equal(filterOQL(eq(shape.tripStep.trip.store.account, ID.a1)), '&trip.store.account = :p0')
  })
})

describe('relation refs: ordering', () => {
  it('asc / desc emit the FK column in both surfaces', () => {
    const ascending = query(shape, 'trip').select('id').orderBy(asc(shape.trip.store)).toOQL()
    assert.ok(ascending.queryStr.includes('<&store ASC>'), ascending.queryStr)

    const descending = query(shape, 'trip').select('id').orderBy(desc(shape.trip.store)).toOQL()
    assert.ok(descending.queryStr.includes('<&store DESC>'), descending.queryStr)

    const ast = query(shape, 'trip').select('id').orderBy(desc(shape.trip.store)).toAST() as any
    assert.deepStrictEqual(ast.order, [{ expr: { kind: 'ref', ids: ['store'] }, dir: 'DESC' }])
  })

  it('explicit NULLS placement', () => {
    const { queryStr } = query(shape, 'trip').select('id').orderBy(asc(shape.trip.vehicle, 'last')).toOQL()
    assert.ok(queryStr.includes('<&vehicle ASC NULLS LAST>'), queryStr)
  })

  it('ordering a column is unchanged', () => {
    const { queryStr } = query(shape, 'trip').select('id').orderBy(desc(shape.trip.createdAt)).toOQL()
    assert.ok(queryStr.includes('<createdAt DESC>'), queryStr)
  })
})

describe('relation refs: expressions and projections', () => {
  // In expression positions a relation is spelled ref(...) — that is what gives
  // it the target's primary-key type. It resolves to the same foreign-key
  // column a bare relation ref does in a filter.
  it('a relation as a function argument', () => {
    const { queryStr } = query(shape, 'trip').select(alias('stores', count(ref(shape.trip.store)))).toOQL()
    assert.ok(queryStr.includes('stores: (count(&store))'), queryStr)

    const ast = query(shape, 'trip').select(alias('stores', count(ref(shape.trip.store)))).toAST() as any
    assert.deepStrictEqual(ast.project, [
      { kind: 'expr', label: 'stores', expr: { kind: 'apply', f: 'count', args: [{ kind: 'ref', ids: ['store'] }] } },
    ])
  })

  it('a bare relation reaching a function argument resolves the same way', () => {
    const { queryStr } = query(shape, 'trip').select(alias('stores', count(shape.trip.store as any))).toOQL()
    assert.ok(queryStr.includes('stores: (count(&store))'), queryStr)
  })

  it('a relation through the generic fn() builder', () => {
    const { queryStr } = query(shape, 'trip')
      .select(alias('storeId', fn('coalesce', ref(shape.trip.vehicle), ref(shape.trip.store))))
      .toOQL()
    assert.ok(queryStr.includes('storeId: (coalesce(&vehicle, &store))'), queryStr)
  })

  it('a relation projected under an alias', () => {
    const { queryStr } = query(shape, 'trip').select('id', alias('storeId', ref(shape.trip.store))).toOQL()
    assert.ok(queryStr.includes('storeId: (&store)'), queryStr)

    const ast = query(shape, 'trip').select('id', alias('storeId', ref(shape.trip.store))).toAST() as any
    assert.deepStrictEqual(ast.project[1], { kind: 'expr', label: 'storeId', expr: { kind: 'ref', ids: ['store'] } })
  })

  it('a bare relation reaching an alias projection resolves the same way', () => {
    const { queryStr } = query(shape, 'trip').select('id', alias('storeId', shape.trip.store as any)).toOQL()
    assert.ok(queryStr.includes('storeId: (&store)'), queryStr)
  })

  it('a relation as a CASE result', () => {
    const branch = caseWhen([{ when: eq(shape.trip.state, 'CANCELLED'), then: ref(shape.trip.returnTripFor) }], shape.trip.id)
    const { queryStr } = query(shape, 'trip').select(alias('reference', branch)).toOQL()
    assert.ok(queryStr.includes('WHEN state = :p0 THEN &returnTripFor ELSE id END'), queryStr)
  })

  it('ref() is the explicit spelling of the same thing — never doubled', () => {
    assert.equal(filterOQL(eq(ref(shape.trip.store), ID.s1)), '&store = :p0')
    assert.deepStrictEqual(filterAST(eq(ref(shape.trip.store), ID.s1)), filterAST(eq(shape.trip.store, ID.s1)))
  })

  it('a relation inside an aggregate subquery filter', () => {
    const { queryStr } = query(shape, 'store')
      .select('id')
      .where(eq(subquery(shape.store.trips, count('*'), eq(shape.trip.customer, ID.c1)), 1))
      .toOQL()
    assert.ok(queryStr.includes('&customer = :p0'), queryStr)
  })
})

describe('relation refs: builder shorthands', () => {
  it('findBy on a relation', () => {
    const { queryStr } = query(shape, 'trip').select('id').findBy(shape.trip.store, ID.s1).toOQL()
    assert.ok(queryStr.includes('[&store = :p0]'), queryStr)
  })

  it('findIn on a relation', () => {
    const { queryStr } = query(shape, 'trip').select('id').findIn(shape.trip.store, [ID.s1, ID.s2]).toOQL()
    assert.ok(queryStr.includes('[&store IN :p0]'), queryStr)
  })

  it('the untyped queryBuilder resolves relations the same way', () => {
    const { queryStr } = queryBuilder(shape, 'trip').select('id').findBy(shape.trip.store, ID.s1).toOQL()
    assert.ok(queryStr.includes('&store = :p0'), queryStr)
  })

  it('findOneById is unaffected — a primary key is a column', () => {
    const { queryStr } = query(shape, 'trip').select('id').where(eq(shape.trip.id, ID.t1)).toOQL()
    assert.ok(queryStr.includes('[id = :p0]'), queryStr)
  })

  it('a nested projection still joins the target entity', () => {
    const { queryStr } = query(shape, 'trip').select('id', { store: ['name'] }).toOQL()
    assert.ok(queryStr.includes('store {name}'), queryStr)
  })
})

// ═══════════════════════════════════════════════════════════════════
// Behaviour — the FK form must select exactly what the joined form does.
// ═══════════════════════════════════════════════════════════════════

describe('relation refs: results against the database', () => {
  let db: ReturnType<typeof typedOQL<typeof schema>>

  before(async () => {
    const oql = new OQL_PETRADB(schemaToDM(schema))
    db = typedOQL(oql, schema, { engine })
    await oql.rawMulti(seedSQL + dataSQL)
  })

  const ids = async (q: Promise<Array<{ id: string }>>) => (await q).map((row) => row.id).sort()

  it('eq matches the joined form row for row', async () => {
    const viaFK = await ids(query(db, 'trip').select('id').where(eq(db.trip.store, ID.s1)).many())
    const viaJoin = await ids(query(db, 'trip').select('id').where(eq(db.trip.store.id, ID.s1)).many())
    assert.deepStrictEqual(viaFK, [ID.t1, ID.t2].sort())
    assert.deepStrictEqual(viaFK, viaJoin)
  })

  it('ne excludes NULL foreign keys, exactly as the join does', async () => {
    const viaFK = await ids(query(db, 'trip').select('id').where(ne(db.trip.vehicle, ID.v1)).many())
    const viaJoin = await ids(query(db, 'trip').select('id').where(ne(db.trip.vehicle.id, ID.v1)).many())
    assert.deepStrictEqual(viaFK, [])
    assert.deepStrictEqual(viaFK, viaJoin)
  })

  it('inList matches the joined form', async () => {
    const viaFK = await ids(query(db, 'trip').select('id').where(inList(db.trip.store, [ID.s1, ID.s2])).many())
    assert.deepStrictEqual(viaFK, [ID.t1, ID.t2, ID.t3, ID.t4].sort())
  })

  // The string engine cannot render an empty list parameter — for columns
  // either — so only the AST engine executes this one.
  it('an empty inList selects nothing', { skip: engine === 'string' }, async () => {
    const rows = await query(db, 'trip').select('id').where(inList(db.trip.store, [])).many()
    assert.equal(rows.length, 0)
  })

  it('notInList matches the joined form', async () => {
    const viaFK = await ids(query(db, 'trip').select('id').where(notInList(db.trip.store, [ID.s1])).many())
    assert.deepStrictEqual(viaFK, [ID.t3, ID.t4].sort())
  })

  it('IS NULL finds the rows with no foreign key', async () => {
    const viaFK = await ids(query(db, 'trip').select('id').where(isNull(db.trip.vehicle)).many())
    const viaJoin = await ids(query(db, 'trip').select('id').where(isNull(db.trip.vehicle.id)).many())
    assert.deepStrictEqual(viaFK, [ID.t2, ID.t4].sort())
    assert.deepStrictEqual(viaFK, viaJoin)
  })

  it('IS NOT NULL is its complement', async () => {
    const viaFK = await ids(query(db, 'trip').select('id').where(isNotNull(db.trip.vehicle)).many())
    assert.deepStrictEqual(viaFK, [ID.t1, ID.t3].sort())
  })

  it('a two-hop relation path matches the joined form', async () => {
    const viaFK = await ids(query(db, 'trip').select('id').where(eq(db.trip.store.account, ID.a1)).many())
    const viaJoin = await ids(query(db, 'trip').select('id').where(eq(db.trip.store.account.id, ID.a1)).many())
    assert.deepStrictEqual(viaFK, [ID.t1, ID.t2, ID.t3, ID.t4].sort())
    assert.deepStrictEqual(viaFK, viaJoin)
  })

  it('a self-reference matches', async () => {
    const rows = await ids(query(db, 'trip').select('id').where(eq(db.trip.returnTripFor, ID.t1)).many())
    assert.deepStrictEqual(rows, [ID.t3])
  })

  it('a relation on both sides compares column to column', async () => {
    const rows = await query(db, 'trip').select('id').where(eq(db.trip.id, ref(db.trip.returnTripFor))).many()
    assert.equal(rows.length, 0)
  })

  it('EXISTS with an inner relation filter', async () => {
    const rows = await ids(query(db, 'store').select('id').where(exists(db.store.trips, eq(db.trip.customer, ID.c2))).many())
    assert.deepStrictEqual(rows, [ID.s1, ID.s2].sort())
  })

  it('ordering by a foreign key orders the rows', async () => {
    const rows = await query(db, 'trip').select('id').orderBy(asc(db.trip.store), asc(db.trip.createdAt)).many()
    assert.deepStrictEqual(
      rows.map((row) => row.id),
      [ID.t1, ID.t2, ID.t3, ID.t4],
    )
  })

  it('counting through a foreign-key filter', async () => {
    assert.equal(await query(db, 'trip').where(eq(db.trip.store, ID.s1)).count(), 2)
  })

  it('paginating a foreign-key filter', async () => {
    const rows = await query(db, 'trip')
      .select('id')
      .where(eq(db.trip.store, ID.s1))
      .orderBy(asc(db.trip.createdAt))
      .limit(1)
      .offset(1)
      .many()
    assert.deepStrictEqual(
      rows.map((row) => row.id),
      [ID.t2],
    )
  })

  it('a target whose primary key is not named id is reachable only this way', async () => {
    const rows = await ids(query(db, 'store').select('id').where(eq(db.store.region, 'QC')).many())
    assert.deepStrictEqual(rows, [ID.s1])

    const none = await query(db, 'store').select('id').where(eq(db.store.region, 'ON')).many()
    assert.equal(none.length, 0)

    const unset = await ids(query(db, 'store').select('id').where(isNull(db.store.region)).many())
    assert.deepStrictEqual(unset, [ID.s2])
  })

  it('the relation is still projectable as a nested object', async () => {
    const rows = await query(db, 'trip').select('id', { store: ['name'] }).where(eq(db.trip.store, ID.s2)).many()
    assert.deepStrictEqual(
      rows.map((row) => row.store.name),
      ['Airport', 'Airport'],
    )
  })
})
