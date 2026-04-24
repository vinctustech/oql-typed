/**
 * Codegen tests for the v2 schema-object output.
 *
 * End-to-end test writes generated TS to disk and runs tsc on it — proves
 * generated code compiles under the same strict settings real consumers use.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import { parseDM, generateSchemaTS } from './parse-dm.js'

describe('codegen: parser', () => {
  it('parses a minimal entity', () => {
    const dm = parseDM('entity foo { *id: uuid }')
    assert.equal(dm.entities.length, 1)
    assert.equal(dm.entities[0].name, 'foo')
    assert.equal(dm.entities[0].fields[0].name, 'id')
    assert.equal(dm.entities[0].fields[0].isPrimaryKey, true)
  })

  it('parses entity with table alias', () => {
    const dm = parseDM('entity foo (foos) { *id: uuid }')
    assert.equal(dm.entities[0].tableName, 'foos')
  })

  it('parses manyToOne with column alias', () => {
    const dm = parseDM('entity foo { *id: uuid\n bar (bar_id): bar! }')
    const bar = dm.entities[0].fields[1]
    assert.equal(bar.type.kind, 'manyToOne')
    assert.equal(bar.columnAlias, 'bar_id')
    assert.equal(bar.isRequired, true)
  })

  it('parses oneToMany with reverse-ref suffix', () => {
    const dm = parseDM('entity foo { *id: uuid\n bars: [bar].foo }')
    assert.equal(dm.entities[0].fields[1].type.kind, 'oneToMany')
  })

  it('parses manyToMany with junction', () => {
    const dm = parseDM('entity foo { *id: uuid\n bars: [bar] (foo_bars) }')
    const bars = dm.entities[0].fields[1]
    assert.equal(bars.type.kind, 'manyToMany')
    if (bars.type.kind === 'manyToMany') assert.equal(bars.type.junction, 'foo_bars')
  })

  it('parses oneToOne with reference', () => {
    const dm = parseDM('entity foo { *id: uuid\n bar: <bar>.foo }')
    const bar = dm.entities[0].fields[1]
    assert.equal(bar.type.kind, 'oneToOne')
    if (bar.type.kind === 'oneToOne') assert.equal(bar.type.reference, 'foo')
  })

  it('parses enum', () => {
    const dm = parseDM("enum Role { 'ADMIN' 'DRIVER' }")
    assert.deepEqual([...dm.enums[0].values], ['ADMIN', 'DRIVER'])
  })
})

describe('codegen: output format', () => {
  it('emits defineSchema wrapper', () => {
    const ts = generateSchemaTS(parseDM('entity foo { *id: uuid }'))
    assert.ok(ts.includes('export const schema = defineSchema({'))
    assert.ok(ts.includes("from '@vinctus/oql-typed'"))
  })

  it('wraps entities with entity() and table name', () => {
    const ts = generateSchemaTS(parseDM('entity user (users) { *id: uuid\n name: text! }'))
    assert.ok(ts.includes("user: entity('users', {"))
  })

  it('wraps entities without table name when not provided', () => {
    const ts = generateSchemaTS(parseDM('entity foo { *id: uuid }'))
    assert.ok(ts.includes('foo: entity({'))
  })

  it('relations use string literal targets', () => {
    const ts = generateSchemaTS(parseDM('entity user { *id: uuid\n account (account_id): account! }'))
    assert.ok(ts.includes("manyToOne('account', { column: 'account_id' })"))
  })

  it('does NOT emit @ts-nocheck', () => {
    const ts = generateSchemaTS(parseDM('entity foo { *id: uuid }'))
    assert.ok(!ts.includes('@ts-nocheck'), `@ts-nocheck should not appear: ${ts}`)
  })

  it('only imports what is used', () => {
    const ts = generateSchemaTS(parseDM('entity foo { *id: uuid\n name: text! }'))
    const importLine = ts.split('\n')[0]
    assert.ok(importLine.includes('uuid'))
    assert.ok(importLine.includes('text'))
    assert.ok(!importLine.includes('manyToOne'))
    assert.ok(!importLine.includes('timestamp'))
    assert.ok(!importLine.includes('boolean'))
  })

  it('imports boolean (not boolean_)', () => {
    const ts = generateSchemaTS(parseDM('entity foo { *id: uuid\n active: bool! }'))
    const importLine = ts.split('\n')[0]
    assert.ok(importLine.includes('boolean'))
    assert.ok(!importLine.includes('boolean_'))
    assert.ok(ts.includes('active: boolean()'))
  })

  it('emits enum with values and type alias', () => {
    const ts = generateSchemaTS(parseDM(`
      enum Role { ADMIN DRIVER }
      entity user { *id: uuid\n role: Role! }
    `))
    assert.ok(ts.includes("export type Role = 'ADMIN' | 'DRIVER'"))
    assert.ok(ts.includes("role: enumType<Role>('Role', ['ADMIN', 'DRIVER'])"))
  })

  it('breaks long enum values across lines', () => {
    const ts = generateSchemaTS(parseDM(`
      enum TripOptimizationHeuristic { MINIMIZE_DISTANCE MINIMIZE_DURATION }
      entity store {
        *id: uuid
        tripOptimizationHeuristic (trip_optimization_heuristic): TripOptimizationHeuristic!
      }
    `))
    for (const line of ts.split('\n')) {
      assert.ok(line.length <= 120, `Line exceeds 120 chars: ${line}`)
    }
  })

  it('generates junction table entities for manyToMany', () => {
    const ts = generateSchemaTS(parseDM(`
      entity user { *id: uuid\n stores: [store] (users_stores) }
      entity store { *id: uuid }
    `))
    assert.ok(ts.includes('users_stores: entity({'))
    assert.ok(ts.includes("user: manyToOne('user', { column: 'user_id' })"))
    assert.ok(ts.includes("store: manyToOne('store', { column: 'store_id' })"))
  })

  it('nullable fields get .nullable() for scalars and manyToOne', () => {
    const ts = generateSchemaTS(parseDM(`
      entity foo {
        *id: uuid
        name: text
        bar (bar_id): bar
      }
      entity bar { *id: uuid }
    `))
    assert.ok(ts.includes('name: text().nullable()'), `Expected nullable scalar: ${ts}`)
    assert.ok(ts.includes("manyToOne('bar', { column: 'bar_id' }).nullable()"), `Expected nullable FK: ${ts}`)
  })
})

describe('codegen: end-to-end compilation', () => {
  it('generated TypeScript compiles cleanly under strict mode', () => {
    // Complex DM mirroring real-world shape
    const dm = `
      enum Role { ADMIN DRIVER }
      entity account (accounts) {
        *id: uuid
        name: text!
        users: [user]
      }
      entity user (users) {
        *id: uuid
        firstName (first_name): text!
        role: Role!
        account (account_id): account!
        stores: [store] (users_stores)
        vehicle: <vehicle>.driver
      }
      entity store (stores) {
        *id: uuid
        name: text!
        users: [user] (users_stores)
      }
      entity vehicle (vehicles) {
        *id: uuid
        make: text!
        driver (driver_id): user
      }
    `
    const ts = generateSchemaTS(parseDM(dm))

    const dir = mkdtempSync(join(tmpdir(), 'oql-typed-codegen-'))
    const repoRoot = process.cwd()
    try {
      const file = join(dir, 'schema.ts')
      writeFileSync(file, ts)
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ type: 'module' }))

      // Use strict mode — no noImplicitAny escape hatch this time
      const tsconfig = {
        compilerOptions: {
          target: 'ES2022',
          module: 'Node16',
          moduleResolution: 'Node16',
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
          noEmit: true,
          baseUrl: repoRoot,
          paths: { '@vinctus/oql-typed': ['src/index.ts'] },
        },
        include: [file],
      }
      const tsconfigPath = join(dir, 'tsconfig.json')
      writeFileSync(tsconfigPath, JSON.stringify(tsconfig, null, 2))

      try {
        execSync(`npx tsc --project ${tsconfigPath}`, { encoding: 'utf-8', stdio: 'pipe' })
      } catch (e: any) {
        const out = (e.stdout || '') + (e.stderr || '')
        assert.fail(`Generated TS failed to compile under --strict:\n${out}\n\nGenerated:\n${ts}`)
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
