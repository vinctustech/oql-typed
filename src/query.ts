import type {
  Schema,
  InferProjection,
  InferDefaultProjection,
  ProjectionArg,
  OQLProjectionArg,
} from './types.js'
import { FilterContext, and, type FilterExpr, type FilterArg, type OrderExpr } from './operators.js'
import { getTableName, registerStarterFactory, type DB, type EntityHandle, type OQLInstance } from './db.js'

// ══════════════════════════════════════════════════════════════════════
// Build projection string from variadic args (supports nested, filtered, aliased)
// ══════════════════════════════════════════════════════════════════════

function isFilteredSpec(
  v: any,
): v is { fields: readonly any[]; where?: FilterExpr; orderBy?: readonly OrderExpr[] } {
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
          if (value.where) s += ` [${value.where.toOQL(ctx)}]`
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
// QueryBuilder — chainable, infers Result type from projection args
// ══════════════════════════════════════════════════════════════════════

class QueryBuilder<S extends Schema, Name extends keyof S, Result> {
  private readonly oql: OQLInstance
  private readonly schema: S
  private readonly entityName: Name
  private readonly projectionArgs: readonly any[] | undefined
  private filterExpr: FilterExpr | undefined
  private readonly orderExprs: OrderExpr[] = []
  private limitVal: number | undefined
  private offsetVal: number | undefined

  constructor(
    oql: OQLInstance,
    schema: S,
    entityName: Name,
    projectionArgs: readonly any[] | undefined,
  ) {
    this.oql = oql
    this.schema = schema
    this.entityName = entityName
    this.projectionArgs = projectionArgs
  }

  where(filter: FilterArg): this {
    // Use and() to normalize a bare FieldRef<boolean> or a full FilterExpr
    this.filterExpr = and(filter)
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
    // OQL query uses the entity name (which is what OQL knows); tableName is only relevant for DDL
    void getTableName
    let q = String(this.entityName)

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
// QueryStarter — what `query(db, 'user')` or `db.user.query()` returns
// ══════════════════════════════════════════════════════════════════════

export interface QueryStarter<S extends Schema, Name extends keyof S> {
  select<const Args extends readonly ProjectionArg<S, Name>[]>(
    ...args: Args
  ): QueryBuilder<S, Name, InferProjection<S, Name, Args>>

  where(filter: FilterArg): QueryBuilder<S, Name, InferDefaultProjection<S, Name>>
  orderBy(...orders: OrderExpr[]): QueryBuilder<S, Name, InferDefaultProjection<S, Name>>
  limit(n: number): QueryBuilder<S, Name, InferDefaultProjection<S, Name>>
  offset(n: number): QueryBuilder<S, Name, InferDefaultProjection<S, Name>>
  one(): Promise<InferDefaultProjection<S, Name> | undefined>
  many(): Promise<InferDefaultProjection<S, Name>[]>
  count(): Promise<number>
  toOQL(): { queryStr: string; params: Record<string, unknown> }
}

function createStarter<S extends Schema, Name extends keyof S>(
  oql: OQLInstance,
  schema: S,
  entityName: Name,
): QueryStarter<S, Name> {
  type Default = InferDefaultProjection<S, Name>

  return {
    select<const Args extends readonly ProjectionArg<S, Name>[]>(...args: Args) {
      return new QueryBuilder<S, Name, InferProjection<S, Name, Args>>(oql, schema, entityName, args)
    },
    where(filter) {
      return new QueryBuilder<S, Name, Default>(oql, schema, entityName, undefined).where(filter)
    },
    orderBy(...orders) {
      return new QueryBuilder<S, Name, Default>(oql, schema, entityName, undefined).orderBy(...orders)
    },
    limit(n) {
      return new QueryBuilder<S, Name, Default>(oql, schema, entityName, undefined).limit(n)
    },
    offset(n) {
      return new QueryBuilder<S, Name, Default>(oql, schema, entityName, undefined).offset(n)
    },
    one() {
      return new QueryBuilder<S, Name, Default>(oql, schema, entityName, undefined).one()
    },
    many() {
      return new QueryBuilder<S, Name, Default>(oql, schema, entityName, undefined).many()
    },
    count() {
      return new QueryBuilder<S, Name, Default>(oql, schema, entityName, undefined).count()
    },
    toOQL() {
      return new QueryBuilder<S, Name, Default>(oql, schema, entityName, undefined).toOQL()
    },
  }
}

// ══════════════════════════════════════════════════════════════════════
// Public entry points
// ══════════════════════════════════════════════════════════════════════

// query(db, 'user') — starts a query on the named entity
export function query<S extends Schema, Name extends keyof S & string>(
  db: DB<S>,
  entityName: Name,
): QueryStarter<S, Name>
// query(entityHandle) — shortcut via db.user
export function query<S extends Schema, Name extends keyof S>(
  handle: EntityHandle<S, Name>,
): QueryStarter<S, Name>
export function query(a: any, b?: any): any {
  if (b !== undefined) {
    return createStarter(a.__oql as OQLInstance, a.__schema as Schema, b)
  }
  // EntityHandle — retrieve oql and schema from its parent through __schema
  throw new Error('query(entityHandle) form requires db parameter; use query(db, "name") instead')
}

// Register the starter factory with db.ts so entity handles (db.user, db.zone, ...)
// can include starter methods (select/where/orderBy/one/many/count/toOQL) directly.
// This runs at module load and breaks the circular value-import between db and query.
registerStarterFactory((oql, schema, entityName) =>
  createStarter(oql, schema, entityName as keyof Schema) as unknown as Record<string, any>,
)
