// ── Column types ──

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

// ── Column builder ──

export class ColumnBuilder<T = unknown, Nullable extends boolean = false, PK extends boolean = false> {
  declare readonly _type: T
  declare readonly _nullable: Nullable
  declare readonly _pk: PK

  readonly kind = 'column' as const
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
    opts?: {
      nullable?: boolean
      primaryKey?: boolean
      columnAlias?: string
      enumName?: string
      enumValues?: readonly string[]
      precision?: number
      scale?: number
    },
  ) {
    this.columnKind = columnKind
    this.isNullable = opts?.nullable ?? false
    this.isPrimaryKey = opts?.primaryKey ?? false
    this.columnAlias = opts?.columnAlias
    this.enumName = opts?.enumName
    this.enumValues = opts?.enumValues
    this.precision = opts?.precision
    this.scale = opts?.scale
  }

  primaryKey(): ColumnBuilder<T, Nullable, true> {
    return new ColumnBuilder(this.columnKind, {
      nullable: this.isNullable,
      primaryKey: true,
      columnAlias: this.columnAlias,
      enumName: this.enumName,
      enumValues: this.enumValues,
      precision: this.precision,
      scale: this.scale,
    }) as any
  }

  nullable(): ColumnBuilder<T | null, true, PK> {
    return new ColumnBuilder(this.columnKind, {
      nullable: true,
      primaryKey: this.isPrimaryKey,
      columnAlias: this.columnAlias,
      enumName: this.enumName,
      enumValues: this.enumValues,
      precision: this.precision,
      scale: this.scale,
    }) as any
  }

  column(alias: string): ColumnBuilder<T, Nullable, PK> {
    return new ColumnBuilder(this.columnKind, {
      nullable: this.isNullable,
      primaryKey: this.isPrimaryKey,
      columnAlias: alias,
      enumName: this.enumName,
      enumValues: this.enumValues,
      precision: this.precision,
      scale: this.scale,
    }) as any
  }
}

// ── Column type constructors ──

export function uuid() {
  return new ColumnBuilder<string>('uuid')
}

export function text() {
  return new ColumnBuilder<string>('text')
}

export function integer() {
  return new ColumnBuilder<number>('integer')
}

export function bigint_() {
  return new ColumnBuilder<bigint>('bigint')
}
export { bigint_ as bigint }

export function float() {
  return new ColumnBuilder<number>('float')
}

export function boolean_() {
  return new ColumnBuilder<boolean>('boolean')
}
export { boolean_ as boolean }

export function timestamp() {
  return new ColumnBuilder<Date>('timestamp')
}

export function date() {
  return new ColumnBuilder<Date>('date')
}

export function time() {
  return new ColumnBuilder<string>('time')
}

export function interval() {
  return new ColumnBuilder<string>('interval')
}

export function json<T = unknown>() {
  return new ColumnBuilder<T>('json')
}

export function textArray() {
  return new ColumnBuilder<string[]>('text[]')
}

export function integerArray() {
  return new ColumnBuilder<number[]>('integer[]')
}

export function decimal(precision?: number, scale?: number) {
  return new ColumnBuilder<bigint>('decimal', { precision, scale })
}

export function enumType<T extends string>(name: string, values: readonly T[]) {
  return new ColumnBuilder<T>('enum', { enumName: name, enumValues: values })
}

// ── Relation builder ──

export class RelationBuilder<
  _Target extends EntityDefinition = any,
  Kind extends RelationKind = RelationKind,
  Nullable extends boolean = false,
> {
  declare readonly _target: _Target
  declare readonly _kind: Kind
  declare readonly _nullable: Nullable

  readonly kind = 'relation' as const
  readonly relationKind: Kind
  readonly target: () => EntityInstance<any>
  readonly isNullable: boolean
  readonly options: {
    column?: string
    junction?: string
    junctionEntity?: string
    reference?: string
  }

  constructor(
    relationKind: Kind,
    target: () => EntityInstance<any>,
    options: {
      column?: string
      junction?: string
      junctionEntity?: string
      reference?: string
      nullable?: boolean
    } = {},
  ) {
    this.relationKind = relationKind
    this.target = target
    this.isNullable = options.nullable ?? false
    this.options = {
      column: options.column,
      junction: options.junction,
      junctionEntity: options.junctionEntity,
      reference: options.reference,
    }
  }

  nullable(): RelationBuilder<_Target, Kind, true> {
    return new RelationBuilder(this.relationKind, this.target, {
      ...this.options,
      nullable: true,
    }) as any
  }

  column(alias: string): RelationBuilder<_Target, Kind, Nullable> {
    return new RelationBuilder(this.relationKind, this.target, {
      ...this.options,
      column: alias,
    }) as any
  }
}

// ── Relation constructors ──

export function manyToOne<D extends EntityDefinition>(
  target: () => EntityInstance<D>,
  options?: { column?: string },
): RelationBuilder<D, 'manyToOne'> {
  return new RelationBuilder('manyToOne', target, options)
}

export function oneToMany<D extends EntityDefinition>(
  target: () => EntityInstance<D>,
): RelationBuilder<D, 'oneToMany'> {
  return new RelationBuilder('oneToMany', target)
}

export function manyToMany<D extends EntityDefinition>(
  target: () => EntityInstance<D>,
  options: { junction: string; junctionEntity?: string },
): RelationBuilder<D, 'manyToMany'> {
  return new RelationBuilder('manyToMany', target, options)
}

export function oneToOne<D extends EntityDefinition>(
  target: () => EntityInstance<D>,
  options?: { reference?: string },
): RelationBuilder<D, 'oneToOne'> {
  return new RelationBuilder('oneToOne', target, options)
}

// ── Entity definition ──

export type EntityDefinition = Record<string, ColumnBuilder<any, any, any> | RelationBuilder<any, any, any>>

export interface FieldRef<T = unknown> {
  readonly __fieldRef: true
  readonly _type: T
  readonly entityName: string
  readonly fieldName: string
  readonly builder: ColumnBuilder<any, any, any> | RelationBuilder<any, any, any>
}

export interface RelationFieldRef<Target extends EntityDefinition = any, Kind extends RelationKind = RelationKind> {
  readonly __relationRef: true
  readonly _target: Target
  readonly _kind: Kind
  readonly entityName: string
  readonly fieldName: string
  readonly builder: RelationBuilder<any, any, any>
}

type FieldRefsFor<D extends EntityDefinition> = {
  readonly [K in keyof D]: D[K] extends ColumnBuilder<infer T, infer N, any>
    ? FieldRef<N extends true ? T | null : T>
    : D[K] extends RelationBuilder<infer Target, infer Kind, any>
      ? RelationFieldRef<Target, Kind>
      : never
}

export type EntityInstance<D extends EntityDefinition = EntityDefinition> = {
  readonly __entity: true
  readonly entityName: string
  readonly tableName: string
  readonly definition: D
} & FieldRefsFor<D>

// Overloads: entity(name, definition) or entity(name, tableName, definition)
export function entity<D extends EntityDefinition>(name: string, definition: D): EntityInstance<D>
export function entity<D extends EntityDefinition>(name: string, tableName: string, definition: D): EntityInstance<D>
export function entity<D extends EntityDefinition>(
  name: string,
  tableNameOrDef: string | D,
  maybeDef?: D,
): EntityInstance<D> {
  const tableName = typeof tableNameOrDef === 'string' ? tableNameOrDef : name
  const definition = typeof tableNameOrDef === 'string' ? maybeDef! : tableNameOrDef

  const instance: any = {
    __entity: true,
    entityName: name,
    tableName,
    definition,
  }

  for (const [key, builder] of Object.entries(definition)) {
    if (builder.kind === 'column') {
      instance[key] = {
        __fieldRef: true,
        entityName: name,
        fieldName: key,
        builder,
      } satisfies Omit<FieldRef, '_type'>
    } else {
      instance[key] = {
        __relationRef: true,
        entityName: name,
        fieldName: key,
        builder,
      } satisfies Omit<RelationFieldRef, '_target' | '_kind'>
    }
  }

  return instance
}
