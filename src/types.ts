import type { ColumnBuilder, EntityDefinition, RelationBuilder } from './schema.js'
import type { FilterExpr, OrderExpr } from './operators.js'

// ── Utility types ──

export type Prettify<T> = { [K in keyof T]: T[K] } & {}

type UnionToIntersection<U> = (U extends any ? (k: U) => void : never) extends (k: infer I) => void
  ? I
  : never

// ── Extract scalar vs relation fields from an entity definition ──

export type ScalarKeys<D extends EntityDefinition> = {
  [K in keyof D]: D[K] extends ColumnBuilder<any, any, any> ? K : never
}[keyof D]

export type RelationKeys<D extends EntityDefinition> = {
  [K in keyof D]: D[K] extends RelationBuilder<any, any, any> ? K : never
}[keyof D]

// ── Infer the TS type of a single column ──

export type InferColumnType<C> = C extends ColumnBuilder<infer T, any, any> ? T : never

// ── Infer all scalar fields as a plain object ──

export type InferAllScalars<D extends EntityDefinition> = Prettify<{
  [K in ScalarKeys<D>]: InferColumnType<D[K]>
}>

// ── Projection argument types ──

// A projection arg is either a scalar field name (string) or a relation spec (object)
export type ProjectionArg<D extends EntityDefinition> =
  | ScalarKeys<D>
  | RelationSpec<D>

// A relation spec maps relation field names to arrays of projection args for the target entity
type RelationSpec<D extends EntityDefinition> = {
  [K in RelationKeys<D>]?: D[K] extends RelationBuilder<infer Target, any, any>
    ? readonly ProjectionArg<Target>[]
    : never
}

// ── Infer the result type from projection args ──

// Extracts string elements (scalar keys) from a projection args tuple
type ExtractScalarArgs<D extends EntityDefinition, Args extends readonly ProjectionArg<D>[]> = Extract<
  Args[number],
  ScalarKeys<D>
>

// Extracts object elements (relation specs) from a projection args tuple
type ExtractRelationArgs<D extends EntityDefinition, Args extends readonly ProjectionArg<D>[]> = Extract<
  Args[number],
  Record<string, any>
>

// Resolves a single relation field's projected type
type InferRelationType<
  R,
  Proj extends readonly any[],
> = R extends RelationBuilder<infer Target, infer Kind, infer Nullable>
  ? Kind extends 'oneToMany' | 'manyToMany'
    ? InferProjection<Target, Proj>[]
    : Nullable extends true
      ? InferProjection<Target, Proj> | null
      : InferProjection<Target, Proj>
  : never

// Resolves all relation specs from the projection into typed fields
type InferRelationSpecs<D extends EntityDefinition, Specs> = UnionToIntersection<
  Specs extends infer S extends Record<string, any>
    ? {
        [K in keyof S & keyof D]: InferRelationType<D[K], S[K] & readonly any[]>
      }
    : never
>

// Main projection inference: combines scalars + relations
export type InferProjection<
  D extends EntityDefinition,
  Args extends readonly ProjectionArg<D>[],
> = Prettify<
  Pick<InferAllScalars<D>, ExtractScalarArgs<D, Args> & ScalarKeys<D>> &
    InferRelationSpecs<D, ExtractRelationArgs<D, Args>>
>

// When no projection is given, return all scalar fields
export type InferDefaultProjection<D extends EntityDefinition> = InferAllScalars<D>
