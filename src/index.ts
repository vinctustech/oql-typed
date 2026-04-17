// Schema definition
export {
  entity,
  uuid,
  text,
  integer,
  bigint_ as bigint,
  float,
  boolean_ as boolean,
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
  ColumnBuilder,
  RelationBuilder,
} from './schema.js'

export type { EntityDefinition, EntityInstance, FieldRef, RelationFieldRef } from './schema.js'

// Type inference
export type { InferProjection, InferAllScalars, ProjectionArg, FilteredRelationSpec, Prettify } from './types.js'

// Query
export { query } from './query.js'
export type { OQLInstance } from './query.js'

// Operators
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
} from './operators.js'

export type { FilterExpr, OrderExpr } from './operators.js'

// DM generation
export { generateDM } from './generate-dm.js'

// DM parsing / codegen
export { parseDM, parseDMAndGenerate, generateSchemaTS } from './parse-dm.js'
export type { ParsedDataModel } from './parse-dm.js'
