import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { typedOQL, type OQLInstance } from './db.js'
import { query } from './query.js'
import { eq, and, or, lt, inList, isNull, exists, ilike, desc } from './operators.js'
import { alias, currentTimestamp } from './expressions.js'
import { sum, concatOp } from './functions.js'
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
  entity: () => ({ insert: () => Promise.resolve({}) as any, update: () => Promise.resolve({}) as any }),
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

  it('eq on a manyToOne FK resolves to .id', () => {
    const ast = query(db, 'trip').select('id').where(eq(db.trip.vehicle, 'v1')).toAST() as any
    assert.deepStrictEqual(ast.select, {
      kind: 'infix',
      op: '=',
      left: { kind: 'attr', ids: ['vehicle', 'id'] },
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
    assert.deepStrictEqual(ast.select, { kind: 'postfix', op: 'IS NULL', expr: { kind: 'attr', ids: ['returnTripFor', 'id'] } })
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
})
