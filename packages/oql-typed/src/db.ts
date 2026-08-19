import type { Schema, FieldRefsFor } from './types.js'
import type { Unwrap, EntityMeta } from './schema.js'
import { Column, Relation } from './schema.js'
import type { QueryStarter } from './query.js'
import type { MutationMethods } from './mutations.js'
import { createMutationMethods } from './mutations.js'

// ══════════════════════════════════════════════════════════════════════
// OQL runtime interface — minimal shape we need from the backend
// ══════════════════════════════════════════════════════════════════════

export interface OQLInstance {
  queryOne<T = any>(query: string, params?: Record<string, unknown>): Promise<T | undefined>
  queryMany<T = any>(query: string, params?: Record<string, unknown>): Promise<T[]>
  count(query: string, params?: Record<string, unknown>): Promise<number>
  // AST entry points — accept a pre-built plain-object AST, bypassing the string parser
  queryOneAST<T = any>(ast: unknown): Promise<T | undefined>
  queryManyAST<T = any>(ast: unknown): Promise<T[]>
  countAST(ast: unknown): Promise<number>
  entity(name: string): {
    insert<T = any>(data: Record<string, unknown>): Promise<T>
    update<T = any>(id: unknown, data: Record<string, unknown>): Promise<T>
    delete(id: unknown): Promise<void>
    bulkDelete(ids: unknown[]): Promise<void>
  }
  // Optional because only the PostgreSQL backend implements transactions
  transaction?<T>(body: (tx: OQLInstance) => Promise<T>): Promise<T>
}

// Which engine the query terminals use. 'ast' (default) builds a plain-object
// AST and calls *AST; 'string' builds an OQL string and calls the string forms.
export type Engine = 'ast' | 'string'

// ══════════════════════════════════════════════════════════════════════
// DB type — db.user, db.account, etc.
// ══════════════════════════════════════════════════════════════════════

// EntityHandle is a field-ref accessor, a query starter, AND a mutation surface.
// `db.user.id`          → FieldRef<string>            (field-ref accessor)
// `db.user.select(...)` → QueryBuilder<...>           (query starter)
// `db.user.insert(...)` → Promise<row>                (mutation method)
// Column/relation names can't conflict with starter method names (select, where,
// orderBy, limit, offset, one, many, count, toOQL, query, queryBuilder) or with
// mutation method names (insert, update, delete, bulkDelete).
export type EntityHandle<S extends Schema, Name extends keyof S> = {
  readonly __entityName: Name
  readonly __schema: S
} & FieldRefsFor<S, Name> & QueryStarter<S, Name> & MutationMethods<S, Name>

// `transaction` runs a group of writes so that they all apply or none do; the
// body gets a DB bound to the transaction's connection. An entity named
// `transaction` takes precedence over the method, the same way entity fields
// take precedence over query-starter methods.
export type DB<S extends Schema> = {
  readonly __oql: OQLInstance
  readonly __schema: S
  readonly __engine: Engine
  transaction<T>(body: (tx: DB<S>) => Promise<T>): Promise<T>
} & {
  readonly [Name in keyof S]: EntityHandle<S, Name>
}

// ══════════════════════════════════════════════════════════════════════
// Runtime Proxy — lazily resolves db.user.account.id chains
// ══════════════════════════════════════════════════════════════════════

function getEntityDef(schema: Schema, entityName: string): Record<string, any> {
  const entry = schema[entityName] as EntityMeta | Record<string, any> | undefined
  if (!entry) throw new Error(`Entity '${entityName}' not found in schema`)
  if (typeof entry === 'object' && '__meta' in entry && entry.__meta === true) {
    return (entry as EntityMeta).definition as Record<string, any>
  }
  return entry as Record<string, any>
}

// `rootEntityName` is the entity the ref chain was started from (`db.<root>…`).
// It is preserved across relation hops so that `outer()` can emit a correlated
// path (`root.path.to.col`) — matching how OQL references the enclosing query
// (e.g. `trip.store.place.id`). `entityName` is the field's immediate owner and
// is NOT the root once a chain crosses a relation.
function createFieldRef(
  entityName: string,
  fieldName: string,
  builder: Column<any, any, any>,
  rootEntityName: string,
) {
  return {
    __fieldRef: true,
    entityName,
    fieldName,
    builder,
    rootEntityName,
  }
}

function createRelationRef(
  schema: Schema,
  entityName: string,
  fieldName: string,
  builder: Relation<any, any, any>,
  pathPrefix: string | undefined,
  rootEntityName: string,
): any {
  const fullPath = pathPrefix ? `${pathPrefix}.${fieldName}` : fieldName
  const base = {
    __relationRef: true,
    entityName,
    fieldName: fullPath,
    builder,
    rootEntityName,
  }

  // For manyToOne, wrap in a Proxy that lazily resolves target entity fields
  if (builder.relationKind === 'manyToOne') {
    return new Proxy(base, {
      get(target, prop, receiver) {
        if (prop in target) return Reflect.get(target, prop, receiver)
        if (typeof prop !== 'string') return undefined

        // Look up target entity definition
        const targetName = builder.target
        const targetDef = getEntityDef(schema, targetName)
        const targetField = targetDef[prop]
        if (!targetField) return undefined

        // Thread the original root through every hop — see note above.
        if (targetField instanceof Column) {
          return createFieldRef(targetName, `${fullPath}.${prop}`, targetField, rootEntityName)
        }
        if (targetField instanceof Relation) {
          return createRelationRef(schema, targetName, prop, targetField, fullPath, rootEntityName)
        }
        return undefined
      },
    })
  }

  return base
}

function createEntityHandle(oql: OQLInstance, schema: Schema, entityName: string, engine: Engine): any {
  const def = getEntityDef(schema, entityName)
  const handle: Record<string, any> = {
    __entityName: entityName,
    __schema: schema,
  }
  for (const [fieldName, builder] of Object.entries(def)) {
    if (builder instanceof Column) {
      handle[fieldName] = createFieldRef(entityName, fieldName, builder, entityName)
    } else if (builder instanceof Relation) {
      handle[fieldName] = createRelationRef(schema, entityName, fieldName, builder, undefined, entityName)
    }
  }
  // Mix in query-starter methods so `db.user.select(...).where(...)` works.
  // Starter factory is injected via registerStarterFactory() to avoid a hard
  // circular import between db.ts and query.ts.
  const starter = starterFactory(oql, schema, entityName, engine)
  for (const key of Object.keys(starter)) {
    if (!(key in handle)) handle[key] = starter[key]
  }
  // Mix in mutation methods so `db.user.insert(...)`, `db.user.delete(...)` work.
  const mutations = createMutationMethods(oql, entityName)
  for (const key of Object.keys(mutations)) {
    if (!(key in handle)) handle[key] = mutations[key]
  }
  return handle
}

// Injected by query.ts on module load to avoid circular import.
type StarterFactory = (oql: OQLInstance, schema: Schema, entityName: string, engine: Engine) => Record<string, any>
let starterFactory: StarterFactory = () => {
  throw new Error(
    'oql-typed: starter factory not registered. Import from the package root (@vinctus/oql-typed) to ensure all modules load.',
  )
}

export function registerStarterFactory(fn: StarterFactory): void {
  starterFactory = fn
}

// ══════════════════════════════════════════════════════════════════════
// typedOQL — the factory
// ══════════════════════════════════════════════════════════════════════

export function typedOQL<S extends Schema>(
  oql: OQLInstance,
  schema: S,
  opts?: { engine?: Engine },
): DB<S> {
  const engine: Engine = opts?.engine ?? 'ast'
  const db: Record<string, any> = {
    __oql: oql,
    __schema: schema,
    __engine: engine,
    transaction: <T>(body: (tx: DB<S>) => Promise<T>): Promise<T> => {
      if (!oql.transaction)
        throw new Error('oql-typed: this OQL backend does not support transactions')
      return oql.transaction((tx) => body(typedOQL(tx, schema, opts)))
    },
  }
  for (const entityName of Object.keys(schema)) {
    db[entityName] = createEntityHandle(oql, schema, entityName, engine)
  }
  return db as DB<S>
}

// ══════════════════════════════════════════════════════════════════════
// Table name lookup — needed by query builder for OQL generation
// ══════════════════════════════════════════════════════════════════════

export function getTableName(schema: Schema, entityName: string): string {
  const entry = schema[entityName] as EntityMeta | Record<string, any> | undefined
  if (entry && typeof entry === 'object' && '__meta' in entry && entry.__meta === true) {
    return (entry as EntityMeta).tableName ?? entityName
  }
  return entityName
}

// Return the primary key's field name for an entity (used by filter operators)
export function getPrimaryKey(schema: Schema, entityName: string): string | undefined {
  const def = getEntityDef(schema, entityName)
  for (const [fieldName, builder] of Object.entries(def)) {
    if (builder instanceof Column && builder.isPrimaryKey) return fieldName
  }
  return undefined
}
