import type {
  FieldRef,
  OQLProjectionArg,
  Schema,
  RelationFieldRef,
  PKType,
  ProjectionArg,
  InferProjection,
} from './types.js'
import { and, type FilterArg, type FilterContext, type OrderExpr } from './operators.js'
import { argToAST, fieldRefToAST, operandToAST, whereToAST, buildProjectionAST, type ASTNode } from './ast.js'

// ══════════════════════════════════════════════════════════════════════
// OQLExpr — can appear in both filter and projection positions
// ══════════════════════════════════════════════════════════════════════

export interface OQLExpr<T = unknown> {
  readonly __oqlExpr: true
  readonly _type: T
  toOQL(ctx: FilterContext): string
  toAST(): ASTNode
}

// ══════════════════════════════════════════════════════════════════════
// fn(name, ...args) — function call, e.g. fn('concat', a, ' ', b)
// ══════════════════════════════════════════════════════════════════════

type FnArg = FieldRef<any> | OQLExpr<any> | string | number | boolean | { fieldName: string }

function renderFnArg(arg: FnArg, ctx: FilterContext): string {
  if (typeof arg === 'object' && arg !== null) {
    if ('__oqlExpr' in arg) return (arg as OQLExpr).toOQL(ctx)
    if ('fieldName' in arg) return arg.fieldName
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
  readonly then: T | OQLExpr<T>
}

export function caseWhen<T>(
  branches: ReadonlyArray<CaseBranch<T>>,
  elseValue: T | OQLExpr<T>,
): OQLExpr<T> & FieldRef<T>
export function caseWhen<T>(branches: ReadonlyArray<CaseBranch<T>>): OQLExpr<T | null> & FieldRef<T | null>
export function caseWhen<T>(branches: ReadonlyArray<CaseBranch<T>>, elseValue?: T | OQLExpr<T>): any {
  const operandOQL = (v: unknown, ctx: FilterContext): string =>
    v !== null && typeof v === 'object' && '__oqlExpr' in (v as any)
      ? (v as OQLExpr).toOQL(ctx)
      : ctx.addParam(v)
  return {
    __oqlExpr: true,
    __fieldRef: true,
    _type: undefined,
    entityName: '',
    fieldName: '',
    builder: null,
    toOQL(ctx: FilterContext): string {
      const whens = branches
        .map((b) => `WHEN ${and(b.when).toOQL(ctx)} THEN ${operandOQL(b.then, ctx)}`)
        .join(' ')
      const elsePart = elseValue !== undefined ? ` ELSE ${operandOQL(elseValue, ctx)}` : ''
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
      return `${label}: (${(inner as FieldRef).fieldName})`
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
