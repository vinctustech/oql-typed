// TODO(rewrite): rebuild parseDM + generateSchemaTS for the schema-object output.
// The generated TypeScript will be a single `export const schema = defineSchema({ ... })`
// rather than many individual entity exports — this eliminates circular-reference
// issues entirely.

export interface ParsedDataModel {
  enums: Array<{ name: string; values: readonly string[] }>
  entities: Array<{ name: string; tableName?: string; fields: unknown[] }>
}

export function parseDM(_input: string): ParsedDataModel {
  throw new Error('parseDM is being rewritten for the schema-object API')
}

export function generateSchemaTS(_dm: ParsedDataModel): string {
  throw new Error('generateSchemaTS is being rewritten for the schema-object API')
}

export function parseDMAndGenerate(_dmString: string): string {
  throw new Error('parseDMAndGenerate is being rewritten for the schema-object API')
}
