/**
 * Tests for parseDM → generateSchemaTS codegen.
 * Verifies that generated TypeScript:
 *  - imports only types it uses (and only those)
 *  - uses correct local names (boolean(), bigint() — matched to imports)
 *  - actually compiles when written to disk and type-checked
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import { parseDM, generateSchemaTS } from './parse-dm.js'

describe('codegen: imports', () => {
  it('only imports primitive types actually used', () => {
    const ts = generateSchemaTS(parseDM(`
      entity foo {
        *id: uuid
        name: text!
      }
    `))

    // Should import what's used
    assert.ok(ts.includes('uuid'))
    assert.ok(ts.includes('text'))

    // Should NOT import unused primitives
    assert.ok(!/\b(timestamp|date|time|interval|integer|float|json|boolean|bigint|decimal|textArray|integerArray)\b/.test(ts.split('\n')[0]),
      `Unused imports leaked into: ${ts.split('\n')[0]}`)
  })

  it('imports time when DM uses time type', () => {
    const ts = generateSchemaTS(parseDM(`
      entity slot {
        *id: uuid
        startTime (start_time): time!
      }
    `))
    assert.ok(ts.split('\n')[0].includes('time'), `Expected 'time' import in: ${ts.split('\n')[0]}`)
  })

  it('imports interval when DM uses interval', () => {
    const ts = generateSchemaTS(parseDM(`
      entity job {
        *id: uuid
        duration: interval!
      }
    `))
    assert.ok(ts.split('\n')[0].includes('interval'), `Expected 'interval' import in: ${ts.split('\n')[0]}`)
  })

  it('imports boolean as alias and emits boolean() calls', () => {
    const ts = generateSchemaTS(parseDM(`
      entity foo {
        *id: uuid
        enabled: bool!
      }
    `))
    assert.ok(ts.includes('boolean_ as boolean'), `Expected aliased import in: ${ts}`)
    assert.ok(ts.includes('enabled: boolean()'), `Expected boolean() call in: ${ts}`)
    // Must NOT emit boolean_() since it's not in scope
    assert.ok(!ts.includes('boolean_()'), `Should not emit boolean_() — local name is boolean: ${ts}`)
  })

  it('imports bigint as alias and emits bigint() calls', () => {
    const ts = generateSchemaTS(parseDM(`
      entity foo {
        *id: uuid
        count: bigint!
      }
    `))
    assert.ok(ts.includes('bigint_ as bigint'), `Expected aliased import in: ${ts}`)
    assert.ok(ts.includes('count: bigint()'), `Expected bigint() call in: ${ts}`)
    assert.ok(!ts.includes('bigint_()'), `Should not emit bigint_(): ${ts}`)
  })

  it('handles oneToMany with reverse reference: [target].field', () => {
    const ts = generateSchemaTS(parseDM(`
      entity place {
        *id: uuid
        steps: [step].place
      }
      entity step {
        *id: uuid
        place (place_id): place
      }
    `))
    assert.ok(ts.includes('steps: oneToMany(() => step)'), `Expected oneToMany in: ${ts}`)
  })

  it('handles oneToOne with reverse reference: <target>.field', () => {
    const ts = generateSchemaTS(parseDM(`
      entity user {
        *id: uuid
        vehicle: <vehicle>.driver
      }
      entity vehicle {
        *id: uuid
        driver (driver_id): user
      }
    `))
    assert.ok(ts.includes("vehicle: oneToOne(() => vehicle, { reference: 'driver' })"),
      `Expected oneToOne with reference in: ${ts}`)
  })
})

describe('codegen: end-to-end compilation', () => {
  it('generated TypeScript compiles for a complex DM', () => {
    // Mirrors a realistic schema with all field types
    const dm = `
      enum Role { ADMIN DRIVER }

      entity account (accounts) {
        *id: uuid
        name: text!
        enabled: bool!
        plan: text!
        seatLimit (seat_limit): bigint
        createdAt (created_at): timestamp!
        users: [user]
      }

      entity user (users) {
        *id: uuid
        firstName (first_name): text!
        email: text!
        role: Role!
        active: bool!
        loginHour (login_hour): time
        sessionLength (session_length): interval
        account (account_id): account!
        stores: [store] (users_stores)
        vehicle: <vehicle>.driver
      }

      entity store (stores) {
        *id: uuid
        name: text!
        users: [user] (users_stores)
      }

      entity users_stores {
        user (user_id): user
        store (store_id): store
      }

      entity vehicle (vehicles) {
        *id: uuid
        make: text!
        driver (driver_id): user
      }
    `

    const ts = generateSchemaTS(parseDM(dm))

    // Write to a temp file and run tsc on it via a tsconfig
    const dir = mkdtempSync(join(tmpdir(), 'oql-typed-codegen-'))
    const repoRoot = process.cwd()
    try {
      const file = join(dir, 'schema.ts')
      writeFileSync(file, ts)

      // Map @vinctus/oql-typed → this repo's src/index.ts via tsconfig paths.
      // Settings mirror what real consumers use (e.g., shuttlecontrol-api with strict mode
      // but moduleResolution: bundler/node, where circular entity refs are tolerated as `any`).
      const tsconfig = {
        compilerOptions: {
          target: 'ES2022',
          module: 'Node16',
          moduleResolution: 'Node16',
          strict: true,
          noImplicitAny: false, // entity-to-entity circular refs need explicit types we don't generate yet
          esModuleInterop: true,
          skipLibCheck: true,
          noEmit: true,
          baseUrl: repoRoot,
          paths: {
            '@vinctus/oql-typed': ['src/index.ts'],
          },
        },
        include: [file],
      }
      // Mark temp dir as ESM so Node16 module resolution works with .ts file
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ type: 'module' }))
      const tsconfigPath = join(dir, 'tsconfig.json')
      writeFileSync(tsconfigPath, JSON.stringify(tsconfig, null, 2))

      try {
        execSync(`npx tsc --project ${tsconfigPath}`, { encoding: 'utf-8', stdio: 'pipe' })
      } catch (e: any) {
        const out = (e.stdout || '') + (e.stderr || '')
        assert.fail(`Generated TypeScript failed to compile:\n${out}\n\nGenerated:\n${ts}`)
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
