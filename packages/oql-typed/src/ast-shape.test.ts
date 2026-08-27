import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { typedOQL, type OQLInstance } from './db.js'
import { query } from './query.js'
import { eq, ne, and, or, lt, inList, isNull, exists, ilike, asc, desc, arrayContains } from './operators.js'
import { alias, currentTimestamp, subquery, caseWhen, outer } from './expressions.js'
import { count, sum, concatOp } from './functions.js'
import { schema } from './test-schema.js'

// .toAST() is a pure builder (never touches the backend), so these shape tests
// run identically under either engine. They parallel the .toOQL() string-shape
// tests, asserting the exact plain-object AST that gets handed to OQL's fromJS.

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
const db = typedOQL(stub, schema)

describe('toAST() shape', () => {
  it('scalar projection', () => {
    assert.deepStrictEqual(query(db, 'user').select('id', 'email').toAST(), {
      kind: 'query',
      source: 'user',
      project: [
        { kind: 'field', name: 'id' },
        { kind: 'field', name: 'email' },
      ],
    })
  })

  it('eq with a string literal', () => {
    assert.deepStrictEqual(query(db, 'trip').select('id').where(eq(db.trip.state, 'CONFIRMED')).toAST(), {
      kind: 'query',
      source: 'trip',
      project: [{ kind: 'field', name: 'id' }],
      select: { kind: 'infix', op: '=', left: { kind: 'attr', ids: ['state'] }, right: { kind: 'str', v: 'CONFIRMED' } },
    })
  })

  it('eq on a manyToOne FK resolves to the foreign-key column', () => {
    const ast = query(db, 'trip').select('id').where(eq(db.trip.vehicle, 'v1')).toAST() as any
    assert.deepStrictEqual(ast.select, {
      kind: 'infix',
      op: '=',
      left: { kind: 'ref', ids: ['vehicle'] },
      right: { kind: 'str', v: 'v1' },
    })
  })

  it('inList with integer literals', () => {
    const ast = query(db, 'vehicle').select('id').where(inList(db.vehicle.seats, [2, 4])).toAST() as any
    assert.deepStrictEqual(ast.select, {
      kind: 'in',
      op: 'IN',
      left: { kind: 'attr', ids: ['seats'] },
      values: [
        { kind: 'int', v: 2 },
        { kind: 'int', v: 4 },
      ],
    })
  })

  it('arrayContains emits an arraycomp node (:p = ANY(col))', () => {
    const ast = query(db, 'zone').select('id').where(arrayContains(db.zone.tags, 'vip')).toAST() as any
    assert.deepStrictEqual(ast.select, {
      kind: 'arraycomp',
      left: { kind: 'str', v: 'vip' },
      op: '=',
      quantifier: 'ANY',
      array: { kind: 'attr', ids: ['tags'] },
    })
  })

  it('and folds into a left-associative infix chain', () => {
    const ast = query(db, 'trip')
      .select('id')
      .where(and(eq(db.trip.seats, 2), eq(db.trip.state, 'CONFIRMED')))
      .toAST() as any
    assert.deepStrictEqual(ast.select, {
      kind: 'infix',
      op: 'AND',
      left: { kind: 'infix', op: '=', left: { kind: 'attr', ids: ['seats'] }, right: { kind: 'int', v: 2 } },
      right: { kind: 'infix', op: '=', left: { kind: 'attr', ids: ['state'] }, right: { kind: 'str', v: 'CONFIRMED' } },
    })
  })

  it('or wraps in a grouped node', () => {
    const ast = query(db, 'trip')
      .select('id')
      .where(or(eq(db.trip.seats, 1), eq(db.trip.seats, 2)))
      .toAST() as any
    assert.deepStrictEqual(ast.select, {
      kind: 'grouped',
      expr: {
        kind: 'infix',
        op: 'OR',
        left: { kind: 'infix', op: '=', left: { kind: 'attr', ids: ['seats'] }, right: { kind: 'int', v: 1 } },
        right: { kind: 'infix', op: '=', left: { kind: 'attr', ids: ['seats'] }, right: { kind: 'int', v: 2 } },
      },
    })
  })

  it('nested manyToOne relation', () => {
    const ast = query(db, 'trip').select('id', { vehicle: ['make'] }).toAST() as any
    assert.deepStrictEqual(ast.project, [
      { kind: 'field', name: 'id' },
      { kind: 'rel', label: 'vehicle', source: 'vehicle', project: [{ kind: 'field', name: 'make' }] },
    ])
  })

  it('paginated nested relation sets limit/offset on the rel node', () => {
    const ast = query(db, 'store')
      .select('id', {
        trips: { fields: ['id'], orderBy: [desc(db.trip.createdAt)], limit: 1, offset: 1 },
      })
      .toAST() as any
    assert.deepStrictEqual(ast.project[1], {
      kind: 'rel',
      label: 'trips',
      source: 'trips',
      project: [{ kind: 'field', name: 'id' }],
      order: [{ expr: { kind: 'attr', ids: ['createdAt'] }, dir: 'DESC' }],
      limit: 1,
      offset: 1,
    })
  })

  it('aliased aggregate projection', () => {
    const ast = query(db, 'vehicle').select(alias('total', sum(db.vehicle.seats))).toAST() as any
    assert.deepStrictEqual(ast.project, [
      { kind: 'expr', label: 'total', expr: { kind: 'apply', f: 'sum', args: [{ kind: 'attr', ids: ['seats'] }] } },
    ])
  })

  it('ordering + pagination', () => {
    assert.deepStrictEqual(
      query(db, 'trip').select('id').orderBy(desc(db.trip.createdAt)).limit(10).offset(5).toAST(),
      {
        kind: 'query',
        source: 'trip',
        project: [{ kind: 'field', name: 'id' }],
        order: [{ expr: { kind: 'attr', ids: ['createdAt'] }, dir: 'DESC' }],
        limit: 10,
        offset: 5,
      },
    )
  })

  it('paginate:false drops limit/offset (count path)', () => {
    const ast = query(db, 'trip').select('id').limit(10).offset(5).toAST({ paginate: false }) as any
    assert.equal(ast.limit, undefined)
    assert.equal(ast.offset, undefined)
  })

  it('currentTimestamp is a builtin attribute, not a literal', () => {
    const ast = query(db, 'trip').select('id').where(lt(db.trip.createdAt, currentTimestamp())).toAST() as any
    assert.deepStrictEqual(ast.select, {
      kind: 'infix',
      op: '<',
      left: { kind: 'attr', ids: ['createdAt'] },
      right: { kind: 'attr', ids: ['CURRENT_TIMESTAMP'] },
    })
  })

  it('IS NULL on a manyToOne FK', () => {
    const ast = query(db, 'trip').select('id').where(isNull(db.trip.returnTripFor)).toAST() as any
    assert.deepStrictEqual(ast.select, { kind: 'postfix', op: 'IS NULL', expr: { kind: 'ref', ids: ['returnTripFor'] } })
  })

  it('EXISTS on a relation', () => {
    const ast = query(db, 'store').select('id').where(exists(db.store.trips)).toAST() as any
    assert.deepStrictEqual(ast.select, { kind: 'exists', source: 'trips' })
  })

  it('concatOp emits a grouped || chain inside ILIKE', () => {
    const ast = query(db, 'customer')
      .select('id')
      .where(ilike(concatOp(db.customer.firstName, ' ', db.customer.lastName), '%dan%'))
      .toAST() as any
    assert.deepStrictEqual(ast.select, {
      kind: 'infix',
      op: 'ILIKE',
      left: {
        kind: 'grouped',
        expr: {
          kind: 'infix',
          op: '||',
          left: {
            kind: 'infix',
            op: '||',
            left: { kind: 'attr', ids: ['firstName'] },
            right: { kind: 'str', v: ' ' },
          },
          right: { kind: 'attr', ids: ['lastName'] },
        },
      },
      right: { kind: 'str', v: '%dan%' },
    })
  })

  it('scalar subquery as a value', () => {
    const ast = query(db, 'vehicle')
      .select('id')
      .where(eq(subquery(db.vehicle.trips, count('*')), 0))
      .toAST() as any
    assert.deepStrictEqual(ast.select, {
      kind: 'infix',
      op: '=',
      left: {
        kind: 'subquery',
        query: {
          kind: 'query',
          source: 'trips',
          project: [
            { kind: 'expr', label: 'value', expr: { kind: 'apply', f: 'count', args: [{ kind: 'star' }] } },
          ],
        },
      },
      right: { kind: 'int', v: 0 },
    })
  })

  it('subquery with an inner filter', () => {
    const ast = query(db, 'vehicle')
      .select('id')
      .where(eq(subquery(db.vehicle.trips, count('*'), eq(db.trip.state, 'COMPLETED')), 1))
      .toAST() as any
    assert.deepStrictEqual(ast.select.left.query.select, {
      kind: 'infix',
      op: '=',
      left: { kind: 'attr', ids: ['state'] },
      right: { kind: 'str', v: 'COMPLETED' },
    })
  })

  it('caseWhen with ELSE', () => {
    const ast = query(db, 'trip')
      .select('id', alias('priority', caseWhen([{ when: eq(db.trip.state, 'COMPLETED'), then: 2 }], 1)))
      .toAST() as any
    assert.deepStrictEqual(ast.project[1], {
      kind: 'expr',
      label: 'priority',
      expr: {
        kind: 'case',
        whens: [
          {
            cond: { kind: 'infix', op: '=', left: { kind: 'attr', ids: ['state'] }, right: { kind: 'str', v: 'COMPLETED' } },
            expr: { kind: 'int', v: 2 },
          },
        ],
        els: { kind: 'int', v: 1 },
      },
    })
  })

  it('caseWhen without ELSE omits els', () => {
    const ast = query(db, 'trip')
      .select('id', alias('flag', caseWhen([{ when: eq(db.trip.state, 'COMPLETED'), then: 1 }])))
      .toAST() as any
    const caseNode = ast.project[1].expr
    assert.equal(caseNode.kind, 'case')
    assert.equal('els' in caseNode, false)
  })

  it('asc with explicit NULLS placement', () => {
    const ast = query(db, 'trip').select('id').orderBy(asc(db.trip.scheduledAt, 'last')).toAST() as any
    assert.deepStrictEqual(ast.order, [{ expr: { kind: 'attr', ids: ['scheduledAt'] }, dir: 'ASC NULLS LAST' }])
  })

  it('asc/desc without NULLS use the bare direction', () => {
    const ast = query(db, 'trip').select('id').orderBy(asc(db.trip.id), desc(db.trip.createdAt)).toAST() as any
    assert.deepStrictEqual(ast.order, [
      { expr: { kind: 'attr', ids: ['id'] }, dir: 'ASC' },
      { expr: { kind: 'attr', ids: ['createdAt'] }, dir: 'DESC' },
    ])
  })

  it('column-to-column comparison emits an attr operand (not a param)', () => {
    const ast = query(db, 'vehicle').select('id').where(ne(db.vehicle.make, db.vehicle.model)).toAST() as any
    assert.deepStrictEqual(ast.select, {
      kind: 'infix',
      op: '!=',
      left: { kind: 'attr', ids: ['make'] },
      right: { kind: 'attr', ids: ['model'] },
    })
  })

  it('outer() emits the outer-entity-prefixed attr inside a subquery', () => {
    const ast = query(db, 'vehicle')
      .select('id')
      .where(exists(db.vehicle.trips, ne(db.trip.store, outer(db.vehicle.store))))
      .toAST() as any
    assert.deepStrictEqual(ast.select, {
      kind: 'exists',
      source: 'trips',
      select: {
        kind: 'infix',
        op: '!=',
        left: { kind: 'ref', ids: ['store'] },
        right: { kind: 'attr', ids: ['vehicle', 'store', 'id'] },
      },
    })
  })

  it('outer() prefixes the ROOT entity across multiple relation hops', () => {
    // A two-hop correlated path must resolve to the chain's root (trip), not the
    // field's immediate owner (place/store). m2o ref and its .id column agree.
    assert.deepStrictEqual((outer(db.trip.store.place) as any).toAST(), {
      kind: 'attr',
      ids: ['trip', 'store', 'place', 'id'],
    })
    assert.deepStrictEqual((outer(db.trip.store.place.id) as any).toAST(), {
      kind: 'attr',
      ids: ['trip', 'store', 'place', 'id'],
    })
  })

  it('outer() multi-hop inside a subquery (step place vs trip store place)', () => {
    const ast = query(db, 'trip')
      .select('id')
      .where(exists(db.trip.steps, ne(db.tripStep.place, outer(db.trip.store.place))))
      .toAST() as any
    assert.deepStrictEqual(ast.select, {
      kind: 'exists',
      source: 'steps',
      select: {
        kind: 'infix',
        op: '!=',
        left: { kind: 'ref', ids: ['place'] },
        right: { kind: 'attr', ids: ['trip', 'store', 'place', 'id'] },
      },
    })
  })
})
