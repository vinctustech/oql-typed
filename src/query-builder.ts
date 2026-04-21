import type { Schema, InferProjection, ProjectionArg } from './types.js'
import { FilterContext, and, type FilterExpr, type FilterArg, type OrderExpr } from './operators.js'
import type { DB, OQLInstance } from './db.js'

// Shared with query.ts but kept separate here to avoid circular imports.
function isFilteredSpec(
  v: any,
): v is { fields: readonly any[]; where?: FilterArg; orderBy?: readonly OrderExpr[] } {
  return v !== null && typeof v === 'object' && !Array.isArray(v) && 'fields' in v
}

function buildProjection(args: readonly any[], ctx: FilterContext): string {
  const parts: string[] = []
  for (const arg of args) {
    if (typeof arg === 'string') {
      parts.push(arg)
    } else if (typeof arg === 'object' && arg !== null && '__oqlExpr' in arg) {
      parts.push((arg as any).toOQL(ctx))
    } else if (typeof arg === 'object' && arg !== null) {
      for (const [key, value] of Object.entries(arg as Record<string, any>)) {
        if (isFilteredSpec(value)) {
          let s = `${key} {${buildProjection(value.fields, ctx)}}`
          if (value.where) s += ` [${and(value.where).toOQL(ctx)}]`
          if (value.orderBy && value.orderBy.length > 0) {
            s += ` <${value.orderBy.map((o: OrderExpr) => o.toOQL()).join(', ')}>`
          }
          parts.push(s)
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

// ══════════════════════════════════════════════════════════════════════
// CondQueryBuilder — conditional WHERE via .cond()
// ══════════════════════════════════════════════════════════════════════

class CondQueryBuilder<S extends Schema, Name extends keyof S, Result> {
  private readonly oql: OQLInstance
  private readonly entityName: Name
  private readonly projectionArgs: readonly any[]
  private readonly filters: FilterExpr[] = []
  private readonly orderExprs: OrderExpr[] = []
  private limitVal: number | undefined
  private offsetVal: number | undefined
  private skipNext = false

  constructor(oql: OQLInstance, entityName: Name, projectionArgs: readonly any[]) {
    this.oql = oql
    this.entityName = entityName
    this.projectionArgs = projectionArgs
  }

  cond(value: unknown): this
  cond(value: unknown, filter: FilterArg): this
  cond(value: unknown, filter?: FilterArg): this {
    if (filter !== undefined) {
      if (value) this.filters.push(and(filter))
    } else {
      this.skipNext = !value
    }
    return this
  }

  select(filter: FilterArg): this {
    if (!this.skipNext) this.filters.push(and(filter))
    this.skipNext = false
    return this
  }

  where(filter: FilterArg): this {
    this.filters.push(and(filter))
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
    let q = String(this.entityName)
    q += ` {${buildProjection(this.projectionArgs, ctx)}}`

    if (this.filters.length > 0) {
      q += ` [${this.filters.map((f) => f.toOQL(ctx)).join(' AND ')}]`
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

  toOQL(): { queryStr: string; params: Record<string, unknown> } {
    return this.build()
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
}

// ══════════════════════════════════════════════════════════════════════
// queryBuilder() — public entry, requires .select() first
// ══════════════════════════════════════════════════════════════════════

interface QueryBuilderStarter<S extends Schema, Name extends keyof S> {
  select<const Args extends readonly ProjectionArg<S, Name>[]>(
    ...args: Args
  ): CondQueryBuilder<S, Name, InferProjection<S, Name, Args>>
}

export function queryBuilder<S extends Schema, Name extends keyof S & string>(
  db: DB<S>,
  entityName: Name,
): QueryBuilderStarter<S, Name> {
  const oql = db.__oql as OQLInstance
  return {
    select<const Args extends readonly ProjectionArg<S, Name>[]>(...args: Args) {
      return new CondQueryBuilder<S, Name, InferProjection<S, Name, Args>>(oql, entityName, args)
    },
  }
}
