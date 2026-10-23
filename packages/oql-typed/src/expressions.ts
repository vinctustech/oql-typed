import type {
  FieldRef,
  OQLProjectionArg,
  Schema,
  RelationFieldRef,
  PKType,
  ProjectionArg,
  InferProjection,
} from './types.js'
import type { Interval } from './interval.js'
import { and, type FilterArg, type FilterContext, type OrderExpr } from './operators.js'
import {
  argToAST,
  fieldRefToAST,
  fieldRefToOQL,
  joinedFieldPath,
  operandToAST,
  whereToAST,
  buildProjectionAST,
  type ASTNode,
} from './ast.js'

// ══════════════════════════════════════════════════════════════════════
// OQLExpr — can appear in both filter and projection positions
// ══════════════════════════════════════════════════════════════════════

export interface OQLExpr<T = unknown> {
  readonly __oqlExpr: true
  readonly _type: T
  toOQL(ctx: FilterContext): string
  toAST(): ASTNode
}

// Comparison / CASE / arithmetic operand -> OQL text. The string-path twin of
// operandToAST: an expression emits inline, a column emits as a reference, and
// anything else becomes a parameter.
function operandToOQL(value: unknown, ctx: FilterContext): string {
  if (value !== null && typeof value === 'object') {
    if ('__oqlExpr' in (value as any)) return (value as OQLExpr).toOQL(ctx)
    if ('__fieldRef' in (value as any) || '__relationRef' in (value as any)) return fieldRefToOQL(value)
  }
  return ctx.addParam(value)
}

// ══════════════════════════════════════════════════════════════════════
// fn(name, ...args) — function call, e.g. fn('concat', a, ' ', b)
// ══════════════════════════════════════════════════════════════════════

type FnArg = FieldRef<any> | OQLExpr<any> | string | number | boolean | { fieldName: string }

function renderFnArg(arg: FnArg, ctx: FilterContext): string {
  if (typeof arg === 'object' && arg !== null) {
    if ('__oqlExpr' in arg) return (arg as OQLExpr).toOQL(ctx)
    if ('fieldName' in arg) return fieldRefToOQL(arg)
  }
  if (typeof arg === 'string') return ctx.addParam(arg)
  return String(arg)
}

export function fn<T = unknown>(name: string, ...args: FnArg[]): OQLExpr<T> & FieldRef<T> {
  const expr: any = {
    __oqlExpr: true,
    __fieldRef: true,
    _type: undefined,
    entityName: '',
    fieldName: '',
    builder: null,
    toOQL(ctx: FilterContext): string {
      return `${name}(${args.map((a) => renderFnArg(a, ctx)).join(', ')})`
    },
    toAST() {
      return { kind: 'apply', f: name, args: args.map(argToAST) }
    },
  }
  return expr
}

// ══════════════════════════════════════════════════════════════════════
// caseWhen(branches, else?) — searched CASE expression:
//   caseWhen([{ when: eq(db.trip.state, 'COMPLETED'), then: 2 }], 1)
//     →  CASE WHEN state = :p0 THEN 2 ELSE 1 END
//
// `then`/`else` accept a literal or an OQLExpr; the result type T is inferred
// from them. With an `else` the result is T; without one it is T | null (SQL
// yields NULL when no branch matches).
// ══════════════════════════════════════════════════════════════════════

export interface CaseBranch<T> {
  readonly when: FilterArg
  readonly then: T | OQLExpr<T> | FieldRef<T>
}

export function caseWhen<T>(
  branches: ReadonlyArray<CaseBranch<T>>,
  elseValue: T | OQLExpr<T> | FieldRef<T>,
): OQLExpr<T> & FieldRef<T>
export function caseWhen<T>(branches: ReadonlyArray<CaseBranch<T>>): OQLExpr<T | null> & FieldRef<T | null>
export function caseWhen<T>(
  branches: ReadonlyArray<CaseBranch<T>>,
  elseValue?: T | OQLExpr<T> | FieldRef<T>,
): any {
  return {
    __oqlExpr: true,
    __fieldRef: true,
    _type: undefined,
    entityName: '',
    fieldName: '',
    builder: null,
    toOQL(ctx: FilterContext): string {
      const whens = branches
        .map((b) => `WHEN ${and(b.when).toOQL(ctx)} THEN ${operandToOQL(b.then, ctx)}`)
        .join(' ')
      const elsePart = elseValue !== undefined ? ` ELSE ${operandToOQL(elseValue, ctx)}` : ''
      return `CASE ${whens}${elsePart} END`
    },
    toAST() {
      const node: ASTNode = {
        kind: 'case',
        whens: branches.map((b) => ({ cond: and(b.when).toAST(), expr: operandToAST(b.then) })),
      }
      if (elseValue !== undefined) node.els = operandToAST(elseValue)
      return node
    },
  }
}

// ══════════════════════════════════════════════════════════════════════
// currentTimestamp() — the database's current time (CURRENT_TIMESTAMP).
//
// Usable as the value side of a comparison operator, so a column can be
// compared against "now":
//   lte(db.account.trialEndAt, currentTimestamp())  →  trialEndAt <= CURRENT_TIMESTAMP
// ══════════════════════════════════════════════════════════════════════

export function currentTimestamp(): OQLExpr<Date> & FieldRef<Date> {
  return {
    __oqlExpr: true,
    __fieldRef: true,
    _type: undefined,
    entityName: '',
    fieldName: 'CURRENT_TIMESTAMP',
    builder: null,
    toOQL(_ctx: FilterContext): string {
      return 'CURRENT_TIMESTAMP'
    },
    toAST() {
      return { kind: 'attr', ids: ['CURRENT_TIMESTAMP'] }
    },
  } as any
}

// ══════════════════════════════════════════════════════════════════════
// currentDate() — the database's current date (current_date), the date-only
// twin of currentTimestamp().
// ══════════════════════════════════════════════════════════════════════

export function currentDate(): OQLExpr<Date> & FieldRef<Date> {
  return {
    __oqlExpr: true,
    __fieldRef: true,
    _type: undefined,
    entityName: '',
    fieldName: 'current_date',
    builder: null,
    toOQL(_ctx: FilterContext): string {
      return 'current_date'
    },
    toAST() {
      return { kind: 'attr', ids: ['current_date'] }
    },
  } as any
}

// ══════════════════════════════════════════════════════════════════════
// Arithmetic — add/subtract/multiply/divide over columns, expressions and
// literals:
//   add(currentTimestamp(), makeInterval({ minutes: 30 }))
//     →  CURRENT_TIMESTAMP + make_interval(0, 0, 0, 0, 0, 30, 0)
//
// A nested arithmetic operand is wrapped in parentheses (a `grouped` node on
// the AST path), so the grouping you wrote is the grouping that runs and
// operator precedence never rewrites the expression.
//
// Typing follows PostgreSQL's interval arithmetic: number ⊕ number is a
// number, Date − Date is an Interval, Date ± Interval is a Date, and an
// Interval scaled by a number stays an Interval.
// ══════════════════════════════════════════════════════════════════════

// The OQL AST decoder has no cast node, so an interval can only enter an
// expression through an interval column, makeInterval(), or the subtraction of
// two timestamps — never through `'30 minutes'::INTERVAL`.
//
// Nullable variants are accepted throughout: SQL arithmetic on NULL yields
// NULL rather than an error, exactly as in the untyped query.
export type Operand<T> = FieldRef<T | null> | OQLExpr<T | null>
export type NumberOperand = Operand<number> | number
export type DateOperand = Operand<Date> | Date
export type IntervalOperand = Operand<Interval>

type NumberExpr = OQLExpr<number> & FieldRef<number>
type DateExpr = OQLExpr<Date> & FieldRef<Date>
type IntervalExpr = OQLExpr<Interval> & FieldRef<Interval>

type ArithmeticOperator = '+' | '-' | '*' | '/'

function isArithmetic(operand: unknown): boolean {
  return operand !== null && typeof operand === 'object' && '__arithmetic' in (operand as any)
}

function arithmetic(op: ArithmeticOperator, left: unknown, right: unknown): any {
  const operandOQL = (operand: unknown, ctx: FilterContext): string => {
    const text = operandToOQL(operand, ctx)
    return isArithmetic(operand) ? `(${text})` : text
  }
  const operandAST = (operand: unknown): ASTNode => {
    const node = operandToAST(operand)
    return isArithmetic(operand) ? { kind: 'grouped', expr: node } : node
  }
  return {
    __oqlExpr: true,
    __fieldRef: true,
    __arithmetic: true,
    _type: undefined,
    entityName: '',
    fieldName: '',
    builder: null,
    toOQL(ctx: FilterContext): string {
      return `${operandOQL(left, ctx)} ${op} ${operandOQL(right, ctx)}`
    },
    toAST(): ASTNode {
      return { kind: 'infix', op, left: operandAST(left), right: operandAST(right) }
    },
  }
}

export function add(left: NumberOperand, right: NumberOperand): NumberExpr
export function add(left: DateOperand, right: IntervalOperand): DateExpr
export function add(left: IntervalOperand, right: DateOperand): DateExpr
export function add(left: IntervalOperand, right: IntervalOperand): IntervalExpr
export function add(left: any, right: any): any {
  return arithmetic('+', left, right)
}

export function subtract(left: NumberOperand, right: NumberOperand): NumberExpr
export function subtract(left: DateOperand, right: DateOperand): IntervalExpr
export function subtract(left: DateOperand, right: IntervalOperand): DateExpr
export function subtract(left: IntervalOperand, right: IntervalOperand): IntervalExpr
export function subtract(left: any, right: any): any {
  return arithmetic('-', left, right)
}

export function multiply(left: NumberOperand, right: NumberOperand): NumberExpr
export function multiply(left: IntervalOperand, right: NumberOperand): IntervalExpr
export function multiply(left: NumberOperand, right: IntervalOperand): IntervalExpr
export function multiply(left: any, right: any): any {
  return arithmetic('*', left, right)
}

export function divide(left: NumberOperand, right: NumberOperand): NumberExpr
export function divide(left: IntervalOperand, right: NumberOperand): IntervalExpr
export function divide(left: any, right: any): any {
  return arithmetic('/', left, right)
}

// ══════════════════════════════════════════════════════════════════════
// ref(manyToOneRelation) — & reference operator: the foreign-key value itself
// (no join to the target). Its type is inferred as the target entity's primary
// key type, so `ref(db.comment.parent)` is OQLExpr<string> (a uuid FK):
//   isNull(ref(db.trip.returnTripFor))  →  &returnTripFor IS NULL
// ══════════════════════════════════════════════════════════════════════

export function ref<S extends Schema, Target extends keyof S>(
  field: RelationFieldRef<S, Target, 'manyToOne'>,
): OQLExpr<PKType<S, Target>> & FieldRef<PKType<S, Target>> {
  return {
    __oqlExpr: true,
    __fieldRef: true,
    _type: undefined,
    entityName: '',
    fieldName: `&${field.fieldName}`,
    builder: field.builder ?? null,
    toOQL(_ctx: FilterContext): string {
      return `&${field.fieldName}`
    },
    toAST() {
      return { kind: 'ref', ids: String(field.fieldName).split('.') }
    },
  } as any
}

// ══════════════════════════════════════════════════════════════════════
// outer(field) — correlated reference to the ENCLOSING query's row from inside
// a subquery. Emits OQL's outer reference `^<root>.<path>`, where <root> is the
// entity the ref chain was started from (`db.<root>…`); OQL resolves it against
// the nearest enclosing query over that entity and renders it on that query's
// alias, so the subquery joins nothing to reach it:
//   exists(db.order.lineItems, ne(db.lineItem.warehouse, outer(db.order.warehouse)))
//     →  EXISTS(lineItems [warehouse.id != ^order.warehouse.id])
// The path may cross any number of relation hops; the root is preserved across
// every hop (see createRelationRef), so a multi-hop ref works too:
//   outer(db.trip.store.place)  →  ^trip.store.place.id
// ══════════════════════════════════════════════════════════════════════

export function outer<T>(field: FieldRef<T>): OQLExpr<T> & FieldRef<T>
export function outer<S extends Schema, Target extends keyof S>(
  field: RelationFieldRef<S, Target, 'manyToOne'>,
): OQLExpr<PKType<S, Target>> & FieldRef<PKType<S, Target>>
export function outer(field: any): any {
  // A correlated reference names the enclosing query's row, so it takes the
  // joined path (m2o -> ".id") rather than the foreign-key column; its head is
  // the chain's ROOT entity (not the field's immediate owner), which names the
  // enclosing query across any number of relation hops.
  const root = field.rootEntityName ?? field.entityName
  const ids = [String(root), ...joinedFieldPath(field)]
  const path = `^${ids.join('.')}`
  return {
    __oqlExpr: true,
    __fieldRef: true,
    _type: undefined,
    entityName: '',
    fieldName: path,
    builder: null,
    toOQL(_ctx: FilterContext): string {
      return path
    },
    toAST(): ASTNode {
      return { kind: 'outer', ids }
    },
  }
}

// ══════════════════════════════════════════════════════════════════════
// subquery(relation, projection, filter?) — a scalar subquery used as a value:
//   eq(subquery(db.vehicle.trips, count('*')), 0)  →  (trips {value: (count(*))}) = 0
//
// `projection` is a typed expression (count('*'), sum(field), ...); its element
// type is the subquery's scalar type, so `T` is inferred. An optional `filter`
// scopes the inner rows. Fully typed — no raw OQL strings.
// ══════════════════════════════════════════════════════════════════════

export function subquery<T = unknown>(
  relation: { fieldName: string } | { entityName: string },
  projection: OQLExpr<T>,
  filter?: FilterArg,
): OQLExpr<T> & FieldRef<T> {
  const name =
    'fieldName' in relation && relation.fieldName ? relation.fieldName : (relation as any).entityName
  const cond = filter !== undefined ? and(filter) : undefined
  return {
    __oqlExpr: true,
    __fieldRef: true,
    _type: undefined,
    entityName: '',
    fieldName: '',
    builder: null,
    toOQL(ctx: FilterContext): string {
      let q = `${name} {value: (${projection.toOQL(ctx)})}`
      if (cond) q += ` [${cond.toOQL(ctx)}]`
      return `(${q})`
    },
    toAST() {
      const query: ASTNode = {
        kind: 'query',
        source: name,
        project: [{ kind: 'expr', label: 'value', expr: projection.toAST() }],
      }
      if (cond) query.select = cond.toAST()
      return { kind: 'subquery', query }
    },
  } as any
}

// ══════════════════════════════════════════════════════════════════════
// alias(label, expr) — projection with alias: returnTripId: (returnTrip.id)
//
// Label and value type are inferred from the arguments:
//   alias('avgSeats', avg(db.trip.seats))
// contributes { avgSeats: number | null } to the inferred projection.
// ══════════════════════════════════════════════════════════════════════

type AliasShape<Label extends string, T> = { [K in Label]: T }

export function alias<Label extends string, T>(
  label: Label,
  field: FieldRef<T> | OQLExpr<T>,
): OQLExpr<AliasShape<Label, T>> &
  OQLProjectionArg & { _projectionType: AliasShape<Label, T> } {
  const inner: any = field
  return {
    __oqlExpr: true,
    _type: undefined as any,
    _projectionType: undefined as any,
    toOQL(ctx: FilterContext): string {
      if ('__oqlExpr' in inner && typeof inner.toOQL === 'function') {
        return `${label}: (${inner.toOQL(ctx)})`
      }
      return `${label}: (${fieldRefToOQL(inner)})`
    },
    toAST() {
      const expr =
        '__oqlExpr' in inner && typeof (inner as any).toAST === 'function'
          ? (inner as any).toAST()
          : fieldRefToAST(inner)
      return { kind: 'expr', label, expr }
    },
  } as any
}

// ══════════════════════════════════════════════════════════════════════
// aliasedRelation(alias, relationRef, spec) — alias a sub-collection projection:
//   aliasedRelation('passengers', db.vehicle.trips, { fields: ['id', 'state'] })
//     →  { passengers: { id: string; state: TripState }[] }
//
// The relation is a typed ref (db.X.someRelation), so the target entity is
// known: field-name strings are type-checked against it and the inner row
// shape is inferred via InferProjection — no explicit Shape type, no raw
// strings. The outer key is the `alias` argument.
// ══════════════════════════════════════════════════════════════════════

export interface AliasedRelationSpec {
  readonly fields: readonly (string | OQLExpr<any> | Record<string, any>)[]
  readonly where?: FilterArg
  readonly orderBy?: readonly OrderExpr[]
}

export function aliasedRelation<
  S extends Schema,
  Target extends keyof S,
  const Label extends string,
  const Fields extends readonly ProjectionArg<S, Target>[],
>(
  alias: Label,
  relation: RelationFieldRef<S, Target>,
  spec: { readonly fields: Fields; readonly where?: FilterArg; readonly orderBy?: readonly OrderExpr[] },
): OQLExpr<{ [K in Label]: InferProjection<S, Target, Fields>[] }> &
  OQLProjectionArg & {
    _projectionType: { [K in Label]: InferProjection<S, Target, Fields>[] }
  } {
  const source = relation.fieldName
  return {
    __oqlExpr: true,
    _type: undefined as any,
    _projectionType: undefined as any,
    toOQL(ctx: FilterContext): string {
      const fieldsStr = (spec.fields as readonly any[])
        .map((f) => {
          if (typeof f === 'string') return f
          if (f && typeof f === 'object' && '__oqlExpr' in f) {
            return (f as OQLExpr).toOQL(ctx)
          }
          if (f && typeof f === 'object') {
            // Nested relation object: { rel: [...] } or { rel: { fields, where } }
            const parts: string[] = []
            for (const [key, value] of Object.entries(f as Record<string, any>)) {
              if (value && typeof value === 'object' && 'fields' in value) {
                let s = `${key} {${(value.fields as any[]).map((x: any) =>
                  typeof x === 'string' ? x : x.toOQL ? x.toOQL(ctx) : String(x),
                ).join(' ')}}`
                if (value.where) s += ` [${and(value.where).toOQL(ctx)}]`
                if (value.orderBy && value.orderBy.length > 0) {
                  s += ` <${value.orderBy.map((o: OrderExpr) => o.toOQL()).join(', ')}>`
                }
                parts.push(s)
              } else if (Array.isArray(value) && value.length > 0) {
                parts.push(`${key} {${value.join(' ')}}`)
              } else if (typeof value === 'string') {
                parts.push(`${key} {${value}}`)
              } else {
                parts.push(key)
              }
            }
            return parts.join(' ')
          }
          return String(f)
        })
        .join(' ')
      let s = `${alias}: ${source} {${fieldsStr}}`
      if (spec.where) s += ` [${and(spec.where).toOQL(ctx)}]`
      if (spec.orderBy && spec.orderBy.length > 0) {
        s += ` <${spec.orderBy.map((o) => o.toOQL()).join(', ')}>`
      }
      return s
    },
    toAST() {
      const node: ASTNode = {
        kind: 'rel',
        label: alias,
        source,
        project: buildProjectionAST(spec.fields as readonly any[]),
      }
      if (spec.where) node.select = whereToAST(spec.where)
      if (spec.orderBy && spec.orderBy.length > 0) node.order = spec.orderBy.map((o) => o.toAST())
      return node
    },
  } as any
}
