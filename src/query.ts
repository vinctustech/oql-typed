import type { EntityDefinition, EntityInstance } from './schema.js'
import type { InferAllScalars, InferProjection, ProjectionArg } from './types.js'
import { FilterContext, type FilterExpr, type OrderExpr } from './operators.js'

// ── OQL interface — what we need from @vinctus/oql ──

export interface OQLInstance {
  queryOne<T = any>(query: string, params?: Record<string, unknown>): Promise<T | undefined>
  queryMany<T = any>(query: string, params?: Record<string, unknown>): Promise<T[]>
  count(query: string, params?: Record<string, unknown>): Promise<number>
}

// ── Build the selection string from variadic args ──

function isFilteredSpec(value: any): value is { fields: readonly any[]; where?: FilterExpr; orderBy?: readonly OrderExpr[] } {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && 'fields' in value
}

function buildProjection<D extends EntityDefinition>(args: readonly ProjectionArg<D>[], ctx: FilterContext): string {
  const parts: string[] = []

  for (const arg of args) {
    if (typeof arg === 'string') {
      parts.push(arg as string)
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

// ── Query builder ──

class QueryBuilder<D extends EntityDefinition, Result> {
  private readonly oql: OQLInstance
  private readonly entityName: string
  private readonly projectionArgs: readonly ProjectionArg<D>[] | undefined
  private filterExpr: FilterExpr | undefined
  private orderExprs: OrderExpr[] = []
  private limitVal: number | undefined
  private offsetVal: number | undefined

  constructor(
    oql: OQLInstance,
    entity: EntityInstance<D>,
    projectionArgs: readonly ProjectionArg<D>[] | undefined,
  ) {
    this.oql = oql
    this.entityName = entity.entityName
    this.projectionArgs = projectionArgs
  }

  where(filter: FilterExpr): this {
    this.filterExpr = filter
    return this
  }

  orderBy(...orders: OrderExpr[]): this {
    this.orderExprs = orders
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

    if (this.filterExpr) {
      q += ` [${this.filterExpr.toOQL(ctx)}]`
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

// ── Public query function ──

interface QueryStarter<D extends EntityDefinition> {
  select<const Args extends readonly ProjectionArg<D>[]>(
    ...args: Args
  ): QueryBuilder<D, InferProjection<D, Args>>

  where(filter: FilterExpr): QueryBuilder<D, InferAllScalars<D>>
  orderBy(...orders: OrderExpr[]): QueryBuilder<D, InferAllScalars<D>>
  limit(n: number): QueryBuilder<D, InferAllScalars<D>>
  offset(n: number): QueryBuilder<D, InferAllScalars<D>>
  one(): Promise<InferAllScalars<D> | undefined>
  many(): Promise<InferAllScalars<D>[]>
  count(): Promise<number>
}

export function query<D extends EntityDefinition>(
  oql: OQLInstance,
  entity: EntityInstance<D>,
): QueryStarter<D> {
  return {
    select<const Args extends readonly ProjectionArg<D>[]>(...args: Args) {
      return new QueryBuilder<D, InferProjection<D, Args>>(oql, entity, args)
    },

    where(filter: FilterExpr) {
      return new QueryBuilder<D, InferAllScalars<D>>(oql, entity, undefined).where(filter)
    },

    orderBy(...orders: OrderExpr[]) {
      return new QueryBuilder<D, InferAllScalars<D>>(oql, entity, undefined).orderBy(...orders)
    },

    limit(n: number) {
      return new QueryBuilder<D, InferAllScalars<D>>(oql, entity, undefined).limit(n)
    },

    offset(n: number) {
      return new QueryBuilder<D, InferAllScalars<D>>(oql, entity, undefined).offset(n)
    },

    async one() {
      return new QueryBuilder<D, InferAllScalars<D>>(oql, entity, undefined).one()
    },

    async many() {
      return new QueryBuilder<D, InferAllScalars<D>>(oql, entity, undefined).many()
    },

    async count() {
      return new QueryBuilder<D, InferAllScalars<D>>(oql, entity, undefined).count()
    },
  }
}
