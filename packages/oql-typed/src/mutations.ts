import type { Schema, InferAllScalars } from './types.js'
import type { Column, Relation, Unwrap } from './schema.js'
import type { OQLInstance } from './db.js'

// ══════════════════════════════════════════════════════════════════════
// Input types — required non-PK scalars + manyToOne FKs
// ══════════════════════════════════════════════════════════════════════

type InsertableScalarKeys<D> = {
  [K in keyof D]: D[K] extends Column<any, any, infer PK> ? (PK extends true ? never : K) : never
}[keyof D]

type PKKeys<D> = {
  [K in keyof D]: D[K] extends Column<any, any, infer PK> ? (PK extends true ? K : never) : never
}[keyof D]

type ManyToOneKeys<D> = {
  [K in keyof D]: D[K] extends Relation<any, infer Kind, any>
    ? Kind extends 'manyToOne' ? K : never
    : never
}[keyof D]

type RequiredScalarKeys<D> = {
  [K in InsertableScalarKeys<D>]: D[K] extends Column<any, infer N, any>
    ? N extends true ? never : K
    : never
}[InsertableScalarKeys<D>]

type OptionalScalarKeys<D> = {
  [K in InsertableScalarKeys<D>]: D[K] extends Column<any, infer N, any>
    ? N extends true ? K : never
    : never
}[InsertableScalarKeys<D>]

type RequiredFKKeys<D> = {
  [K in ManyToOneKeys<D>]: D[K] extends Relation<any, any, infer N>
    ? N extends true ? never : K
    : never
}[ManyToOneKeys<D>]

type OptionalFKKeys<D> = {
  [K in ManyToOneKeys<D>]: D[K] extends Relation<any, any, infer N>
    ? N extends true ? K : never
    : never
}[ManyToOneKeys<D>]

type ScalarValue<C> = C extends Column<infer T, any, any> ? T : never

export type InsertInput<S extends Schema, Name extends keyof S> = {
  [K in RequiredScalarKeys<Unwrap<S[Name]>>]: ScalarValue<Unwrap<S[Name]>[K]>
} & {
  [K in OptionalScalarKeys<Unwrap<S[Name]>>]?: ScalarValue<Unwrap<S[Name]>[K]> | null
} & {
  [K in RequiredFKKeys<Unwrap<S[Name]>>]: string
} & {
  [K in OptionalFKKeys<Unwrap<S[Name]>>]?: string | null
} & {
  // Primary key is optional — OQL auto-generates if omitted, caller can pass explicit
  [K in PKKeys<Unwrap<S[Name]>>]?: ScalarValue<Unwrap<S[Name]>[K]>
}

export type UpdateInput<S extends Schema, Name extends keyof S> = {
  [K in InsertableScalarKeys<Unwrap<S[Name]>>]?: ScalarValue<Unwrap<S[Name]>[K]> | null
} & {
  [K in ManyToOneKeys<Unwrap<S[Name]>>]?: string | null
}

// ══════════════════════════════════════════════════════════════════════
// Mutation methods, mixed onto every entity handle (db.user, db.trip, …):
//   db.user.insert(data)      — returns the inserted row with all scalars
//   db.user.update(id, patch) — returns the primary key + patched fields
//   db.user.delete(id)        — removes one row by primary key
//   db.user.bulkDelete(ids)   — removes many rows by primary key
// ══════════════════════════════════════════════════════════════════════

export interface MutationMethods<S extends Schema, Name extends keyof S> {
  insert(data: InsertInput<S, Name>): Promise<InferAllScalars<Unwrap<S[Name]>>>
  update(id: string | number, data: UpdateInput<S, Name>): Promise<Partial<InferAllScalars<Unwrap<S[Name]>>>>
  delete(id: string | number): Promise<void>
  bulkDelete(ids: (string | number)[]): Promise<void>
}

// Runtime factory — untyped bodies; the types come from MutationMethods on the
// entity handle. Each call resolves the backend entity fresh, mirroring how the
// mutations were dispatched before they moved onto the handle.
export function createMutationMethods(oql: OQLInstance, entityName: string): Record<string, unknown> {
  return {
    insert: (data: Record<string, unknown>) => oql.entity(entityName).insert(data),
    update: (id: unknown, data: Record<string, unknown>) => oql.entity(entityName).update(id, data),
    delete: (id: unknown) => oql.entity(entityName).delete(id),
    bulkDelete: (ids: unknown[]) => oql.entity(entityName).bulkDelete(ids),
  }
}
