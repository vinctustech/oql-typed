/**
 * COMPILE-TIME TYPE ASSERTIONS for typed SQL function wrappers.
 * The real checks happen in `tsc --noEmit`; runtime is just a placeholder.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { typedOQL, lower, upper, trim, length, concat, coalesce, count } from './index.js'

import { schema } from './test-schema.js'

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

describe('typed function wrappers', () => {
  it('placeholder', () => assert.ok(true))

  // lower/upper/trim preserve nullability of input
  type _L1 = AssertTrue<AssertEqual<ReturnType<typeof lower<typeof db.user.email>>['_type'], string>>
  type _L2 = AssertTrue<
    AssertEqual<ReturnType<typeof lower<typeof db.place.address>>['_type'], string | null>
  >
  type _U1 = AssertTrue<AssertEqual<ReturnType<typeof upper<typeof db.user.email>>['_type'], string>>
  type _T1 = AssertTrue<AssertEqual<ReturnType<typeof trim<typeof db.user.email>>['_type'], string>>

  // length returns number, nullability propagated
  type _Len1 = AssertTrue<
    AssertEqual<ReturnType<typeof length<typeof db.user.email>>['_type'], number>
  >
  type _Len2 = AssertTrue<
    AssertEqual<ReturnType<typeof length<typeof db.place.address>>['_type'], number | null>
  >

  // concat always returns string
  async function _concat() {
    const e = concat(db.user.firstName, ' ', db.user.lastName)
    type _ = AssertTrue<AssertEqual<(typeof e)['_type'], string>>
  }

  // coalesce — non-null last arg makes result non-null
  async function _coalesce() {
    const e1 = coalesce(db.place.address, 'fallback')
    type _1 = AssertTrue<AssertEqual<(typeof e1)['_type'], string>>

    // both nullable → nullable
    const e2 = coalesce(db.place.address, db.place.address)
    type _2 = AssertTrue<AssertEqual<(typeof e2)['_type'], string | null>>
  }

  // count returns number
  async function _count() {
    const e = count()
    type _ = AssertTrue<AssertEqual<(typeof e)['_type'], number>>
    const e2 = count(db.user.id)
    type __ = AssertTrue<AssertEqual<(typeof e2)['_type'], number>>
  }

  // Negatives: can't pass number field to string function
  // @ts-expect-error — lower on a Date field
  lower(db.user.createdAt)
  // @ts-expect-error — length on a Date field
  length(db.user.createdAt)
})
