import type { EntityDefinition, EntityInstance } from './schema.js'
import type { InferAllScalars, InferProjection, ProjectionArg } from './types.js'
import { FilterContext, type FilterExpr, type OrderExpr } from './operators.js'
import type { OQLInstance } from './query.js'

// ── Build the selection string from variadic args ──
// (re-exported from query.ts logic, duplicated here to avoid circular deps)

function isFilteredSpec(value: any): value is { fields: readonly any[]; where?: FilterExpr; orderBy?: readonly OrderExpr[] } {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && 'fields' in value
}

function buildProjection<D extends EntityDefinition>(args: readonly ProjectionArg<D>[], ctx: FilterContext): string {
  const parts: string[] = []

  for (const arg of args) {
    if (typeof arg === 'string') {
      parts.push(arg as string)
    } else if (typeof arg === 'object' && arg !== null && '__oqlExpr' in arg) {
      parts.push((arg as any).toOQL(ctx))
    } else if (typeof arg === 'object' && arg !== null) {
      for (const [key, value] of Object.entries(arg as Record<string, any>)) {
        if (isFilteredSpec(value)) {
          let projection = `${key} {${buildProjection(value.fields, ctx)}}`
          if (value.where) {
            projection += ` [${value.where.toOQL(ctx)}]`
          }
          if (value.orderBy && value.orderBy.length > 0) {
            projection += ` <${value.orderBy.map((o: OrderExpr) => o.toOQL()).join(', ')}>`
          }
          parts.push(projection)
        } else if (Array.isArray(value) && value.length > 0) {
          parts.push(`${key} {${buildProjection(value, ctx)}}`)
        } else {
          parts.push(key)
        }
      }
    }
  }

  return parts.join(' ')
}

// ── Conditional QueryBuilder ──

class CondQueryBuilder<D extends EntityDefinition, Result> {
  private readonly oql: OQLInstance
  private readonly entityName: string
  private readonly projectionArgs: readonly ProjectionArg<D>[] | undefined
  private readonly filters: FilterExpr[] = []
  private readonly orderExprs: OrderExpr[] = []
  private limitVal: number | undefined
  private offsetVal: number | undefined
  private skipNext = false

  constructor(
    oql: OQLInstance,
    entity: EntityInstance<D>,
    projectionArgs: readonly ProjectionArg<D>[] | undefined,
  ) {
    this.oql = oql
    this.entityName = entity.entityName
    this.projectionArgs = projectionArgs
  }

  cond(value: unknown): this
  cond(value: unknown, filter: FilterExpr): this
  cond(value: unknown, filter?: FilterExpr): this {
    if (filter !== undefined) {
      // Two-arg form: cond(value, filter) — add filter if value is truthy
      if (value) {
        this.filters.push(filter)
      }
    } else {
      // One-arg form: cond(value) — next .select() is skipped if falsy
      this.skipNext = !value
    }
    return this
  }

  select(filter: FilterExpr): this {
    if (!this.skipNext) {
      this.filters.push(filter)
    }
    this.skipNext = false
    return this
  }

  where(filter: FilterExpr): this {
    this.filters.push(filter)
    return this
  }

  orderBy(...orders: OrderExpr[]): this {
    this.orderExprs.push(...orders)
    return this
  }

  limit(n: number): this {
    this.limitVal = n
    return this
  }

  offset(n: number): this {
    this.offsetVal = n
    return this
  }

  private build(): { queryStr: string; params: Record<string, unknown> } {
    const ctx = new FilterContext()
    let q = this.entityName

    if (this.projectionArgs) {
      q += ` {${buildProjection(this.projectionArgs, ctx)}}`
    }

    if (this.filters.length > 0) {
      const combined = this.filters.map((f) => f.toOQL(ctx)).join(' AND ')
      q += ` [${combined}]`
    }

    if (this.orderExprs.length > 0) {
      q += ` <${this.orderExprs.map((o) => o.toOQL()).join(', ')}>`
    }

    if (this.offsetVal !== undefined || this.limitVal !== undefined) {
      const limit = this.limitVal ?? ''
      const offset = this.offsetVal ?? ''
      q += ` |${limit}${offset !== '' ? `, ${offset}` : ''}|`
    }

    return { queryStr: q, params: ctx.getParams() }
  }

  async one(): Promise<Result | undefined> {
    const { queryStr, params } = this.build()
    return this.oql.queryOne<Result>(queryStr, params)
  }

  async many(): Promise<Result[]> {
    const { queryStr, params } = this.build()
    return this.oql.queryMany<Result>(queryStr, params)
  }

  async count(): Promise<number> {
    const { queryStr, params } = this.build()
    return this.oql.count(queryStr, params)
  }

  toOQL(): { queryStr: string; params: Record<string, unknown> } {
    return this.build()
  }
}

// ── Public queryBuilder function ──

interface QueryBuilderStarter<D extends EntityDefinition> {
  select<const Args extends readonly ProjectionArg<D>[]>(
    ...args: Args
  ): CondQueryBuilder<D, InferProjection<D, Args>>
}

export function queryBuilder<D extends EntityDefinition>(
  oql: OQLInstance,
  entity: EntityInstance<D>,
): QueryBuilderStarter<D> {
  return {
    select<const Args extends readonly ProjectionArg<D>[]>(...args: Args) {
      return new CondQueryBuilder<D, InferProjection<D, Args>>(oql, entity, args)
    },
  }
}
