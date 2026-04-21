import type { Schema, FieldRefsFor } from './types.js'
import type { Unwrap, EntityMeta } from './schema.js'
import { Column, Relation } from './schema.js'

// ══════════════════════════════════════════════════════════════════════
// OQL runtime interface — minimal shape we need from the backend
// ══════════════════════════════════════════════════════════════════════

export interface OQLInstance {
  queryOne<T = any>(query: string, params?: Record<string, unknown>): Promise<T | undefined>
  queryMany<T = any>(query: string, params?: Record<string, unknown>): Promise<T[]>
  count(query: string, params?: Record<string, unknown>): Promise<number>
  entity(name: string): {
    insert<T = any>(data: Record<string, unknown>): Promise<T>
    update<T = any>(id: unknown, data: Record<string, unknown>): Promise<T>
  }
}

// ══════════════════════════════════════════════════════════════════════
// DB type — db.user, db.account, etc.
// ══════════════════════════════════════════════════════════════════════

export type EntityHandle<S extends Schema, Name extends keyof S> = {
  readonly __entityName: Name
  readonly __schema: S
} & FieldRefsFor<S, Name>

export type DB<S extends Schema> = {
  readonly __oql: OQLInstance
  readonly __schema: S
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

function createFieldRef(entityName: string, fieldName: string, builder: Column<any, any, any>) {
  return {
    __fieldRef: true,
    entityName,
    fieldName,
    builder,
  }
}

function createRelationRef(
  schema: Schema,
  entityName: string,
  fieldName: string,
  builder: Relation<any, any, any>,
  pathPrefix?: string,
): any {
  const fullPath = pathPrefix ? `${pathPrefix}.${fieldName}` : fieldName
  const base = {
    __relationRef: true,
    entityName,
    fieldName: fullPath,
    builder,
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

        if (targetField instanceof Column) {
          return createFieldRef(targetName, `${fullPath}.${prop}`, targetField)
        }
        if (targetField instanceof Relation) {
          return createRelationRef(schema, targetName, prop, targetField, fullPath)
        }
        return undefined
      },
    })
  }

  return base
}

function createEntityHandle(schema: Schema, entityName: string): any {
  const def = getEntityDef(schema, entityName)
  const handle: Record<string, any> = {
    __entityName: entityName,
    __schema: schema,
  }
  for (const [fieldName, builder] of Object.entries(def)) {
    if (builder instanceof Column) {
      handle[fieldName] = createFieldRef(entityName, fieldName, builder)
    } else if (builder instanceof Relation) {
      handle[fieldName] = createRelationRef(schema, entityName, fieldName, builder)
    }
  }
  return handle
}

// ══════════════════════════════════════════════════════════════════════
// typedOQL — the factory
// ══════════════════════════════════════════════════════════════════════

export function typedOQL<S extends Schema>(oql: OQLInstance, schema: S): DB<S> {
  const db: Record<string, any> = {
    __oql: oql,
    __schema: schema,
  }
  for (const entityName of Object.keys(schema)) {
    db[entityName] = createEntityHandle(schema, entityName)
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
