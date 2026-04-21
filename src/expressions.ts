import type { FieldRef, OQLProjectionArg } from './types.js'
import type { FilterContext, FilterExpr } from './operators.js'

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
// Parameterized by the RESULT SHAPE so the projection result is typed:
// alias<{ returnTripId: string }>('returnTripId', ...) contributes
// { returnTripId: string } to the inferred projection.
// ══════════════════════════════════════════════════════════════════════

export function alias<Shape extends Record<string, unknown>>(
  label: string,
  field: FieldRef<any> | OQLExpr<any>,
): OQLExpr<Shape> & OQLProjectionArg & { _projectionType: Shape } {
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
