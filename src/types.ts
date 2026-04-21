import type { Column, Relation, RelationKind, SchemaEntry, Unwrap } from './schema.js'

// ══════════════════════════════════════════════════════════════════════
// Utility types
// ══════════════════════════════════════════════════════════════════════

export type Prettify<T> = { [K in keyof T]: T[K] } & {}

type UnionToIntersection<U> = (U extends any ? (k: U) => void : never) extends (k: infer I) => void
  ? I
  : never

// ══════════════════════════════════════════════════════════════════════
// Schema type — what consumers pass to typedOQL()
// ══════════════════════════════════════════════════════════════════════

export type Schema = Record<string, SchemaEntry>

// ══════════════════════════════════════════════════════════════════════
// Field refs — what you get from db.user.id
// ══════════════════════════════════════════════════════════════════════

export interface FieldRef<T = unknown> {
  readonly __fieldRef: true
  readonly _type: T
  readonly entityName: string
  readonly fieldName: string
  readonly builder: Column<any, any, any>
}

export interface RelationFieldRef<S extends Schema = Schema, Target extends keyof S = keyof S, Kind extends RelationKind = RelationKind> {
  readonly __relationRef: true
  readonly _schema: S
  readonly _target: Target
  readonly _kind: Kind
  readonly entityName: string
  readonly fieldName: string
  readonly builder: Relation<any, any, any>
}

// manyToOne also exposes target entity's fields (dotted path) via intersection
export type ManyToOneFieldRef<S extends Schema, Target extends keyof S> =
  RelationFieldRef<S, Target, 'manyToOne'> & FieldRefsFor<S, Target>

// ══════════════════════════════════════════════════════════════════════
// Extract scalar / relation fields from an entity's definition
// ══════════════════════════════════════════════════════════════════════

export type ScalarKeys<D> = {
  [K in keyof D]: D[K] extends Column<any, any, any> ? K : never
}[keyof D]

export type RelationKeys<D> = {
  [K in keyof D]: D[K] extends Relation<any, any, any> ? K : never
}[keyof D]

export type NonPKScalarKeys<D> = {
  [K in keyof D]: D[K] extends Column<any, any, infer PK> ? (PK extends true ? never : K) : never
}[keyof D]

// ══════════════════════════════════════════════════════════════════════
// FieldRefsFor — what you get when you access an entity handle
// ══════════════════════════════════════════════════════════════════════

export type FieldRefsFor<S extends Schema, Name extends keyof S> = {
  readonly [K in keyof Unwrap<S[Name]>]: Unwrap<S[Name]>[K] extends Column<infer T, infer N, any>
    ? FieldRef<N extends true ? T | null : T>
    : Unwrap<S[Name]>[K] extends Relation<infer Target, infer Kind, any>
      ? Target extends keyof S
        ? Kind extends 'manyToOne'
          ? ManyToOneFieldRef<S, Target>
          : RelationFieldRef<S, Target, Kind>
        : never
      : never
}

// ══════════════════════════════════════════════════════════════════════
// Column type inference
// ══════════════════════════════════════════════════════════════════════

export type InferColumnType<C> = C extends Column<infer T, any, any> ? T : never

// All scalar fields of an entity, respecting nullability
export type InferAllScalars<D> = Prettify<{
  [K in ScalarKeys<D>]: D[K] extends Column<infer T, infer N, any>
    ? N extends true ? T | null : T
    : never
}>

// ══════════════════════════════════════════════════════════════════════
// Projection argument types (what .select() accepts)
// ══════════════════════════════════════════════════════════════════════

// An OQL expression (from raw(), fn(), alias(), subquery()) can appear as a projection arg
export interface OQLProjectionArg {
  readonly __oqlExpr: true
  readonly _projectionType?: Record<string, unknown>
}

// A projection arg is:
//  - a scalar field name (string)
//  - an object { relationName: RelationSpec }
//  - an OQL expression
export type ProjectionArg<S extends Schema, Name extends keyof S> =
  | ScalarKeys<Unwrap<S[Name]>>
  | RelationSpec<S, Name>
  | OQLProjectionArg

// Filter/order on sub-collections. `where` accepts a full FilterExpr OR a bare
// FieldRef<boolean> (short for `eq(field, true)`), matching the top-level .where().
export interface FilteredRelationSpec<S extends Schema, Target extends keyof S> {
  readonly fields: readonly ProjectionArg<S, Target>[]
  readonly where?: FilterExprShape | FieldRef<boolean>
  readonly orderBy?: readonly OrderExprShape[]
}

// Opaque shapes used only for type-level plumbing (operators define their own)
export interface FilterExprShape {
  readonly __filterExpr: true
}
export interface OrderExprShape {
  readonly __orderExpr: true
}

type RelationSpec<S extends Schema, Name extends keyof S> = {
  readonly [K in RelationKeys<Unwrap<S[Name]>>]?:
    Unwrap<S[Name]>[K] extends Relation<infer Target, any, any>
      ? Target extends keyof S
        ?
            | ScalarKeys<Unwrap<S[Target]>>
            | readonly ProjectionArg<S, Target>[]
            | FilteredRelationSpec<S, Target>
        : never
      : never
}

// ══════════════════════════════════════════════════════════════════════
// Infer projection result
// ══════════════════════════════════════════════════════════════════════

// Extract scalar string args from a projection args tuple
type ExtractScalarArgs<S extends Schema, Name extends keyof S, Args extends readonly any[]> = Extract<
  Args[number],
  ScalarKeys<Unwrap<S[Name]>>
>

// Extract OQL expression args (they contribute their _projectionType)
type ExtractExprArgs<Args extends readonly any[]> = Extract<Args[number], OQLProjectionArg>

// Extract plain object args (relation specs without expression marker)
type ExtractRelationObjs<Args extends readonly any[]> =
  Exclude<Extract<Args[number], Record<string, any>>, OQLProjectionArg>

// Extract fields array from either plain array, FilteredRelationSpec, or single-string shorthand
type ExtractRelFields<V> =
  V extends { readonly fields: readonly any[] } ? V['fields'] :
  V extends readonly any[] ? V :
  V extends string ? readonly [V] :
  never

// Resolve a relation's result type based on Kind and Nullable
type ResolveRelation<S extends Schema, R, Proj extends readonly any[]> =
  R extends Relation<infer Target, infer Kind, infer Nullable>
    ? Target extends keyof S
      ? Kind extends 'oneToMany' | 'manyToMany'
        ? InferProjection<S, Target, Proj>[]
        : Nullable extends true
          ? InferProjection<S, Target, Proj> | null
          : InferProjection<S, Target, Proj>
      : never
    : never

// For each relation key in the projection, resolve its result type
type InferRelationFields<S extends Schema, Name extends keyof S, Specs> = UnionToIntersection<
  Specs extends infer Obj extends Record<string, any>
    ? {
        readonly [K in keyof Obj & keyof Unwrap<S[Name]>]: ResolveRelation<
          S,
          Unwrap<S[Name]>[K],
          ExtractRelFields<Obj[K]>
        >
      }
    : never
>

// Merge OQL expression projection shapes
type InferExprFields<Exprs> = UnionToIntersection<
  Exprs extends { readonly _projectionType?: infer P extends Record<string, unknown> } ? P : never
>

// Main inference
export type InferProjection<
  S extends Schema,
  Name extends keyof S,
  Args extends readonly any[],
> = Prettify<
  Pick<InferAllScalars<Unwrap<S[Name]>>, ExtractScalarArgs<S, Name, Args> & ScalarKeys<Unwrap<S[Name]>>> &
    InferRelationFields<S, Name, ExtractRelationObjs<Args>> &
    InferExprFields<ExtractExprArgs<Args>>
>

// When no projection is given — all scalar fields
export type InferDefaultProjection<S extends Schema, Name extends keyof S> =
  InferAllScalars<Unwrap<S[Name]>>
