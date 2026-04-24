// Schema-object design: relations reference entities by string literal, never by typeof.
// This eliminates circular reference issues since TypeScript resolves everything via
// indexed access (Schema[name]) rather than following function return types.

// ══════════════════════════════════════════════════════════════════════
// Column kinds (runtime discriminator)
// ══════════════════════════════════════════════════════════════════════

export type ColumnKind =
  | 'uuid'
  | 'text'
  | 'integer'
  | 'bigint'
  | 'float'
  | 'boolean'
  | 'timestamp'
  | 'date'
  | 'time'
  | 'interval'
  | 'json'
  | 'text[]'
  | 'integer[]'
  | 'boolean[]'
  | 'float[]'
  | 'uuid[]'
  | 'timestamp[]'
  | 'json[]'
  | 'bigint[]'
  | 'decimal'
  | 'enum'

export type RelationKind = 'manyToOne' | 'oneToMany' | 'manyToMany' | 'oneToOne'

// ══════════════════════════════════════════════════════════════════════
// Column builder
// ══════════════════════════════════════════════════════════════════════

export class Column<T = unknown, Nullable extends boolean = false, PK extends boolean = false> {
  declare readonly _type: T
  declare readonly _nullable: Nullable
  declare readonly _pk: PK

  readonly __kind = 'column' as const
  readonly columnKind: ColumnKind
  readonly isNullable: boolean
  readonly isPrimaryKey: boolean
  readonly columnAlias: string | undefined
  readonly enumName: string | undefined
  readonly enumValues: readonly string[] | undefined
  readonly precision: number | undefined
  readonly scale: number | undefined

  constructor(
    columnKind: ColumnKind,
    opts: {
      nullable?: boolean
      primaryKey?: boolean
      columnAlias?: string
      enumName?: string
      enumValues?: readonly string[]
      precision?: number
      scale?: number
    } = {},
  ) {
    this.columnKind = columnKind
    this.isNullable = opts.nullable ?? false
    this.isPrimaryKey = opts.primaryKey ?? false
    this.columnAlias = opts.columnAlias
    this.enumName = opts.enumName
    this.enumValues = opts.enumValues
    this.precision = opts.precision
    this.scale = opts.scale
  }

  primaryKey(): Column<T, Nullable, true> {
    return new Column(this.columnKind, {
      nullable: this.isNullable,
      primaryKey: true,
      columnAlias: this.columnAlias,
      enumName: this.enumName,
      enumValues: this.enumValues,
      precision: this.precision,
      scale: this.scale,
    }) as Column<T, Nullable, true>
  }

  nullable(): Column<T | null, true, PK> {
    return new Column(this.columnKind, {
      nullable: true,
      primaryKey: this.isPrimaryKey,
      columnAlias: this.columnAlias,
      enumName: this.enumName,
      enumValues: this.enumValues,
      precision: this.precision,
      scale: this.scale,
    }) as Column<T | null, true, PK>
  }

  column(alias: string): Column<T, Nullable, PK> {
    return new Column(this.columnKind, {
      nullable: this.isNullable,
      primaryKey: this.isPrimaryKey,
      columnAlias: alias,
      enumName: this.enumName,
      enumValues: this.enumValues,
      precision: this.precision,
      scale: this.scale,
    }) as Column<T, Nullable, PK>
  }
}

// ══════════════════════════════════════════════════════════════════════
// Column constructors
// ══════════════════════════════════════════════════════════════════════

export const uuid = () => new Column<string>('uuid')
export const text = () => new Column<string>('text')
export const integer = () => new Column<number>('integer')
const bigintCol = () => new Column<bigint>('bigint')
export { bigintCol as bigint }
export const float = () => new Column<number>('float')
const booleanCol = () => new Column<boolean>('boolean')
export { booleanCol as boolean }
export const timestamp = () => new Column<Date>('timestamp')
export const date = () => new Column<Date>('date')
export const time = () => new Column<string>('time')
export const interval = () => new Column<string>('interval')
export const json = <T = unknown>() => new Column<T>('json')
export const textArray = () => new Column<string[]>('text[]')
export const integerArray = () => new Column<number[]>('integer[]')
export const decimal = (precision?: number, scale?: number) =>
  new Column<bigint>('decimal', { precision, scale })

export function enumType<T extends string>(name: string, values: readonly T[]): Column<T, false, false> {
  return new Column<T>('enum', { enumName: name, enumValues: values })
}

// ══════════════════════════════════════════════════════════════════════
// Relation builder — target is a STRING LITERAL (no TS reference)
// ══════════════════════════════════════════════════════════════════════

export class Relation<
  Target extends string = string,
  Kind extends RelationKind = RelationKind,
  Nullable extends boolean = false,
> {
  declare readonly _target: Target
  declare readonly _kind: Kind
  declare readonly _nullable: Nullable

  readonly __kind = 'relation' as const
  readonly target: Target
  readonly relationKind: Kind
  readonly isNullable: boolean
  readonly column: string | undefined
  readonly junction: string | undefined
  readonly reference: string | undefined

  constructor(
    target: Target,
    relationKind: Kind,
    opts: { nullable?: boolean; column?: string; junction?: string; reference?: string } = {},
  ) {
    this.target = target
    this.relationKind = relationKind
    this.isNullable = opts.nullable ?? false
    this.column = opts.column
    this.junction = opts.junction
    this.reference = opts.reference
  }

  nullable(): Relation<Target, Kind, true> {
    return new Relation(this.target, this.relationKind, {
      nullable: true,
      column: this.column,
      junction: this.junction,
      reference: this.reference,
    }) as Relation<Target, Kind, true>
  }
}

export function manyToOne<Target extends string>(
  target: Target,
  opts?: { column?: string },
): Relation<Target, 'manyToOne', false> {
  return new Relation(target, 'manyToOne', opts)
}

export function oneToMany<Target extends string>(target: Target): Relation<Target, 'oneToMany', false> {
  return new Relation(target, 'oneToMany')
}

export function manyToMany<Target extends string>(
  target: Target,
  opts: { junction: string },
): Relation<Target, 'manyToMany', false> {
  return new Relation(target, 'manyToMany', opts)
}

export function oneToOne<Target extends string>(
  target: Target,
  opts?: { reference?: string },
): Relation<Target, 'oneToOne', false> {
  return new Relation(target, 'oneToOne', opts)
}

// ══════════════════════════════════════════════════════════════════════
// Schema + entity metadata
// ══════════════════════════════════════════════════════════════════════

export type FieldDef = Column<any, any, any> | Relation<any, any, any>
export type EntityDef = { readonly [fieldName: string]: FieldDef }
export type SchemaDef = { readonly [entityName: string]: EntityDef }

// A schema can optionally associate a table name with each entity.
// Simple form (name = table name): define a plain object.
// Extended form: wrap with entity() to specify a table name.
export interface EntityMeta<D extends EntityDef = EntityDef> {
  readonly __meta: true
  readonly tableName: string | undefined
  readonly definition: D
}

export function entity<D extends EntityDef>(definition: D): EntityMeta<D>
export function entity<D extends EntityDef>(tableName: string, definition: D): EntityMeta<D>
export function entity<D extends EntityDef>(
  tableNameOrDef: string | D,
  maybeDef?: D,
): EntityMeta<D> {
  const tableName = typeof tableNameOrDef === 'string' ? tableNameOrDef : undefined
  const definition = typeof tableNameOrDef === 'string' ? (maybeDef as D) : tableNameOrDef
  return { __meta: true, tableName, definition }
}

// An entry in the schema object can be either a plain entity definition
// OR an entity meta wrapper (for custom table names).
export type SchemaEntry = EntityDef | EntityMeta

// Resolves to EntityDef whether the entry is raw or wrapped.
export type Unwrap<E> = E extends EntityMeta<infer D> ? D : E extends EntityDef ? E : never

// ══════════════════════════════════════════════════════════════════════
// defineSchema — preserves literal types via `const` generic modifier
// ══════════════════════════════════════════════════════════════════════

export function defineSchema<const S extends Record<string, SchemaEntry>>(schema: S): S {
  return schema
}
