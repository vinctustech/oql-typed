// Plain-object AST node builders — the wire format consumed by OQL's `fromJS`
// (core/FromJS.scala). Every node carries a `kind` discriminator. This is a
// leaf module (no imports beyond types) so operators/functions/expressions can
// all depend on it without circular imports.
//
// The rule that keeps this in lock-step with the string path: wherever
// `toOQL()` emits `(...)`, `toAST()` emits a `grouped` node.

export type ASTNode = Record<string, any>

// A scalar value -> literal node. Mirrors what the string path inlines after
// parameter substitution (string / number / boolean / null / Date), so the AST
// path produces the same literal the OQL parser would.
export function litToAST(value: unknown): ASTNode {
  if (value === null || value === undefined) return { kind: 'bool', v: 'NULL' }
  if (typeof value === 'boolean') return { kind: 'bool', v: value ? 'TRUE' : 'FALSE' }
  if (typeof value === 'number')
    return Number.isInteger(value) ? { kind: 'int', v: value } : { kind: 'float', v: value }
  if (typeof value === 'bigint') return { kind: 'int', v: Number(value) }
  if (value instanceof Date) return { kind: 'str', v: value.toISOString() }
  return { kind: 'str', v: String(value) }
}

// A field operand (filter LHS, order key) -> attr / ref / expr node.
//  - OQLExpr (fn / alias / currentTimestamp / ...) -> its own toAST()
//  - manyToOne relation ref -> dotted FK path + ".id"  (matches resolveField)
//  - plain FieldRef -> dotted attribute path
export function fieldRefToAST(field: any): ASTNode {
  if (field && typeof field === 'object' && '__oqlExpr' in field && typeof field.toAST === 'function') {
    return field.toAST()
  }
  if (field && typeof field === 'object' && '__relationRef' in field) {
    const rel = field.builder
    if (rel && rel.relationKind === 'manyToOne') {
      return { kind: 'attr', ids: [...String(field.fieldName).split('.'), 'id'] }
    }
  }
  return { kind: 'attr', ids: String(field.fieldName).split('.') }
}

// Comparison RHS: an OQLExpr emits inline; anything else is a literal.
export function operandToAST(value: unknown): ASTNode {
  if (
    value &&
    typeof value === 'object' &&
    '__oqlExpr' in (value as any) &&
    typeof (value as any).toAST === 'function'
  ) {
    return (value as any).toAST()
  }
  return litToAST(value)
}

// Function-call argument: OQLExpr -> toAST; FieldRef -> attr; else literal.
export function argToAST(arg: any): ASTNode {
  if (arg && typeof arg === 'object') {
    if ('__oqlExpr' in arg && typeof arg.toAST === 'function') return arg.toAST()
    if ('fieldName' in arg) return fieldRefToAST(arg)
  }
  return litToAST(arg)
}

// Left-fold expression nodes into a binary infix chain (a op b op c), matching
// the parser's left-associative grouping.
export function foldInfix(op: string, nodes: ASTNode[]): ASTNode {
  return nodes.reduce(
    (acc: ASTNode | null, n) => (acc === null ? n : { kind: 'infix', op, left: acc, right: n }),
    null,
  ) as ASTNode
}

// A sub-projection's `where` (a single FilterArg) -> expr node. Mirrors
// `and(filter)` for one argument: a FilterExpr emits its toAST(), a bare
// boolean FieldRef becomes a truthy attribute predicate.
export function whereToAST(where: any): ASTNode {
  if (where && typeof where === 'object' && '__filterExpr' in where) return where.toAST()
  return fieldRefToAST(where)
}

function isFilteredSpec(v: any): boolean {
  return v !== null && typeof v === 'object' && !Array.isArray(v) && 'fields' in v
}

// Variadic projection args -> array of project nodes. Parallels buildProjection
// (the string form) in query.ts / query-builder.ts.
export function buildProjectionAST(args: readonly any[]): ASTNode[] {
  const out: ASTNode[] = []
  for (const arg of args) {
    if (typeof arg === 'string') {
      out.push({ kind: 'field', name: arg })
    } else if (arg && typeof arg === 'object' && '__oqlExpr' in arg && typeof arg.toAST === 'function') {
      // alias() / aliasedRelation() in projection position already yield a
      // project node ({kind:'expr'} / {kind:'rel'}).
      out.push(arg.toAST())
    } else if (arg && typeof arg === 'object') {
      for (const [key, value] of Object.entries(arg as Record<string, any>)) {
        if (isFilteredSpec(value)) {
          const fields = Array.isArray(value.fields) ? value.fields : [value.fields]
          const node: ASTNode = { kind: 'rel', label: key, source: key, project: buildProjectionAST(fields) }
          if (value.where) node.select = whereToAST(value.where)
          if (value.orderBy && value.orderBy.length > 0) node.order = value.orderBy.map((o: any) => o.toAST())
          out.push(node)
        } else if (Array.isArray(value) && value.length > 0) {
          out.push({ kind: 'rel', label: key, source: key, project: buildProjectionAST(value) })
        } else if (typeof value === 'string') {
          out.push({ kind: 'rel', label: key, source: key, project: buildProjectionAST([value]) })
        } else {
          out.push({ kind: 'field', name: key })
        }
      }
    }
  }
  return out
}
