import type { EntityInstance, EntityDefinition, ColumnBuilder, RelationBuilder } from './schema.js'

// ── Generate .dm string from TypeScript entity schemas ──

const COLUMN_KIND_TO_DM: Record<string, string> = {
  uuid: 'uuid',
  text: 'text',
  integer: 'integer',
  bigint: 'bigint',
  float: 'float',
  boolean: 'bool',
  timestamp: 'timestamp',
  date: 'date',
  time: 'time',
  interval: 'interval',
  json: 'json',
  'text[]': 'text[]',
  'integer[]': 'integer[]',
  'boolean[]': 'boolean[]',
  'float[]': 'float[]',
  'uuid[]': 'uuid[]',
  'timestamp[]': 'timestamp[]',
  'json[]': 'json[]',
  'bigint[]': 'bigint[]',
}

function columnToDM(col: ColumnBuilder<any, any, any>): string {
  if (col.columnKind === 'enum') {
    return col.enumName!
  }
  if (col.columnKind === 'decimal') {
    if (col.precision !== undefined) {
      return col.scale !== undefined ? `decimal(${col.precision}, ${col.scale})` : `decimal(${col.precision})`
    }
    return 'decimal'
  }
  return COLUMN_KIND_TO_DM[col.columnKind] ?? col.columnKind
}

function relationToDM(fieldName: string, rel: RelationBuilder<any, any, any>): string {
  const target = rel.target()

  switch (rel.relationKind) {
    case 'manyToOne': {
      const alias = rel.options.column ? ` (${rel.options.column})` : ''
      const required = rel.isNullable ? '' : '!'
      return `${fieldName}${alias}: ${target.entityName}${required}`
    }
    case 'oneToMany': {
      return `${fieldName}: [${target.entityName}]`
    }
    case 'manyToMany': {
      const junction = rel.options.junction ? ` (${rel.options.junction})` : ''
      return `${fieldName}: [${target.entityName}]${junction}`
    }
    case 'oneToOne': {
      const ref = rel.options.reference ? `.${rel.options.reference}` : ''
      return `${fieldName}: <${target.entityName}>${ref}`
    }
    default:
      throw new Error(`Unknown relation kind: ${rel.relationKind}`)
  }
}

function entityToDM(entity: EntityInstance<any>): string {
  const tablePart = entity.tableName !== entity.entityName ? ` (${entity.tableName})` : ''
  const lines: string[] = []

  for (const [fieldName, builder] of Object.entries(entity.definition)) {
    const b = builder as ColumnBuilder<any, any, any> | RelationBuilder<any, any, any>

    if (b.kind === 'column') {
      const col = b as ColumnBuilder<any, any, any>
      const pk = col.isPrimaryKey ? '*' : ' '
      const alias = col.columnAlias ? ` (${col.columnAlias})` : ''
      const required = !col.isNullable && !col.isPrimaryKey ? '!' : ''
      const typeName = columnToDM(col)
      lines.push(`  ${pk}${fieldName}${alias}: ${typeName}${required}`)
    } else {
      lines.push(`  ${relationToDM(fieldName, b as RelationBuilder<any, any, any>)}`)
    }
  }

  return `entity ${entity.entityName}${tablePart} {\n${lines.join('\n')}\n}`
}

// Collect enum definitions from all entities
function collectEnums(entities: EntityInstance<any>[]): Map<string, readonly string[]> {
  const enums = new Map<string, readonly string[]>()

  for (const entity of entities) {
    for (const builder of Object.values(entity.definition)) {
      const b = builder as ColumnBuilder<any, any, any>
      if (b.kind === 'column' && b.columnKind === 'enum' && b.enumName && b.enumValues) {
        enums.set(b.enumName, b.enumValues)
      }
    }
  }

  return enums
}

export function generateDM(...entities: EntityInstance<any>[]): string {
  const enums = collectEnums(entities)
  const parts: string[] = []

  for (const [name, values] of enums) {
    parts.push(`enum ${name} { ${values.map((v) => `'${v}'`).join(' ')} }`)
  }

  for (const entity of entities) {
    parts.push(entityToDM(entity))
  }

  return parts.join('\n\n')
}
