import { Relation } from './schema.js'
import type { FieldRef, RelationFieldRef, Schema } from './types.js'

// A filter operand: a scalar field ref OR a manyToOne relation ref
// (manyToOne auto-resolves to its dotted FK path at runtime).
export type FilterField<T = unknown> = FieldRef<T> | RelationFieldRef<Schema, any, 'manyToOne'>

// ══════════════════════════════════════════════════════════════════════
// Filter context — accumulates parameters during OQL string generation
// ══════════════════════════════════════════════════════════════════════

export class FilterContext {
  private params: Record<string, unknown> = {}
  private counter = 0

  addParam(value: unknown): string {
    const name = `p${this.counter++}`
    this.params[name] = value
    return `:${name}`
  }

  getParams(): Record<string, unknown> {
    return { ...this.params }
  }
}

export interface FilterExpr {
  readonly __filterExpr: true
  toOQL(ctx: FilterContext): string
}

// ══════════════════════════════════════════════════════════════════════
// Resolve a field ref to its OQL string (handles relations, expressions)
// ══════════════════════════════════════════════════════════════════════

function resolveField(field: FilterField<any>, ctx: FilterContext): string {
  // OQL expression (fn(), raw(), alias()) — delegate to toOQL
  if ('__oqlExpr' in (field as any) && typeof (field as any).toOQL === 'function') {
    return (field as any).toOQL(ctx)
  }
  // manyToOne relation — resolve to dotted FK path (store → store.id)
  if ('__relationRef' in (field as any)) {
    const rel = (field as any).builder as Relation<any, any, any>
    if (rel && rel.relationKind === 'manyToOne') {
      // Find PK of target entity via schema lookup stored on the ref
      // The fieldName already contains the relation path; we append the PK name
      // The schema is carried on db handle, but relation refs don't have it.
      // Convention: manyToOne FKs always resolve to ".id" — matching OQL's default PK naming.
      return `${(field as any).fieldName}.id`
    }
  }
  return (field as FieldRef).fieldName
}

// ══════════════════════════════════════════════════════════════════════
// Comparison operators
// ══════════════════════════════════════════════════════════════════════

// Runtime comparison — works for both FieldRef and RelationFieldRef
function compareImpl(field: any, op: string, value: unknown): FilterExpr {
  return {
    __filterExpr: true,
    toOQL(ctx) {
      return `${resolveField(field, ctx)} ${op} ${ctx.addParam(value)}`
    },
  }
}

// Overloaded: the FieldRef overload pins T strictly to the field's type.
// The RelationFieldRef overload accepts any FK type (string for UUID, number for integer PK).
// NoInfer<T> pins T to the field's type — value must match exactly, not widen.
// (TypeScript 5.4+)

export function eq<T>(field: FieldRef<T>, value: NoInfer<T>): FilterExpr
export function eq(field: RelationFieldRef<Schema, any, 'manyToOne'>, value: string | number): FilterExpr
export function eq(field: any, value: any): FilterExpr {
  return compareImpl(field, '=', value)
}

export function ne<T>(field: FieldRef<T>, value: NoInfer<T>): FilterExpr
export function ne(field: RelationFieldRef<Schema, any, 'manyToOne'>, value: string | number): FilterExpr
export function ne(field: any, value: any): FilterExpr {
  return compareImpl(field, '!=', value)
}

export function gt<T>(field: FieldRef<T>, value: NoInfer<T>): FilterExpr
export function gt(field: RelationFieldRef<Schema, any, 'manyToOne'>, value: string | number): FilterExpr
export function gt(field: any, value: any): FilterExpr {
  return compareImpl(field, '>', value)
}

export function gte<T>(field: FieldRef<T>, value: NoInfer<T>): FilterExpr
export function gte(field: RelationFieldRef<Schema, any, 'manyToOne'>, value: string | number): FilterExpr
export function gte(field: any, value: any): FilterExpr {
  return compareImpl(field, '>=', value)
}

export function lt<T>(field: FieldRef<T>, value: NoInfer<T>): FilterExpr
export function lt(field: RelationFieldRef<Schema, any, 'manyToOne'>, value: string | number): FilterExpr
export function lt(field: any, value: any): FilterExpr {
  return compareImpl(field, '<', value)
}

export function lte<T>(field: FieldRef<T>, value: NoInfer<T>): FilterExpr
export function lte(field: RelationFieldRef<Schema, any, 'manyToOne'>, value: string | number): FilterExpr
export function lte(field: any, value: any): FilterExpr {
  return compareImpl(field, '<=', value)
}

// ══════════════════════════════════════════════════════════════════════
// Logical operators
// ══════════════════════════════════════════════════════════════════════

export function and(...exprs: FilterExpr[]): FilterExpr {
  return {
    __filterExpr: true,
    toOQL(ctx) {
      return exprs.map((e) => e.toOQL(ctx)).join(' AND ')
    },
  }
}

export function or(...exprs: FilterExpr[]): FilterExpr {
  return {
    __filterExpr: true,
    toOQL(ctx) {
      const inner = exprs.map((e) => e.toOQL(ctx)).join(' OR ')
      return exprs.length > 1 ? `(${inner})` : inner
    },
  }
}

export function not(expr: FilterExpr): FilterExpr {
  return {
    __filterExpr: true,
    toOQL(ctx) {
      return `NOT (${expr.toOQL(ctx)})`
    },
  }
}

// ══════════════════════════════════════════════════════════════════════
// List / string / range / null operators
// ══════════════════════════════════════════════════════════════════════

export function inList<T>(field: FieldRef<T>, values: NoInfer<T>[]): FilterExpr
export function inList(field: RelationFieldRef<Schema, any, 'manyToOne'>, values: Array<string | number>): FilterExpr
export function inList(field: any, values: any[]): FilterExpr {
  return {
    __filterExpr: true,
    toOQL(ctx) {
      return `${resolveField(field, ctx)} IN ${ctx.addParam(values)}`
    },
  }
}

export function notInList<T>(field: FieldRef<T>, values: NoInfer<T>[]): FilterExpr
export function notInList(field: RelationFieldRef<Schema, any, 'manyToOne'>, values: Array<string | number>): FilterExpr
export function notInList(field: any, values: any[]): FilterExpr {
  return {
    __filterExpr: true,
    toOQL(ctx) {
      return `${resolveField(field, ctx)} NOT IN ${ctx.addParam(values)}`
    },
  }
}

export function like(field: FieldRef<string>, pattern: string): FilterExpr {
  return {
    __filterExpr: true,
    toOQL(ctx) {
      return `${resolveField(field, ctx)} LIKE ${ctx.addParam(pattern)}`
    },
  }
}

export function ilike(field: FieldRef<string>, pattern: string): FilterExpr {
  return {
    __filterExpr: true,
    toOQL(ctx) {
      return `${resolveField(field, ctx)} ILIKE ${ctx.addParam(pattern)}`
    },
  }
}

export function between<T>(field: FieldRef<T>, low: NoInfer<T>, high: NoInfer<T>): FilterExpr
export function between(field: RelationFieldRef<Schema, any, 'manyToOne'>, low: string | number, high: string | number): FilterExpr
export function between(field: any, low: any, high: any): FilterExpr {
  return {
    __filterExpr: true,
    toOQL(ctx) {
      return `${resolveField(field, ctx)} BETWEEN ${ctx.addParam(low)} AND ${ctx.addParam(high)}`
    },
  }
}

export function isNull(field: FieldRef<any> | RelationFieldRef<Schema, any, 'manyToOne'>): FilterExpr {
  return {
    __filterExpr: true,
    toOQL(ctx) {
      return `${resolveField(field, ctx)} IS NULL`
    },
  }
}

export function isNotNull(field: FieldRef<any> | RelationFieldRef<Schema, any, 'manyToOne'>): FilterExpr {
  return {
    __filterExpr: true,
    toOQL(ctx) {
      return `${resolveField(field, ctx)} IS NOT NULL`
    },
  }
}

// ══════════════════════════════════════════════════════════════════════
// EXISTS on a relation
// ══════════════════════════════════════════════════════════════════════

export function exists(
  relation: RelationFieldRef<Schema, any, any>,
  filter?: FilterExpr,
): FilterExpr {
  return {
    __filterExpr: true,
    toOQL(ctx) {
      if (filter) {
        return `EXISTS(${relation.fieldName} [${filter.toOQL(ctx)}])`
      }
      return `EXISTS(${relation.fieldName})`
    },
  }
}

// ══════════════════════════════════════════════════════════════════════
// Ordering
// ══════════════════════════════════════════════════════════════════════

export interface OrderExpr {
  readonly __orderExpr: true
  toOQL(): string
}

export function asc(field: FieldRef<any> | RelationFieldRef<Schema, any, 'manyToOne'>): OrderExpr {
  return {
    __orderExpr: true,
    toOQL() {
      return `${(field as FieldRef).fieldName} ASC`
    },
  }
}

export function desc(field: FieldRef<any> | RelationFieldRef<Schema, any, 'manyToOne'>): OrderExpr {
  return {
    __orderExpr: true,
    toOQL() {
      return `${(field as FieldRef).fieldName} DESC`
    },
  }
}
