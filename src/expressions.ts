import type { FieldRef } from './schema.js'
import type { FilterContext, FilterExpr } from './operators.js'

// ── Expression that can be used in both projections and filter positions ──

export interface OQLExpr<T = unknown> {
  readonly __oqlExpr: true
  readonly _type: T
  toOQL(ctx: FilterContext): string
}

// ── Function call expression: fn('concat', field1, raw("' '"), field2) ──

type FnArg = FieldRef<any> | OQLExpr<any> | string | number | boolean

function renderArg(arg: FnArg, ctx: FilterContext): string {
  if (typeof arg === 'object' && '__oqlExpr' in arg) {
    return arg.toOQL(ctx)
  }
  if (typeof arg === 'object' && '__fieldRef' in arg) {
    return (arg as FieldRef).fieldName
  }
  if (typeof arg === 'object' && '__relationRef' in arg) {
    return (arg as any).fieldName
  }
  if (typeof arg === 'string') {
    return ctx.addParam(arg)
  }
  return String(arg)
}

export function fn<T = unknown>(name: string, ...args: FnArg[]): OQLExpr<T> & FieldRef<T> {
  const expr: any = {
    __oqlExpr: true,
    __fieldRef: true,
    entityName: '',
    fieldName: '', // filled dynamically via toOQL
    builder: null,
    toOQL(ctx: FilterContext): string {
      const renderedArgs = args.map((a) => renderArg(a, ctx))
      return `${name}(${renderedArgs.join(', ')})`
    },
  }
  // For use in comparison operators (eq, ilike, etc.), override fieldName generation
  // The operators use field.fieldName, but fn() needs to generate the full call via toOQL
  return expr
}

// ── Reference operator: ref(trip.returnTripFor) → &returnTripFor ──

export function ref<T = unknown>(field: FieldRef<any>): OQLExpr<T> & FieldRef<T> {
  return {
    __oqlExpr: true,
    __fieldRef: true,
    _type: undefined as any,
    entityName: field.entityName,
    fieldName: `&${field.fieldName}`,
    builder: field.builder,
    toOQL(_ctx: FilterContext): string {
      return `&${field.fieldName}`
    },
  } as any
}

// ── Subquery expression: subquery(entity, ['count(*)']) → (entity {count(*)}) ──

export function subquery<T = unknown>(
  relation: { fieldName: string } | { entityName: string },
  projection: string[],
  filter?: FilterExpr,
): OQLExpr<T> & FieldRef<T> {
  // Use fieldName for relation refs (e.g., vehicle.drivers → 'drivers')
  // Fall back to entityName for entity refs
  const name = 'fieldName' in relation && relation.fieldName ? relation.fieldName : (relation as any).entityName
  const expr: any = {
    __oqlExpr: true,
    __fieldRef: true,
    _type: undefined as any,
    entityName: '',
    fieldName: '',
    builder: null,
    toOQL(ctx: FilterContext): string {
      let q = `${name} {${projection.join(' ')}}`
      if (filter) {
        q += ` [${filter.toOQL(ctx)}]`
      }
      return `(${q})`
    },
  }
  return expr
}

// ── Raw OQL expression: raw("' '"), raw('count: sum(seats)') ──

export function raw<T = unknown>(oql: string): OQLExpr<T> & FieldRef<T> {
  return {
    __oqlExpr: true,
    __fieldRef: true,
    _type: undefined as any,
    entityName: '',
    fieldName: oql,
    builder: null as any,
    toOQL(_ctx: FilterContext): string {
      return oql
    },
  } as any
}
