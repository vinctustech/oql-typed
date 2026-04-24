import type { FieldRef, OQLProjectionArg } from './types.js'
import { and, type FilterArg, type FilterContext, type FilterExpr, type OrderExpr } from './operators.js'

// ══════════════════════════════════════════════════════════════════════
// OQLExpr — can appear in both filter and projection positions
// ══════════════════════════════════════════════════════════════════════

export interface OQLExpr<T = unknown> {
  readonly __oqlExpr: true
  readonly _type: T
  toOQL(ctx: FilterContext): string
}

// ══════════════════════════════════════════════════════════════════════
// fn(name, ...args) — function call, e.g. fn('concat', a, raw("' '"), b)
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
  }
  return expr
}

// ══════════════════════════════════════════════════════════════════════
// raw(oql) — escape hatch for anything without a typed wrapper
// ══════════════════════════════════════════════════════════════════════

export function raw<T = unknown>(oql: string): OQLExpr<T> & FieldRef<T> & OQLProjectionArg {
  return {
    __oqlExpr: true,
    __fieldRef: true,
    _type: undefined,
    entityName: '',
    fieldName: oql,
    builder: null,
    toOQL(_ctx: FilterContext): string {
      return oql
    },
  } as any
}

// ══════════════════════════════════════════════════════════════════════
// ref(field) — & reference operator: &returnTripFor IS NULL
// ══════════════════════════════════════════════════════════════════════

export function ref<T = unknown>(field: { fieldName: string; builder?: any }): OQLExpr<T> & FieldRef<T> {
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
  } as any
}

// ══════════════════════════════════════════════════════════════════════
// subquery(relation, [projection], filter?) — (drivers {count(*)}) = 0
// ══════════════════════════════════════════════════════════════════════

export function subquery<T = unknown>(
  relation: { fieldName: string } | { entityName: string },
  projection: string[],
  filter?: FilterExpr,
): OQLExpr<T> & FieldRef<T> {
  const name =
    'fieldName' in relation && relation.fieldName ? relation.fieldName : (relation as any).entityName
  return {
    __oqlExpr: true,
    __fieldRef: true,
    _type: undefined,
    entityName: '',
    fieldName: '',
    builder: null,
    toOQL(ctx: FilterContext): string {
      let q = `${name} {${projection.join(' ')}}`
      if (filter) q += ` [${filter.toOQL(ctx)}]`
      return `(${q})`
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
  } as any
}

// ══════════════════════════════════════════════════════════════════════
// aliasedRelation(alias, relation, spec) — alias a sub-collection projection:
//   passengers: trips {count: sum(seats)} [state != 'COMPLETED']
//
// The outer key is inferred from the `alias` argument. The inner row shape
// is inferred from any typed expressions in `spec.fields` (e.g. entries
// built with `alias(...)` over typed aggregates like `sum(...)`).
//
// For untyped fields (scalar field names, `raw('...')`) the caller can
// provide an explicit inner Shape as the first type argument:
//   aliasedRelation<{ count: number }>('passengers', 'trips', { fields: [raw('count: sum(seats)')] })
//
// When Shape is provided, it overrides inference. When it is not, inference
// merges every typed-field `_projectionType` into the inner row shape.
// ══════════════════════════════════════════════════════════════════════

type UnionToIntersection<U> = (U extends any ? (k: U) => void : never) extends (k: infer I) => void
  ? I
  : never

// Extract `_projectionType` contributions from each field entry and intersect them.
// Fields without a typed projection (raw, scalar strings) contribute nothing.
type InferAliasedRelRow<Fields extends readonly any[]> = UnionToIntersection<
  Fields[number] extends { readonly _projectionType?: infer P }
    ? P extends Record<string, unknown>
      ? P
      : never
    : never
>

export interface AliasedRelationSpec {
  readonly fields: readonly (string | OQLExpr<any> | Record<string, any>)[]
  readonly where?: FilterArg
  readonly orderBy?: readonly OrderExpr[]
}

// Prettify an object type to a flat literal — collapses intersections and
// makes AssertEqual produce a stable result.
type Prettify<T> = { [K in keyof T]: T[K] } & {}

type AliasedRelResult<
  Shape extends Record<string, unknown>,
  Label extends string,
  Fields extends readonly any[],
> = Prettify<{
  [K in Label]: ([Shape] extends [never] ? InferAliasedRelRow<Fields> : Shape)[]
}>

export function aliasedRelation<
  Shape extends Record<string, unknown> = never,
  const Label extends string = string,
  const Fields extends readonly (string | OQLExpr<any> | Record<string, any>)[] = readonly (
    | string
    | OQLExpr<any>
    | Record<string, any>
  )[],
>(
  alias: Label,
  relation: string,
  spec: Omit<AliasedRelationSpec, 'fields'> & { readonly fields: Fields },
): OQLExpr<AliasedRelResult<Shape, Label, Fields>> &
  OQLProjectionArg & {
    _projectionType: AliasedRelResult<Shape, Label, Fields>
  } {
  return {
    __oqlExpr: true,
    _type: undefined as any,
    _projectionType: undefined as any,
    toOQL(ctx: FilterContext): string {
      const fieldsStr = spec.fields
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
      let s = `${alias}: ${relation} {${fieldsStr}}`
      if (spec.where) s += ` [${and(spec.where).toOQL(ctx)}]`
      if (spec.orderBy && spec.orderBy.length > 0) {
        s += ` <${spec.orderBy.map((o) => o.toOQL()).join(', ')}>`
      }
      return s
    },
  } as any
}
