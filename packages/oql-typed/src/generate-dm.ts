// Generate an OQL `.dm` data-model string from a TypeScript schema object.
// This is what lets consumers declare their model once, in TypeScript, and
// have oql-typed build the backend for them — no `.dm` file anywhere.
//
// Internal: the backend factories in backends.ts are the only caller, and the
// package does not export it.

import { Column, Relation } from './schema.js'
import type { EntityDef, EntityMeta, SchemaEntry } from './schema.js'
import type { Schema } from './types.js'

interface ResolvedEntity {
  tableName: string | undefined
  definition: EntityDef
}

function resolveEntry(entry: SchemaEntry): ResolvedEntity {
  if (typeof entry === 'object' && '__meta' in entry && entry.__meta === true) {
    const meta = entry as EntityMeta
    return { tableName: meta.tableName, definition: meta.definition }
  }
  return { tableName: undefined, definition: entry as EntityDef }
}

function columnTypeName(column: Column<any, any, any>): string {
  switch (column.columnKind) {
    case 'boolean':
      return 'bool'
    case 'enum':
      return column.enumName ?? 'text'
    case 'decimal':
      if (column.precision === undefined) return 'decimal'
      if (column.scale === undefined) return `decimal(${column.precision})`
      return `decimal(${column.precision}, ${column.scale})`
    default:
      return column.columnKind
  }
}

function columnLine(fieldName: string, column: Column<any, any, any>): string {
  const primaryKey = column.isPrimaryKey ? '*' : ' '
  const alias = column.columnAlias ? ` (${column.columnAlias})` : ''
  const required = !column.isNullable && !column.isPrimaryKey ? '!' : ''
  return `  ${primaryKey}${fieldName}${alias}: ${columnTypeName(column)}${required}`
}

function relationLine(fieldName: string, relation: Relation<any, any, any>): string {
  switch (relation.relationKind) {
    case 'manyToOne': {
      const alias = relation.column ? ` (${relation.column})` : ''
      const required = relation.isNullable ? '' : '!'
      return `  ${fieldName}${alias}: ${relation.target}${required}`
    }
    case 'oneToMany': {
      const reference = relation.reference ? `.${relation.reference}` : ''
      return `  ${fieldName}: [${relation.target}]${reference}`
    }
    case 'manyToMany':
      return `  ${fieldName}: [${relation.target}] (${relation.junction})`
    default: {
      const reference = relation.reference ? `.${relation.reference}` : ''
      return `  ${fieldName}: <${relation.target}>${reference}`
    }
  }
}

export function generateDM(schema: Schema): string {
  const parts: string[] = []
  const entries = Object.entries(schema).map(
    ([entityName, entry]): [string, ResolvedEntity] => [entityName, resolveEntry(entry)],
  )

  // Enums come first: OQL resolves a column's enum type by name, so the
  // declaration has to precede every entity that uses it.
  const enums = new Map<string, readonly string[]>()
  for (const [, { definition }] of entries) {
    for (const field of Object.values(definition)) {
      if (field instanceof Column && field.enumName && field.enumValues && !enums.has(field.enumName)) {
        enums.set(field.enumName, field.enumValues)
      }
    }
  }
  for (const [enumName, values] of enums) {
    parts.push(`enum ${enumName} { ${values.join(' ')} }`)
  }

  for (const [entityName, { tableName, definition }] of entries) {
    const header = tableName ? `entity ${entityName} (${tableName})` : `entity ${entityName}`
    const lines: string[] = []
    for (const [fieldName, field] of Object.entries(definition)) {
      if (field instanceof Column) lines.push(columnLine(fieldName, field))
      else if (field instanceof Relation) lines.push(relationLine(fieldName, field))
    }
    parts.push(`${header} {\n${lines.join('\n')}\n}`)
  }

  // A junction table only needs synthesizing when the schema does not already
  // declare it as an entity of its own.
  const entityNames = new Set(entries.map(([entityName]) => entityName))
  const junctions = new Map<string, { from: string; to: string }>()
  for (const [entityName, { definition }] of entries) {
    for (const field of Object.values(definition)) {
      if (
        field instanceof Relation &&
        field.relationKind === 'manyToMany' &&
        field.junction !== undefined &&
        !entityNames.has(field.junction) &&
        !junctions.has(field.junction)
      ) {
        junctions.set(field.junction, { from: entityName, to: field.target })
      }
    }
  }
  for (const [junction, { from, to }] of junctions) {
    parts.push(`entity ${junction} {\n  ${from} (${from}_id): ${from}\n  ${to} (${to}_id): ${to}\n}`)
  }

  return parts.join('\n\n')
}
