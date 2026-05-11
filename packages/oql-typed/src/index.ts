// ══════════════════════════════════════════════════════════════════════
// Schema definition
// ══════════════════════════════════════════════════════════════════════
export {
  defineSchema,
  entity,
  uuid,
  text,
  integer,
  bigint,
  float,
  boolean,
  timestamp,
  date,
  time,
  interval,
  json,
  textArray,
  integerArray,
  decimal,
  enumType,
  manyToOne,
  oneToMany,
  manyToMany,
  oneToOne,
  Column,
  Relation,
} from './schema.js'

export type { ColumnKind, RelationKind, EntityDef, EntityMeta, SchemaDef, SchemaEntry, FieldDef, Unwrap } from './schema.js'

// ══════════════════════════════════════════════════════════════════════
// Type plumbing
// ══════════════════════════════════════════════════════════════════════
export type {
  Schema,
  FieldRef,
  RelationFieldRef,
  ManyToOneFieldRef,
  FieldRefsFor,
  InferProjection,
  InferAllScalars,
  InferDefaultProjection,
  InferColumnType,
  PKType,
  ProjectionArg,
  FilteredRelationSpec,
  Prettify,
} from './types.js'

// ══════════════════════════════════════════════════════════════════════
// DB / typedOQL
// ══════════════════════════════════════════════════════════════════════
export { typedOQL } from './db.js'
export type { DB, EntityHandle, OQLInstance } from './db.js'

// ══════════════════════════════════════════════════════════════════════
// Query
// ══════════════════════════════════════════════════════════════════════
export { query } from './query.js'
export type { QueryStarter } from './query.js'

// ══════════════════════════════════════════════════════════════════════
// Operators
// ══════════════════════════════════════════════════════════════════════
export {
  eq,
  ne,
  gt,
  gte,
  lt,
  lte,
  and,
  or,
  not,
  inList,
  notInList,
  like,
  ilike,
  between,
  isNull,
  isNotNull,
  exists,
  asc,
  desc,
  FilterContext,
} from './operators.js'

export type { FilterExpr, FilterArg, OrderExpr, FilterField } from './operators.js'

// ══════════════════════════════════════════════════════════════════════
// Expressions
// ══════════════════════════════════════════════════════════════════════
export { fn, raw, ref, subquery, alias, aliasedRelation } from './expressions.js'
export type { OQLExpr, AliasedRelationSpec } from './expressions.js'

// Typed function wrappers
export { lower, upper, trim, length, concat, coalesce, count, sum, avg, min, max } from './functions.js'

// ══════════════════════════════════════════════════════════════════════
// Mutations
// ══════════════════════════════════════════════════════════════════════
export { insert, update } from './mutations.js'
export type { InsertInput, UpdateInput } from './mutations.js'

// ══════════════════════════════════════════════════════════════════════
// Conditional QueryBuilder
// ══════════════════════════════════════════════════════════════════════
export { queryBuilder } from './query-builder.js'
