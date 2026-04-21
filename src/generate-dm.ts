// TODO(rewrite): rebuild generateDM() to produce .dm strings from a schema object.
// The new Schema type uses string-literal relation targets, so this becomes a
// straightforward traversal of schema[name].definition[field].
export function generateDM(): string {
  throw new Error('generateDM is being rewritten for the schema-object API')
}
