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

export type { ColumnKind, ColumnOptions, RelationKind, EntityDef, EntityMeta, SchemaDef, SchemaEntry, FieldDef, Unwrap } from './schema.js'

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
// DB — createPostgresDB/createPetraDB build the backend from the schema;
// typedOQL wraps an OQL instance you constructed yourself.
// ══════════════════════════════════════════════════════════════════════
export { createPostgresDB, createPetraDB } from './backends.js'
export type { PostgresConnection, PostgresOptions, PetraOptions, PetraStorage } from './backends.js'
export { PostgresTypeOid, parseInt8AsNumber, parseTimestampAsUtcDate, keepJsonAsString } from './postgres-types.js'
export type { PostgresTypeParser } from './postgres-types.js'
export { typedOQL } from './db.js'
export type { DB, EntityHandle, OQLInstance, Engine } from './db.js'

// ══════════════════════════════════════════════════════════════════════
// Query
// ══════════════════════════════════════════════════════════════════════
export { query, projection } from './query.js'
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
  arrayContains,
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

export type { FilterExpr, FilterArg, OrderExpr, FilterField, BoundArg } from './operators.js'

// ══════════════════════════════════════════════════════════════════════
// Expressions
// ══════════════════════════════════════════════════════════════════════
export {
  fn,
  ref,
  outer,
  subquery,
  alias,
  aliasedRelation,
  currentTimestamp,
  currentDate,
  caseWhen,
  add,
  subtract,
  multiply,
  divide,
} from './expressions.js'
export type {
  OQLExpr,
  AliasedRelationSpec,
  CaseBranch,
  Interval,
  Operand,
  NumberOperand,
  DateOperand,
  IntervalOperand,
} from './expressions.js'

// Typed function wrappers
export {
  lower,
  upper,
  trim,
  length,
  concat,
  concatOp,
  coalesce,
  count,
  sum,
  avg,
  min,
  max,
  makeInterval,
  datePart,
  dateTrunc,
} from './functions.js'
export type { IntervalParts, DateField, DateTruncUnit } from './functions.js'

// ══════════════════════════════════════════════════════════════════════
// Mutations — insert/update/delete/bulkDelete are methods on every entity
// handle (db.user.insert(...), db.trip.delete(...)). These types describe
// their inputs and shape.
// ══════════════════════════════════════════════════════════════════════
export type { InsertInput, UpdateInput, MutationMethods } from './mutations.js'

// ══════════════════════════════════════════════════════════════════════
// Conditional QueryBuilder
// ══════════════════════════════════════════════════════════════════════
export { queryBuilder } from './query-builder.js'
