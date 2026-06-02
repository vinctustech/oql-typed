import type { Schema, InferProjection, ProjectionArg, FieldRef, RelationFieldRef } from './types.js'
import { FilterContext, and, eq, inList, type FilterExpr, type FilterArg, type OrderExpr } from './operators.js'
import type { DB, OQLInstance, Engine } from './db.js'
import { buildProjectionAST, foldInfix } from './ast.js'

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
  private readonly engine: Engine

  constructor(oql: OQLInstance, entityName: Name, projectionArgs: readonly any[], engine: Engine) {
    this.oql = oql
    this.entityName = entityName
    this.projectionArgs = projectionArgs
    this.engine = engine
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

  findBy<T>(field: FieldRef<T>, value: NoInfer<T>): this
  findBy(field: RelationFieldRef<Schema, any, 'manyToOne'>, value: string | number): this
  findBy(field: any, value: any): this {
    this.filters.push(eq(field, value))
    return this
  }

  findIn<T>(field: FieldRef<T>, values: NoInfer<T>[]): this
  findIn(field: RelationFieldRef<Schema, any, 'manyToOne'>, values: Array<string | number>): this
  findIn(field: any, values: any[]): this {
    this.filters.push(inList(field, values))
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

  private build(opts?: { paginate?: boolean }): { queryStr: string; params: Record<string, unknown> } {
    const paginate = opts?.paginate !== false
    const ctx = new FilterContext()
    let q = String(this.entityName)
    q += ` {${buildProjection(this.projectionArgs, ctx)}}`

    if (this.filters.length > 0) {
      q += ` [${this.filters.map((f) => f.toOQL(ctx)).join(' AND ')}]`
    }
    if (this.orderExprs.length > 0) {
      q += ` <${this.orderExprs.map((o) => o.toOQL()).join(', ')}>`
    }
    if (paginate && (this.offsetVal !== undefined || this.limitVal !== undefined)) {
      const limit = this.limitVal ?? ''
      const offset = this.offsetVal ?? ''
      q += ` |${limit}${offset !== '' ? `, ${offset}` : ''}|`
    }
    return { queryStr: q, params: ctx.getParams() }
  }

  toOQL(opts?: { paginate?: boolean }): { queryStr: string; params: Record<string, unknown> } {
    return this.build(opts)
  }

  private buildAST(opts?: { paginate?: boolean }): Record<string, unknown> {
    const paginate = opts?.paginate !== false
    const node: Record<string, unknown> = {
      kind: 'query',
      source: String(this.entityName),
      project: buildProjectionAST(this.projectionArgs),
    }
    if (this.filters.length > 0) node.select = foldInfix('AND', this.filters.map((f) => f.toAST()))
    if (this.orderExprs.length > 0) node.order = this.orderExprs.map((o) => o.toAST())
    if (paginate && this.limitVal !== undefined) node.limit = this.limitVal
    if (paginate && this.offsetVal !== undefined) node.offset = this.offsetVal
    return node
  }

  toAST(opts?: { paginate?: boolean }): Record<string, unknown> {
    return this.buildAST(opts)
  }

  async one(): Promise<Result | undefined> {
    if (this.engine === 'ast') return this.oql.queryOneAST<Result>(this.buildAST())
    const { queryStr, params } = this.build()
    return this.oql.queryOne<Result>(queryStr, params)
  }

  async many(): Promise<Result[]> {
    if (this.engine === 'ast') return this.oql.queryManyAST<Result>(this.buildAST())
    const { queryStr, params } = this.build()
    return this.oql.queryMany<Result>(queryStr, params)
  }

  async count(): Promise<number> {
    if (this.engine === 'ast') return this.oql.countAST(this.buildAST({ paginate: false }))
    const { queryStr, params } = this.build({ paginate: false })
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
  const engine = db.__engine as Engine
  return {
    select<const Args extends readonly ProjectionArg<S, Name>[]>(...args: Args) {
      return new CondQueryBuilder<S, Name, InferProjection<S, Name, Args>>(oql, entityName, args, engine)
    },
  }
}
