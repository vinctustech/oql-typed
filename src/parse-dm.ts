// ── Parse .dm string and generate TypeScript schema source code ──

// -- Tokenizer --

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
    if (/\s/.test(input[i])) {
      i++
      continue
    }

    if (input[i] === '/' && input[i + 1] === '/') {
      while (i < input.length && input[i] !== '\n') i++
      continue
    }

    const singleChars: Record<string, TokenType> = {
      '{': '{',
      '}': '}',
      '(': '(',
      ')': ')',
      '[': '[',
      ']': ']',
      '<': '<',
      '>': '>',
      ':': ':',
      '*': '*',
      '!': '!',
      '.': '.',
      ',': ',',
    }

    if (singleChars[input[i]]) {
      tokens.push({ type: singleChars[input[i]], value: input[i], pos: i })
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
      // Handle array type suffix like text[], integer[]
      if (i + 1 < input.length && input[i] === '[' && input[i + 1] === ']') i += 2
      const value = input.substring(start, i)

      if (value === 'enum') {
        tokens.push({ type: 'enum', value, pos: start })
      } else if (value === 'entity') {
        tokens.push({ type: 'entity', value, pos: start })
      } else {
        tokens.push({ type: 'ident', value, pos: start })
      }
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

// -- Parser types --

interface ParsedEnum {
  name: string
  values: string[]
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

// -- Parser --

const PRIMITIVE_TYPES = new Set([
  'uuid',
  'text',
  'integer',
  'int',
  'int4',
  'bigint',
  'int8',
  'float',
  'float8',
  'bool',
  'boolean',
  'timestamp',
  'date',
  'time',
  'interval',
  'json',
  'text[]',
  'integer[]',
  'int[]',
  'boolean[]',
  'bool[]',
  'float[]',
  'uuid[]',
  'timestamp[]',
  'json[]',
  'bigint[]',
  'decimal',
])

class Parser {
  private tokens: Token[]
  private pos = 0

  constructor(tokens: Token[]) {
    this.tokens = tokens
  }

  private peek(): Token {
    return this.tokens[this.pos]
  }

  private advance(): Token {
    return this.tokens[this.pos++]
  }

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
      if (this.peek().type === 'enum') {
        enums.push(this.parseEnum())
      } else if (this.peek().type === 'entity') {
        entities.push(this.parseEntity())
      } else {
        throw new Error(
          `Expected 'enum' or 'entity' but got '${this.peek().value}' at position ${this.peek().pos}`,
        )
      }
    }

    return { enums, entities }
  }

  private parseEnum(): ParsedEnum {
    this.expect('enum')
    const name = this.expect('ident').value
    this.expect('{')

    const values: string[] = []
    while (this.peek().type !== '}') {
      if (this.peek().type === 'string') {
        values.push(this.advance().value)
      } else if (this.peek().type === 'ident') {
        values.push(this.advance().value)
      } else {
        throw new Error(`Unexpected token in enum: ${this.peek().value}`)
      }
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
    while (this.peek().type !== '}') {
      fields.push(this.parseField())
    }
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
    // One-to-one: <EntityName>.reference
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

    // Array relation: [EntityName] or [EntityName] (junction)
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

      return { kind: 'oneToMany', target }
    }

    // Identifier: primitive type or entity reference (manyToOne)
    const typeName = this.expect('ident').value

    // Check for decimal(precision, scale)
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

    if (PRIMITIVE_TYPES.has(typeName)) {
      return { kind: 'primitive', typeName }
    }

    // Could be an enum or a manyToOne relation — resolved during codegen
    return { kind: 'manyToOne', target: typeName }
  }
}

export function parseDM(input: string): ParsedDataModel {
  const tokens = tokenize(input)
  const parser = new Parser(tokens)
  return parser.parse()
}

// -- Code generator --

function normalizeType(typeName: string): { builder: string } {
  const map: Record<string, { builder: string }> = {
    uuid: { builder: 'uuid()' },
    text: { builder: 'text()' },
    integer: { builder: 'integer()' },
    int: { builder: 'integer()' },
    int4: { builder: 'integer()' },
    bigint: { builder: 'bigint_()' },
    int8: { builder: 'bigint_()' },
    float: { builder: 'float()' },
    float8: { builder: 'float()' },
    bool: { builder: 'boolean_()' },
    boolean: { builder: 'boolean_()' },
    timestamp: { builder: 'timestamp()' },
    date: { builder: 'date()' },
    time: { builder: 'time()' },
    interval: { builder: 'interval()' },
    json: { builder: 'json()' },
    'text[]': { builder: 'textArray()' },
    'integer[]': { builder: 'integerArray()' },
    'int[]': { builder: 'integerArray()' },
    'boolean[]': { builder: 'textArray()' },
    'float[]': { builder: 'textArray()' },
    'uuid[]': { builder: 'textArray()' },
    'timestamp[]': { builder: 'textArray()' },
    'json[]': { builder: 'textArray()' },
    'bigint[]': { builder: 'textArray()' },
  }
  return map[typeName] ?? { builder: 'text()' }
}

export function generateSchemaTS(dm: ParsedDataModel): string {
  const lines: string[] = []
  const enumNames = new Set(dm.enums.map((e) => e.name))

  const imports = new Set([
    'entity',
    'text',
    'uuid',
    'integer',
    'float',
    'timestamp',
    'date',
    'json',
    'textArray',
    'manyToOne',
    'oneToMany',
    'manyToMany',
    'oneToOne',
    'enumType',
  ])

  for (const ent of dm.entities) {
    for (const f of ent.fields) {
      if (f.type.kind === 'primitive') {
        if (['bigint', 'int8'].includes(f.type.typeName)) imports.add('bigint_ as bigint')
        if (['bool', 'boolean'].includes(f.type.typeName)) imports.add('boolean_ as boolean')
        if (f.type.typeName === 'decimal') imports.add('decimal')
        if (['integer[]', 'int[]'].includes(f.type.typeName)) imports.add('integerArray')
      }
    }
  }

  lines.push(`import { ${[...imports].join(', ')} } from '@vinctus/oql-typed'`)
  lines.push('')

  for (const e of dm.enums) {
    lines.push(`export type ${e.name} = ${e.values.map((v) => `'${v}'`).join(' | ')}`)
    lines.push('')
  }

  for (const ent of dm.entities) {
    const tableArg = ent.tableName ? `'${ent.name}', '${ent.tableName}'` : `'${ent.name}'`
    lines.push(`export const ${ent.name} = entity(${tableArg}, {`)

    for (const field of ent.fields) {
      lines.push(`  ${generateFieldTS(field, enumNames)},`)
    }

    lines.push('})')
    lines.push('')
  }

  return lines.join('\n')
}

function generateFieldTS(field: ParsedField, enumNames: Set<string>): string {
  let expr: string

  switch (field.type.kind) {
    case 'primitive': {
      if (field.type.typeName === 'decimal') {
        const args =
          field.type.precision !== undefined
            ? field.type.scale !== undefined
              ? `${field.type.precision}, ${field.type.scale}`
              : `${field.type.precision}`
            : ''
        expr = `decimal(${args})`
      } else {
        expr = normalizeType(field.type.typeName).builder
      }
      break
    }
    case 'enum': {
      expr = `enumType<${field.type.enumName}>('${field.type.enumName}', [/* TODO: add values */])`
      break
    }
    case 'manyToOne': {
      if (enumNames.has(field.type.target)) {
        expr = `enumType<${field.type.target}>('${field.type.target}', [/* values defined above */])`
      } else {
        const columnOpt = field.columnAlias ? `, { column: '${field.columnAlias}' }` : ''
        expr = `manyToOne(() => ${field.type.target}${columnOpt})`
      }
      break
    }
    case 'oneToMany': {
      expr = `oneToMany(() => ${field.type.target})`
      break
    }
    case 'manyToMany': {
      expr = `manyToMany(() => ${field.type.target}, { junction: '${field.type.junction}' })`
      break
    }
    case 'oneToOne': {
      const refOpt = field.type.reference ? `, { reference: '${field.type.reference}' }` : ''
      expr = `oneToOne(() => ${field.type.target}${refOpt})`
      break
    }
  }

  if (field.isPrimaryKey) expr += '.primaryKey()'
  if (field.columnAlias && field.type.kind === 'primitive') expr += `.column('${field.columnAlias}')`

  // Nullable: non-required, non-PK fields
  const isEnumRef = field.type.kind === 'manyToOne' && enumNames.has(field.type.target)
  if (!field.isRequired && !field.isPrimaryKey && (field.type.kind === 'primitive' || isEnumRef)) {
    expr += '.nullable()'
  }
  if (!field.isRequired && field.type.kind === 'manyToOne' && !isEnumRef) {
    expr += '.nullable()'
  }

  return `${field.name}: ${expr}`
}

export function parseDMAndGenerate(dmString: string): string {
  const parsed = parseDM(dmString)
  return generateSchemaTS(parsed)
}
