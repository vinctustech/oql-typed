import type { EntityDefinition, EntityInstance, FieldRef, RelationFieldRef } from './schema.js'
import { RelationBuilder } from './schema.js'

// ── Resolve field name — for manyToOne relations, use dotted FK path ──

function resolveFieldName(field: FieldRef<any>): string {
  if (field.builder instanceof RelationBuilder && field.builder.relationKind === 'manyToOne') {
    // OQL requires dotted path for FK comparisons: vehicle.id, not vehicle
    const target = field.builder.target()
    // Find the PK field name on the target entity
    for (const [key, b] of Object.entries(target.definition) as [string, any][]) {
      if (b.kind === 'column' && b.isPrimaryKey) {
        return `${field.fieldName}.${key}`
      }
    }
  }
  return field.fieldName
}

// ── Filter context — tracks parameters during OQL string generation ──

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

// ── Filter expression interface ──

export interface FilterExpr {
  readonly __filterExpr: true
  toOQL(ctx: FilterContext): string
}

// ── Comparison operators ──

function comparisonOp<T>(field: FieldRef<T>, op: string, value: T): FilterExpr {
  return {
    __filterExpr: true,
    toOQL(ctx) {
      return `${resolveFieldName(field)} ${op} ${ctx.addParam(value)}`
    },
  }
}

export function eq<T>(field: FieldRef<T>, value: T): FilterExpr {
  return comparisonOp(field, '=', value)
}

export function ne<T>(field: FieldRef<T>, value: T): FilterExpr {
  return comparisonOp(field, '!=', value)
}

export function gt<T>(field: FieldRef<T>, value: T): FilterExpr {
  return comparisonOp(field, '>', value)
}

export function gte<T>(field: FieldRef<T>, value: T): FilterExpr {
  return comparisonOp(field, '>=', value)
}

export function lt<T>(field: FieldRef<T>, value: T): FilterExpr {
  return comparisonOp(field, '<', value)
}

export function lte<T>(field: FieldRef<T>, value: T): FilterExpr {
  return comparisonOp(field, '<=', value)
}

// ── Logical operators ──

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

// ── List operators ──

export function inList<T>(field: FieldRef<T>, values: T[]): FilterExpr {
  return {
    __filterExpr: true,
    toOQL(ctx) {
      return `${resolveFieldName(field)} IN ${ctx.addParam(values)}`
    },
  }
}

export function notInList<T>(field: FieldRef<T>, values: T[]): FilterExpr {
  return {
    __filterExpr: true,
    toOQL(ctx) {
      return `${resolveFieldName(field)} NOT IN ${ctx.addParam(values)}`
    },
  }
}

// ── String operators ──

export function like(field: FieldRef<string>, pattern: string): FilterExpr {
  return {
    __filterExpr: true,
    toOQL(ctx) {
      return `${resolveFieldName(field)} LIKE ${ctx.addParam(pattern)}`
    },
  }
}

export function ilike(field: FieldRef<string>, pattern: string): FilterExpr {
  return {
    __filterExpr: true,
    toOQL(ctx) {
      return `${resolveFieldName(field)} ILIKE ${ctx.addParam(pattern)}`
    },
  }
}

// ── Range operators ──

export function between<T>(field: FieldRef<T>, low: T, high: T): FilterExpr {
  return {
    __filterExpr: true,
    toOQL(ctx) {
      return `${resolveFieldName(field)} BETWEEN ${ctx.addParam(low)} AND ${ctx.addParam(high)}`
    },
  }
}

// ── Null checks ──

export function isNull(field: FieldRef<unknown>): FilterExpr {
  return {
    __filterExpr: true,
    toOQL(ctx) {
      void ctx
      return `${resolveFieldName(field)} IS NULL`
    },
  }
}

export function isNotNull(field: FieldRef<unknown>): FilterExpr {
  return {
    __filterExpr: true,
    toOQL(ctx) {
      void ctx
      return `${resolveFieldName(field)} IS NOT NULL`
    },
  }
}

// ── EXISTS subquery ──

export function exists<D extends EntityDefinition>(
  relation: RelationFieldRef<D>,
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

// ── Ordering ──

export interface OrderExpr {
  readonly __orderExpr: true
  toOQL(): string
}

export function asc(field: FieldRef<unknown>): OrderExpr {
  return {
    __orderExpr: true,
    toOQL() {
      return `${field.fieldName} ASC`
    },
  }
}

export function desc(field: FieldRef<unknown>): OrderExpr {
  return {
    __orderExpr: true,
    toOQL() {
      return `${field.fieldName} DESC`
    },
  }
}
