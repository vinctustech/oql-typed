import type { FieldRef } from './types.js'
import type { FilterContext } from './operators.js'
import type { OQLExpr } from './expressions.js'

// ══════════════════════════════════════════════════════════════════════
// Typed wrappers for common SQL functions.
//
// Each returns an OQLExpr & FieldRef with a concrete element type, so
// call sites don't need a type annotation. Nullability is preserved
// where the SQL function propagates NULL (lower, upper, trim, etc.).
//
// `fn(name, ...)` remains the escape hatch for functions not listed here.
// ══════════════════════════════════════════════════════════════════════

type StringArg = FieldRef<string> | FieldRef<string | null> | OQLExpr<string> | string
type NumberArg = FieldRef<number> | FieldRef<number | null> | OQLExpr<number> | number
type AnyArg = FieldRef<any> | OQLExpr<any> | string | number | boolean

function renderArg(arg: AnyArg, ctx: FilterContext): string {
  if (typeof arg === 'object' && arg !== null) {
    if ('__oqlExpr' in (arg as any)) return (arg as OQLExpr).toOQL(ctx)
    if ('fieldName' in (arg as any)) return (arg as FieldRef).fieldName
  }
  if (typeof arg === 'string') return ctx.addParam(arg)
  return String(arg)
}

function makeCall<T>(name: string, args: AnyArg[]): OQLExpr<T> & FieldRef<T> {
  const expr: any = {
    __oqlExpr: true,
    __fieldRef: true,
    _type: undefined,
    entityName: '',
    fieldName: '',
    builder: null,
    toOQL(ctx: FilterContext): string {
      return `${name}(${args.map((a) => renderArg(a, ctx)).join(', ')})`
    },
  }
  return expr
}

// Nullability propagation for unary functions that return NULL on NULL input
type Nullify<In, Out> = [In] extends [FieldRef<infer T>]
  ? null extends T
    ? Out | null
    : Out
  : Out

// ─── String functions ───────────────────────────────────────────────

export function lower<T extends FieldRef<string | null>>(x: T): OQLExpr<Nullify<T, string>> & FieldRef<Nullify<T, string>> {
  return makeCall('LOWER', [x])
}

export function upper<T extends FieldRef<string | null>>(x: T): OQLExpr<Nullify<T, string>> & FieldRef<Nullify<T, string>> {
  return makeCall('UPPER', [x])
}

export function trim<T extends FieldRef<string | null>>(x: T): OQLExpr<Nullify<T, string>> & FieldRef<Nullify<T, string>> {
  return makeCall('TRIM', [x])
}

export function length<T extends FieldRef<string | null>>(x: T): OQLExpr<Nullify<T, number>> & FieldRef<Nullify<T, number>> {
  return makeCall('LENGTH', [x])
}

export function concat(...args: StringArg[]): OQLExpr<string> & FieldRef<string> {
  return makeCall('concat', args)
}

// `||` operator chain — emits `(a || b || ...)`. Unlike concat(), propagates
// NULL: if any operand is NULL the whole expression is NULL. Use this form when
// you need the expression to match a PG expression index built with `||`
// (CONCAT() is STABLE and can't be indexed, the `||` operator is IMMUTABLE).
export function concatOp(...args: StringArg[]): OQLExpr<string | null> & FieldRef<string | null> {
  const expr: any = {
    __oqlExpr: true,
    __fieldRef: true,
    _type: undefined,
    entityName: '',
    fieldName: '',
    builder: null,
    toOQL(ctx: FilterContext): string {
      return `(${args.map((a) => renderArg(a, ctx)).join(' || ')})`
    },
  }
  return expr
}

// ─── Null handling ──────────────────────────────────────────────────

// coalesce(a, b): returns common non-null type. Typed by the LAST arg;
// if the final fallback is non-null, result is non-null.
export function coalesce<T>(
  ...args: [FieldRef<T | null> | OQLExpr<T | null> | T, ...(FieldRef<T | null> | OQLExpr<T | null> | T)[], FieldRef<T> | OQLExpr<T> | T]
): OQLExpr<T> & FieldRef<T>
export function coalesce<T>(
  ...args: (FieldRef<T | null> | OQLExpr<T | null> | T)[]
): OQLExpr<T | null> & FieldRef<T | null>
export function coalesce(...args: AnyArg[]): any {
  return makeCall('coalesce', args)
}

// ─── Aggregates ─────────────────────────────────────────────────────
//
// count() is always non-null (0 on empty set). sum/avg/min/max always
// return nullable because an empty set (or all-NULL set) yields NULL.

export function count(x: FieldRef<any> | '*' = '*'): OQLExpr<number> & FieldRef<number> {
  if (x === '*') {
    const expr: any = {
      __oqlExpr: true,
      __fieldRef: true,
      _type: undefined,
      entityName: '',
      fieldName: '',
      builder: null,
      toOQL(_ctx: FilterContext): string {
        return 'count(*)'
      },
    }
    return expr
  }
  return makeCall('count', [x])
}

export function sum<T extends FieldRef<number | null>>(
  x: T,
): OQLExpr<number | null> & FieldRef<number | null> {
  return makeCall('sum', [x])
}

export function avg<T extends FieldRef<number | null>>(
  x: T,
): OQLExpr<number | null> & FieldRef<number | null> {
  return makeCall('avg', [x])
}

export function min<T>(
  x: FieldRef<T>,
): OQLExpr<T | null> & FieldRef<T | null> {
  return makeCall('min', [x]) as any
}

export function max<T>(
  x: FieldRef<T>,
): OQLExpr<T | null> & FieldRef<T | null> {
  return makeCall('max', [x]) as any
}
