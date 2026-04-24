import type { Schema, InferAllScalars } from './types.js'
import type { Column, Relation, Unwrap } from './schema.js'
import type { DB, OQLInstance } from './db.js'

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
// insert() — returns the inserted row with all scalars
// update() — returns the updated fields (partial)
// ══════════════════════════════════════════════════════════════════════

export function insert<S extends Schema, Name extends keyof S & string>(
  db: DB<S>,
  entityName: Name,
  data: InsertInput<S, Name>,
): Promise<InferAllScalars<Unwrap<S[Name]>>> {
  const oql = db.__oql as OQLInstance
  return oql.entity(entityName).insert<InferAllScalars<Unwrap<S[Name]>>>(data as Record<string, unknown>)
}

export function update<S extends Schema, Name extends keyof S & string>(
  db: DB<S>,
  entityName: Name,
  id: string | number,
  data: UpdateInput<S, Name>,
): Promise<Partial<InferAllScalars<Unwrap<S[Name]>>>> {
  const oql = db.__oql as OQLInstance
  return oql.entity(entityName).update(id, data as Record<string, unknown>)
}
