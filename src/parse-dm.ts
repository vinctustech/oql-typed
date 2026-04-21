// Parse .dm string and generate TypeScript schema source code (v2 — schema-object)
// Output format:
//   export const schema = defineSchema({
//     user: entity('users', { id: uuid().primaryKey(), account: manyToOne('account') }),
//     account: entity('accounts', { id: uuid().primaryKey() }),
//   })
//
// No @ts-nocheck needed — the new design has no circular type cycles.

// ══════════════════════════════════════════════════════════════════════
// Tokenizer
// ══════════════════════════════════════════════════════════════════════

type TokenType =
  | 'enum'
  | 'entity'
  | 'ident'
  | 'string'
  | '{'
  | '}'
  | '('
  | ')'
  | '['
  | ']'
  | '<'
  | '>'
  | ':'
  | '*'
  | '!'
  | '.'
  | ','
  | 'eof'

interface Token {
  type: TokenType
  value: string
  pos: number
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < input.length) {
    if (/\s/.test(input[i])) { i++; continue }
    if (input[i] === '/' && input[i + 1] === '/') {
      while (i < input.length && input[i] !== '\n') i++
      continue
    }
    const singles: Record<string, TokenType> = {
      '{': '{', '}': '}', '(': '(', ')': ')', '[': '[', ']': ']',
      '<': '<', '>': '>', ':': ':', '*': '*', '!': '!', '.': '.', ',': ',',
    }
    if (singles[input[i]]) {
      tokens.push({ type: singles[input[i]], value: input[i], pos: i })
      i++
      continue
    }
    if (input[i] === "'" || input[i] === '"') {
      const quote = input[i]
      const start = i
      i++
      while (i < input.length && input[i] !== quote) i++
      if (i >= input.length) throw new Error(`Unterminated string at position ${start}`)
      tokens.push({ type: 'string', value: input.substring(start + 1, i), pos: start })
      i++
      continue
    }
    if (/[a-zA-Z_$]/.test(input[i])) {
      const start = i
      while (i < input.length && /[a-zA-Z0-9_$]/.test(input[i])) i++
      if (i + 1 < input.length && input[i] === '[' && input[i + 1] === ']') i += 2
      const value = input.substring(start, i)
      if (value === 'enum') tokens.push({ type: 'enum', value, pos: start })
      else if (value === 'entity') tokens.push({ type: 'entity', value, pos: start })
      else tokens.push({ type: 'ident', value, pos: start })
      continue
    }
    if (/[0-9]/.test(input[i])) {
      const start = i
      while (i < input.length && /[0-9]/.test(input[i])) i++
      tokens.push({ type: 'ident', value: input.substring(start, i), pos: start })
      continue
    }
    throw new Error(`Unexpected character '${input[i]}' at position ${i}`)
  }
  tokens.push({ type: 'eof', value: '', pos: i })
  return tokens
}

// ══════════════════════════════════════════════════════════════════════
// Parser
// ══════════════════════════════════════════════════════════════════════

interface ParsedEnum {
  name: string
  values: readonly string[]
}

interface ParsedField {
  name: string
  columnAlias?: string
  isPrimaryKey: boolean
  isRequired: boolean
  type: ParsedFieldType
}

type ParsedFieldType =
  | { kind: 'primitive'; typeName: string; precision?: number; scale?: number }
  | { kind: 'enum'; enumName: string }
  | { kind: 'manyToOne'; target: string }
  | { kind: 'oneToMany'; target: string }
  | { kind: 'manyToMany'; target: string; junction: string }
  | { kind: 'oneToOne'; target: string; reference?: string }

interface ParsedEntity {
  name: string
  tableName?: string
  fields: ParsedField[]
}

export interface ParsedDataModel {
  enums: ParsedEnum[]
  entities: ParsedEntity[]
}

const PRIMITIVE_TYPES = new Set([
  'uuid', 'text', 'integer', 'int', 'int4', 'bigint', 'int8',
  'float', 'float8', 'bool', 'boolean', 'timestamp', 'date', 'time',
  'interval', 'json', 'text[]', 'integer[]', 'int[]', 'boolean[]', 'bool[]',
  'float[]', 'uuid[]', 'timestamp[]', 'json[]', 'bigint[]', 'decimal',
])

class Parser {
  private tokens: Token[]
  private pos = 0
  constructor(tokens: Token[]) { this.tokens = tokens }
  private peek(): Token { return this.tokens[this.pos] }
  private advance(): Token { return this.tokens[this.pos++] }
  private expect(type: TokenType): Token {
    const tok = this.advance()
    if (tok.type !== type) {
      throw new Error(`Expected ${type} but got ${tok.type} ('${tok.value}') at position ${tok.pos}`)
    }
    return tok
  }

  parse(): ParsedDataModel {
    const enums: ParsedEnum[] = []
    const entities: ParsedEntity[] = []
    while (this.peek().type !== 'eof') {
      if (this.peek().type === 'enum') enums.push(this.parseEnum())
      else if (this.peek().type === 'entity') entities.push(this.parseEntity())
      else throw new Error(`Expected 'enum' or 'entity' but got '${this.peek().value}' at position ${this.peek().pos}`)
    }
    return { enums, entities }
  }

  private parseEnum(): ParsedEnum {
    this.expect('enum')
    const name = this.expect('ident').value
    this.expect('{')
    const values: string[] = []
    while (this.peek().type !== '}') {
      if (this.peek().type === 'string') values.push(this.advance().value)
      else if (this.peek().type === 'ident') values.push(this.advance().value)
      else throw new Error(`Unexpected token in enum: ${this.peek().value}`)
    }
    this.expect('}')
    return { name, values }
  }

  private parseEntity(): ParsedEntity {
    this.expect('entity')
    const name = this.expect('ident').value
    let tableName: string | undefined
    if (this.peek().type === '(') {
      this.advance()
      tableName = this.expect('ident').value
      this.expect(')')
    }
    this.expect('{')
    const fields: ParsedField[] = []
    while (this.peek().type !== '}') fields.push(this.parseField())
    this.expect('}')
    return { name, tableName, fields }
  }

  private parseField(): ParsedField {
    const isPrimaryKey = this.peek().type === '*'
    if (isPrimaryKey) this.advance()
    const name = this.expect('ident').value
    let columnAlias: string | undefined
    if (this.peek().type === '(') {
      this.advance()
      columnAlias = this.expect('ident').value
      this.expect(')')
    }
    this.expect(':')
    const type = this.parseFieldType()
    const isRequired = this.peek().type === '!'
    if (isRequired) this.advance()
    return { name, columnAlias, isPrimaryKey, isRequired, type }
  }

  private parseFieldType(): ParsedFieldType {
    if (this.peek().type === '<') {
      this.advance()
      const target = this.expect('ident').value
      this.expect('>')
      let reference: string | undefined
      if (this.peek().type === '.') {
        this.advance()
        reference = this.expect('ident').value
      }
      return { kind: 'oneToOne', target, reference }
    }
    if (this.peek().type === '[') {
      this.advance()
      const target = this.expect('ident').value
      this.expect(']')
      if (this.peek().type === '(') {
        this.advance()
        const junction = this.expect('ident').value
        this.expect(')')
        return { kind: 'manyToMany', target, junction }
      }
      if (this.peek().type === '.') {
        this.advance()
        this.expect('ident') // reverse reference — consumed but unused
      }
      return { kind: 'oneToMany', target }
    }
    const typeName = this.expect('ident').value
    if (typeName === 'decimal' && this.peek().type === '(') {
      this.advance()
      const precision = parseInt(this.expect('ident').value)
      let scale: number | undefined
      if (this.peek().type === ',') {
        this.advance()
        scale = parseInt(this.expect('ident').value)
      }
      this.expect(')')
      return { kind: 'primitive', typeName: 'decimal', precision, scale }
    }
    if (PRIMITIVE_TYPES.has(typeName)) return { kind: 'primitive', typeName }
    return { kind: 'manyToOne', target: typeName }
  }
}

export function parseDM(input: string): ParsedDataModel {
  return new Parser(tokenize(input)).parse()
}

// ══════════════════════════════════════════════════════════════════════
// Code generator — emits v2 schema-object TypeScript
// ══════════════════════════════════════════════════════════════════════

const PRIMITIVE_BUILDER: Record<string, string> = {
  uuid: 'uuid()',
  text: 'text()',
  integer: 'integer()',
  int: 'integer()',
  int4: 'integer()',
  bigint: 'bigint()',
  int8: 'bigint()',
  float: 'float()',
  float8: 'float()',
  bool: 'boolean()',
  boolean: 'boolean()',
  timestamp: 'timestamp()',
  date: 'date()',
  time: 'time()',
  interval: 'interval()',
  json: 'json()',
  'text[]': 'textArray()',
  'integer[]': 'integerArray()',
  'int[]': 'integerArray()',
}

const PRIMITIVE_IMPORT: Record<string, string> = {
  uuid: 'uuid',
  text: 'text',
  integer: 'integer',
  int: 'integer',
  int4: 'integer',
  bigint: 'bigint',
  int8: 'bigint',
  float: 'float',
  float8: 'float',
  bool: 'boolean',
  boolean: 'boolean',
  timestamp: 'timestamp',
  date: 'date',
  time: 'time',
  interval: 'interval',
  json: 'json',
  'text[]': 'textArray',
  'integer[]': 'integerArray',
  'int[]': 'integerArray',
  decimal: 'decimal',
}

const MAX_LINE_WIDTH = 100

export function generateSchemaTS(dm: ParsedDataModel): string {
  const enumNames = new Set(dm.enums.map((e) => e.name))
  const enumValues = new Map(dm.enums.map((e): [string, readonly string[]] => [e.name, e.values]))

  // Figure out which imports we need
  const imports = new Set(['defineSchema', 'entity'])
  const relationKinds = { manyToOne: false, oneToMany: false, manyToMany: false, oneToOne: false }

  for (const ent of dm.entities) {
    for (const f of ent.fields) {
      const t = f.type
      if (t.kind === 'primitive') {
        const imp = PRIMITIVE_IMPORT[t.typeName]
        if (imp) imports.add(imp)
      } else if (t.kind === 'manyToOne') {
        if (enumNames.has(t.target)) {
          imports.add('enumType')
        } else {
          relationKinds.manyToOne = true
        }
      } else if (t.kind === 'oneToMany') {
        relationKinds.oneToMany = true
      } else if (t.kind === 'manyToMany') {
        relationKinds.manyToMany = true
      } else if (t.kind === 'oneToOne') {
        relationKinds.oneToOne = true
      }
    }
  }
  if (relationKinds.manyToOne) imports.add('manyToOne')
  if (relationKinds.oneToMany) imports.add('oneToMany')
  if (relationKinds.manyToMany) imports.add('manyToMany')
  if (relationKinds.oneToOne) imports.add('oneToOne')

  const lines: string[] = []
  lines.push(`import { ${[...imports].sort().join(', ')} } from '@vinctus/oql-typed'`)
  lines.push('')

  // Enum type exports
  for (const e of dm.enums) {
    const vals = e.values.map((v) => `'${v}'`).join(' | ')
    lines.push(`export type ${e.name} = ${vals}`)
  }
  if (dm.enums.length > 0) lines.push('')

  // Collect junction tables from manyToMany — but only auto-generate ones
  // that aren't already defined in the DM.
  const explicitEntityNames = new Set(dm.entities.map((e) => e.name))
  const junctions = new Map<string, { from: string; to: string }>()
  for (const ent of dm.entities) {
    for (const f of ent.fields) {
      if (f.type.kind === 'manyToMany' && !junctions.has(f.type.junction) && !explicitEntityNames.has(f.type.junction)) {
        junctions.set(f.type.junction, { from: ent.name, to: f.type.target })
      }
    }
  }

  // The single schema export
  lines.push('export const schema = defineSchema({')
  for (const ent of dm.entities) {
    const tableArg = ent.tableName ? `'${ent.tableName}', ` : ''
    lines.push(`  ${ent.name}: entity(${tableArg}{`)
    for (const f of ent.fields) {
      const fieldLine = generateFieldLine(f, enumNames, enumValues)
      // Handle multi-line field (e.g., long enum values)
      if (fieldLine.includes('\n')) {
        const parts = fieldLine.split('\n')
        lines.push(`    ${parts[0]}`)
        for (let i = 1; i < parts.length - 1; i++) lines.push(`    ${parts[i]}`)
        lines.push(`    ${parts[parts.length - 1]},`)
      } else {
        lines.push(`    ${fieldLine},`)
      }
    }
    lines.push(`  }),`)
  }

  // Junction entities (referenced by manyToMany)
  for (const [junction, { from, to }] of junctions) {
    lines.push(`  ${junction}: entity({`)
    lines.push(`    ${from}: manyToOne('${from}', { column: '${from}_id' }),`)
    lines.push(`    ${to}: manyToOne('${to}', { column: '${to}_id' }),`)
    lines.push(`  }),`)
  }

  lines.push('})')
  lines.push('')

  return lines.join('\n')
}

function generateFieldLine(
  f: ParsedField,
  enumNames: Set<string>,
  enumValues: Map<string, readonly string[]>,
): string {
  let expr = ''
  const t = f.type
  switch (t.kind) {
    case 'primitive': {
      if (t.typeName === 'decimal') {
        const args =
          t.precision !== undefined
            ? t.scale !== undefined
              ? `${t.precision}, ${t.scale}`
              : `${t.precision}`
            : ''
        expr = `decimal(${args})`
      } else {
        expr = PRIMITIVE_BUILDER[t.typeName] ?? 'text()'
      }
      break
    }
    case 'enum': {
      expr = enumTypeExpr(f.name, t.enumName, enumValues.get(t.enumName) ?? [])
      break
    }
    case 'manyToOne': {
      if (enumNames.has(t.target)) {
        expr = enumTypeExpr(f.name, t.target, enumValues.get(t.target) ?? [])
      } else {
        const col = f.columnAlias ? `, { column: '${f.columnAlias}' }` : ''
        expr = `manyToOne('${t.target}'${col})`
      }
      break
    }
    case 'oneToMany':
      expr = `oneToMany('${t.target}')`
      break
    case 'manyToMany':
      expr = `manyToMany('${t.target}', { junction: '${t.junction}' })`
      break
    case 'oneToOne': {
      const ref = t.reference ? `, { reference: '${t.reference}' }` : ''
      expr = `oneToOne('${t.target}'${ref})`
      break
    }
  }

  if (f.isPrimaryKey) expr += '.primaryKey()'
  if (f.columnAlias && t.kind === 'primitive') expr += `.column('${f.columnAlias}')`

  const isEnumRef = t.kind === 'manyToOne' && enumNames.has(t.target)
  const isSimpleScalarOrFK = t.kind === 'primitive' || isEnumRef || t.kind === 'manyToOne'
  if (!f.isRequired && !f.isPrimaryKey && isSimpleScalarOrFK) {
    expr += '.nullable()'
  }

  return `${f.name}: ${expr}`
}

function enumTypeExpr(fieldName: string, enumName: string, vals: readonly string[]): string {
  const valsLit = vals.map((v) => `'${v}'`).join(', ')
  const inline = `enumType<${enumName}>('${enumName}', [${valsLit}])`
  // Full line includes "    " (4-space indent inside the schema) + field name + ": " + expr + ",.nullable()"
  const fullLen = 4 + fieldName.length + 2 + inline.length + 1 + '.nullable()'.length
  if (fullLen <= MAX_LINE_WIDTH) return inline
  // Multi-line format — caller inserts the indent prefix
  return `enumType<${enumName}>('${enumName}', [\n  ${vals.map((v) => `'${v}',`).join('\n  ')}\n])`
}

export function parseDMAndGenerate(dmString: string): string {
  return generateSchemaTS(parseDM(dmString))
}
