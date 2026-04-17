import type { EntityDefinition, EntityInstance, ColumnBuilder, RelationBuilder } from './schema.js'
import type { InferAllScalars, ScalarKeys, RelationKeys } from './types.js'

// ── OQL mutation interface — what we need from @vinctus/oql ──

export interface OQLMutationInstance {
  entity(name: string): {
    insert<T = any>(data: Record<string, unknown>): Promise<T>
    update<T = any>(id: unknown, data: Record<string, unknown>): Promise<T>
  }
}

// ── Input types for insert/update ──

// Scalar fields: all columns except primary keys
type InsertableScalarKeys<D extends EntityDefinition> = {
  [K in ScalarKeys<D>]: D[K] extends ColumnBuilder<any, any, infer PK>
    ? PK extends true ? never : K
    : never
}[ScalarKeys<D>]

// ManyToOne FK fields: accept the FK value (string/number) for linking
type ManyToOneFKKeys<D extends EntityDefinition> = {
  [K in RelationKeys<D>]: D[K] extends RelationBuilder<any, infer Kind, any>
    ? Kind extends 'manyToOne' ? K : never
    : never
}[RelationKeys<D>]

type RequiredManyToOneFKKeys<D extends EntityDefinition> = {
  [K in ManyToOneFKKeys<D>]: D[K] extends RelationBuilder<any, any, infer N>
    ? N extends true ? never : K
    : never
}[ManyToOneFKKeys<D>]

type OptionalManyToOneFKKeys<D extends EntityDefinition> = {
  [K in ManyToOneFKKeys<D>]: D[K] extends RelationBuilder<any, any, infer N>
    ? N extends true ? K : never
    : never
}[ManyToOneFKKeys<D>]

// Required vs optional scalar keys
type RequiredScalarInsertKeys<D extends EntityDefinition> = {
  [K in InsertableScalarKeys<D>]: D[K] extends ColumnBuilder<any, infer N, any>
    ? N extends true ? never : K
    : never
}[InsertableScalarKeys<D>]

type OptionalScalarInsertKeys<D extends EntityDefinition> = {
  [K in InsertableScalarKeys<D>]: D[K] extends ColumnBuilder<any, infer N, any>
    ? N extends true ? K : never
    : never
}[InsertableScalarKeys<D>]

type InferColumnInput<C> = C extends ColumnBuilder<infer T, any, any> ? T : never

export type InsertInput<D extends EntityDefinition> =
  { [K in RequiredScalarInsertKeys<D>]: InferColumnInput<D[K]> } &
  { [K in OptionalScalarInsertKeys<D>]?: InferColumnInput<D[K]> | null } &
  { [K in RequiredManyToOneFKKeys<D>]: string } &
  { [K in OptionalManyToOneFKKeys<D>]?: string | null }

// Updatable: all non-PK scalar columns + manyToOne FKs, all optional
export type UpdateInput<D extends EntityDefinition> = {
  [K in InsertableScalarKeys<D>]?: InferColumnInput<D[K]> | null
} & {
  [K in ManyToOneFKKeys<D>]?: string | null
}

// ── Typed mutation functions ──

export function insert<D extends EntityDefinition>(
  oql: OQLMutationInstance,
  entity: EntityInstance<D>,
  data: InsertInput<D>,
): Promise<InferAllScalars<D>> {
  return oql.entity(entity.entityName).insert<InferAllScalars<D>>(data as Record<string, unknown>)
}

export function update<D extends EntityDefinition>(
  oql: OQLMutationInstance,
  entity: EntityInstance<D>,
  id: string | number,
  data: UpdateInput<D>,
): Promise<Partial<InferAllScalars<D>>> {
  return oql.entity(entity.entityName).update(id, data as Record<string, unknown>)
}
