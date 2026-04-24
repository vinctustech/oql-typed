// Prototype for the schema-object redesign.
// Goal: prove that TypeScript resolves types correctly under strict mode
// for (a) direct field access, (b) dotted paths through manyToOne relations,
// (c) circular cross-references, with ZERO @ts-nocheck / @ts-ignore.
//
// Run: npx tsc --strict --noEmit prototype/proto.ts

// ══════════════════════════════════════════════════════════════════════
// CORE TYPES — the library's type plumbing
// ══════════════════════════════════════════════════════════════════════

// Column types
interface Column<T, Nullable extends boolean = false, PK extends boolean = false> {
  readonly __kind: 'column'
  readonly _type: T
  readonly _nullable: Nullable
  readonly _pk: PK
  readonly columnKind: string
  readonly isNullable: Nullable
  readonly isPrimaryKey: PK
  readonly columnAlias?: string

  primaryKey(): Column<T, Nullable, true>
  nullable(): Column<T, true, PK>
  column(alias: string): Column<T, Nullable, PK>
}

// Relation types — KEY INSIGHT: target is a string literal, not a TS reference.
type RelationKind = 'manyToOne' | 'oneToMany' | 'manyToMany' | 'oneToOne'

interface Relation<Target extends string, Kind extends RelationKind, Nullable extends boolean = false> {
  readonly __kind: 'relation'
  readonly target: Target        // <- string literal type; no cycle possible
  readonly relationKind: Kind
  readonly isNullable: Nullable
  readonly column?: string
  readonly junction?: string
  readonly reference?: string

  nullable(): Relation<Target, Kind, true>
}

// Schema = entity name → { field name → Column | Relation }
type Entity = Record<string, Column<any, any, any> | Relation<any, any, any>>
type Schema = Record<string, Entity>

// ══════════════════════════════════════════════════════════════════════
// FIELD REFS — what you get from db.user.id
// ══════════════════════════════════════════════════════════════════════

interface FieldRef<T = unknown> {
  readonly __fieldRef: true
  readonly _type: T
  readonly entityName: string
  readonly fieldName: string
}

// Relation ref for oneToMany/manyToMany/oneToOne
interface RelationRef<S extends Schema, Target extends keyof S, Kind extends RelationKind> {
  readonly __relationRef: true
  readonly _schema: S
  readonly _target: Target
  readonly _kind: Kind
  readonly entityName: string
  readonly fieldName: string
}

// Many-to-one relation ref INCLUDES the target entity's field refs, so
// db.user.account.id works: .account resolves to this type, and TS then
// looks up .id via FieldRefsFor<S, 'account'>.
type ManyToOneRef<S extends Schema, Target extends keyof S> =
  RelationRef<S, Target, 'manyToOne'> & FieldRefsFor<S, Target>

// Map an entity's fields to the appropriate ref type
type FieldRefsFor<S extends Schema, Name extends keyof S> = {
  readonly [K in keyof S[Name]]:
    S[Name][K] extends Column<infer T, infer N, any>
      ? FieldRef<N extends true ? T | null : T>
      : S[Name][K] extends Relation<infer Target, infer Kind, any>
        ? Target extends keyof S
          ? Kind extends 'manyToOne'
            ? ManyToOneRef<S, Target>
            : RelationRef<S, Target, Kind>
          : never
        : never
}

// ══════════════════════════════════════════════════════════════════════
// BUILDERS
// ══════════════════════════════════════════════════════════════════════

declare function uuid(): Column<string, false, false>
declare function text(): Column<string, false, false>
declare function boolean_(): Column<boolean, false, false>
declare function integer(): Column<number, false, false>
declare function timestamp(): Column<Date, false, false>

declare function manyToOne<Target extends string>(
  target: Target,
  opts?: { column?: string },
): Relation<Target, 'manyToOne', false>
declare function oneToMany<Target extends string>(target: Target): Relation<Target, 'oneToMany', false>
declare function manyToMany<Target extends string>(
  target: Target,
  opts: { junction: string },
): Relation<Target, 'manyToMany', false>

// Schema factory — returns a typed DB handle where db[entityName] gives FieldRefsFor
declare function typedOQL<S extends Schema>(schema: S): DB<S>

type DB<S extends Schema> = {
  readonly [Name in keyof S]: EntityHandle<S, Name>
}

// The entity handle carries its name + the full schema type, plus field refs
type EntityHandle<S extends Schema, Name extends keyof S> = {
  readonly __entityName: Name
  readonly __schema: S
} & FieldRefsFor<S, Name>

// ══════════════════════════════════════════════════════════════════════
// TEST SCHEMA — circular, multi-entity, exactly like the real thing
// ══════════════════════════════════════════════════════════════════════

const schema = {
  account: {
    id: uuid().primaryKey(),
    name: text(),
    enabled: boolean_(),
    users: oneToMany('user'),
  },
  user: {
    id: uuid().primaryKey(),
    firstName: text().column('first_name'),
    email: text(),
    account: manyToOne('account', { column: 'account_id' }),     // cycle!
    stores: manyToMany('store', { junction: 'users_stores' }),
    lastLoginAt: timestamp().nullable(),
  },
  store: {
    id: uuid().primaryKey(),
    name: text(),
    account: manyToOne('account', { column: 'account_id' }),
    users: manyToMany('user', { junction: 'users_stores' }),
  },
  trip: {
    id: uuid().primaryKey(),
    state: text(),
    store: manyToOne('store', { column: 'store_id' }),
    customer: manyToOne('customer', { column: 'customer_id' }).nullable(),
    returnTripFor: manyToOne('trip', { column: 'return_trip_for_id' }).nullable(),  // self-ref
  },
  customer: {
    id: uuid().primaryKey(),
    firstName: text().column('first_name'),
    store: manyToOne('store', { column: 'store_id' }),
  },
}

const db = typedOQL(schema)

// ══════════════════════════════════════════════════════════════════════
// TYPE ASSERTIONS — these MUST type-check under --strict
// ══════════════════════════════════════════════════════════════════════

type AssertEqual<T, U> = [T] extends [U] ? ([U] extends [T] ? true : false) : false
type AssertTrue<T extends true> = T

// --- Direct column access ---
type _1 = AssertTrue<AssertEqual<typeof db.user.id, FieldRef<string>>>
type _2 = AssertTrue<AssertEqual<typeof db.user.firstName, FieldRef<string>>>
type _3 = AssertTrue<AssertEqual<typeof db.user.lastLoginAt, FieldRef<Date | null>>>
type _4 = AssertTrue<AssertEqual<typeof db.account.enabled, FieldRef<boolean>>>

// --- Dotted path through manyToOne — the key test ---
type _5 = AssertTrue<AssertEqual<typeof db.user.account.id, FieldRef<string>>>
type _6 = AssertTrue<AssertEqual<typeof db.user.account.name, FieldRef<string>>>

// --- Multi-level dotted path ---
type _7 = AssertTrue<AssertEqual<typeof db.trip.store.account.id, FieldRef<string>>>
type _8 = AssertTrue<AssertEqual<typeof db.trip.store.account.name, FieldRef<string>>>

// --- Self-referential manyToOne (trip.returnTripFor → trip) ---
type _9 = AssertTrue<AssertEqual<typeof db.trip.returnTripFor.id, FieldRef<string>>>
type _10 = AssertTrue<AssertEqual<typeof db.trip.returnTripFor.state, FieldRef<string>>>

// --- oneToMany/manyToMany are NOT dotted-path-accessible (correct) ---
// db.account.users  — this is a RelationRef, not a ManyToOneRef, so you can't do .firstName on it
// Uncomment to see the error:
// type _bad = typeof db.account.users.firstName  // should fail

// Negative tests — each @ts-expect-error should be triggered by a real type error
// on the line below. If TypeScript reports "Unused '@ts-expect-error' directive",
// the negative test failed (the misuse compiled silently).

// @ts-expect-error — 'firstName' doesn't exist on oneToMany RelationRef
type _n1 = typeof db.account.users.firstName

// @ts-expect-error — 'bogus' isn't a field on user
type _n2 = typeof db.user.bogus

// @ts-expect-error — 'id' doesn't exist on oneToMany RelationRef (only scalar fields
// and manyToOne relations allow dotted access)
type _n3 = typeof db.account.users.id

// Sink so TypeScript doesn't optimize away the types
export { db, schema }
export type { _1, _2, _3, _4, _5, _6, _7, _8, _9, _10 }
