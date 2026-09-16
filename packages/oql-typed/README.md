# @vinctus/oql-typed

Compile-time typed queries for [OQL](https://github.com/vinctustech/oql). Define your data model in TypeScript and get fully inferred result types — no manual type parameters needed.

## Install

```bash
npm install @vinctus/oql-typed
```

That's everything for PostgreSQL — the driver comes along as a dependency, and the schema you declare in TypeScript is the only data model (no `.dm` file).

For the in-memory backend used in tests, add the optional peer:

```bash
npm install --save-dev @vinctus/oql-petradb
```

## Quick Start

### 1. Define your schema

Wrap a single schema object with `defineSchema(...)`. The **entity name** is the object key — relations reference other entities by that string literal.

```typescript
import {
  defineSchema, entity,
  uuid, text, integer, boolean, timestamp, float,
  manyToOne, oneToMany, manyToMany, oneToOne, enumType,
} from '@vinctus/oql-typed'

export type Role = 'ADMIN' | 'DISPATCHER' | 'DRIVER'

export const schema = defineSchema({
  account: entity('accounts', {
    id:      uuid().primaryKey(),
    name:    text(),
    enabled: boolean(),
    plan:    text(),
    users:   oneToMany('user'),
    stores:  oneToMany('store'),
  }),

  store: entity('stores', {
    id:      uuid().primaryKey(),
    name:    text(),
    enabled: boolean(),
    account: manyToOne('account', { column: 'account_id' }),
    users:   manyToMany('user', { junction: 'users_stores' }),
  }),

  user: entity('users', {
    id:          uuid().primaryKey(),
    firstName:   text().column('first_name'),
    lastName:    text().column('last_name'),
    email:       text(),
    role:        enumType<Role>('Role', ['ADMIN', 'DISPATCHER', 'DRIVER']),
    enabled:     boolean(),
    lastLoginAt: timestamp().column('last_login_at').nullable(),
    account:     manyToOne('account', { column: 'account_id' }),
    stores:      manyToMany('store', { junction: 'users_stores' }),
  }),
})
```

### 2. Open the database

`createPostgresDB` derives the OQL data model from the schema and builds the backend:

```typescript
import { createPostgresDB } from '@vinctus/oql-typed'
import { schema } from './schema.js'

export const db = createPostgresDB(schema, {
  host,
  port,
  database,
  user,
  password,
  // ssl: false, idleTimeoutMillis: 7200000, max: 10  ← defaults
})

// on shutdown
db.close()
```

In tests, swap the factory and keep everything else:

```typescript
import { createPetraDB } from '@vinctus/oql-typed'
import { schema } from './schema.js'

const db = createPetraDB(schema)   // requires the optional @vinctus/oql-petradb peer
```

If you need to construct the OQL instance yourself, `typedOQL(instance, schema)` is the escape hatch, and `generateDM(schema)` gives you the data-model string it needs:

```typescript
import { typedOQL, generateDM } from '@vinctus/oql-typed'
import { OQL_PG } from '@vinctus/oql-pg'

const instance = new OQL_PG(generateDM(schema), host, port, database, user, password, false, 7200000, 10)
export const db = typedOQL(instance, schema)
```

### 3. Write typed queries

```typescript
import { eq, and, inList, ilike, desc } from '@vinctus/oql-typed'

// Result type is inferred from .select() — no manual type parameter.
// db.user.select(...) is shorthand for query(db, 'user').select(...).
const result = await db.user
  .select('id', 'firstName', 'lastName', { account: ['id', 'name'] })
  .findOneById(userId)
// => { id: string, firstName: string, lastName: string, account: { id: string, name: string } } | undefined

// No selection — returns all scalar fields
const accounts = await db.account.many()
// => { id: string, name: string, enabled: boolean, plan: string }[]

// Naming: methods without "One" are chainable filters; methods with "One" auto-terminate
// .findBy()      — chainable sugar for .where(eq(...))
// .findIn()      — chainable sugar for .where(inList(...))
// .findOneBy()   — terminal sugar for .where(eq(...)).one()
// .findOneById() — terminal PK lookup
const drivers = await db.user
  .findBy(db.user.role, 'DRIVER')
  .findIn(db.user.enabled, [true])
  .many()

const alice = await db.user.findOneBy(db.user.email, 'alice@example.com')
```

## What the compiler catches

```typescript
db.user.select('id', 'fistName')           // ✗ misspelled field
eq(db.user.enabled, 'yes')                  // ✗ wrong type (boolean expected)
eq(db.user.role, 'SUPERADMIN')              // ✗ invalid enum value
ilike(db.user.enabled, '%test%')            // ✗ ilike requires string field

const u = await db.user.select('id').one()
u?.firstName                                // ✗ not in projection
```

## Selection

Scalars as string args, relations as objects:

```typescript
.select('id', 'name')                                                      // scalars
.select('id', { account: ['id', 'name'] })                                 // simple relation
.select('id', { stores: ['id', 'name', { place: ['lat', 'lng'] }] })       // nested
.select('id', { account: 'name' })                                         // single-field shorthand
```

### Reusable projections

Share one projection across queries with `projection(handle, ...fields)` — spread the result into `.select()` with full inference and no `as const`:

```typescript
import { projection } from '@vinctus/oql-typed'

const userFields = projection(db.user, 'id', 'firstName', { account: ['id', 'name'] })

await query(db, 'user').select(...userFields).many()
await query(db, 'user').select(...userFields, 'email').many()   // extend inline
```

A bare `const fields = ['id', 'firstName']` widens to `string[]` and loses the exact names inference needs; `projection()`'s `const` type parameter keeps them — type-checked against the entity, no assertion.

### Filtered sub-collections

Add `where`, `orderBy`, `limit`, and `offset` to a nested relation. `limit`/`offset` paginate a to-many relation just like the top-level builder (emitted as `|limit, offset|` after `orderBy`); the result type stays `T[]`:

```typescript
.select('id', 'name', {
  trips: {
    fields: ['id', 'state', 'seats'],
    where: ne(db.trip.state, 'COMPLETED'),
    orderBy: [desc(db.trip.createdAt)],
    limit: 10,                               // the 10 most recent per row
    offset: 0,
  },
})
```

### Dotted paths on `manyToOne`

Access fields on related entities directly in filters:

```typescript
.where(and(
  eq(db.trip.store.account.name, accountName), // multi-level path — joins accounts
  inList(db.trip.store, storeIds),             // the relation itself — no join
))
```

Comparing the **relation itself** (`db.trip.store`) reads the foreign-key column
on the row — OQL's `&store` — instead of joining the target table to read its
primary key. Same rows, but the database can use an index on that column, so
prefer it over the `.id` path whenever you are matching by key:

```oql
trip [store.account.name = :p0 AND &store IN :p1]
```

## Operators

| Operator | Example |
|----------|---------|
| `eq`, `ne`, `gt`, `gte`, `lt`, `lte` | `eq(db.user.enabled, true)` |
| `and`, `or`, `not` | `and(eq(...), or(...))` |
| `inList`, `notInList` | `inList(db.user.role, ['ADMIN', 'DRIVER'])` |
| `arrayContains` (scalar in array column) | `arrayContains(db.zone.tags, 'vip')` → `:p = ANY(tags)` |
| `like`, `ilike` | `ilike(db.user.firstName, '%john%')` |
| `between` | `between(db.user.lastLoginAt, start, end)` |
| `isNull`, `isNotNull` | `isNull(db.trip.vehicle)` |
| `exists` | `exists(db.user.stores, eq(db.store.id, storeId))` |
| `asc`, `desc` (optional NULLS) | `desc(db.user.lastLoginAt)`, `asc(db.trip.scheduledAt, 'last')` |

## Expressions

For OQL features beyond plain field comparisons:

```typescript
import { fn, ref, subquery, alias, aliasedRelation, caseWhen, currentTimestamp } from '@vinctus/oql-typed'
import { lower, upper, trim, length, concat, concatOp, coalesce, count, sum, avg, min, max } from '@vinctus/oql-typed'

// Function call in a filter — fn(name, ...args). Bare strings are parameterized.
ilike(fn('concat', db.vehicle.make, ' ', db.vehicle.model), '%toyota%')

// Indexable concat — use concatOp() for PG `||` (IMMUTABLE, indexable)
ilike(concatOp(db.user.firstName, ' ', db.user.lastName), '%john%')

// Reference operator (&) — the FK column value itself; type inferred from the relation
isNull(ref(db.trip.returnTripFor))                     // → &returnTripFor IS NULL

// Database clock — compare a timestamp column against "now"
lte(db.account.trialEndAt, currentTimestamp())         // → trialEndAt <= CURRENT_TIMESTAMP

// Subquery as a value — projection is a typed expression; the scalar type T is inferred
eq(subquery(db.vehicle.drivers, count('*')), 0)

// Aliased projection — label: (expression)
db.trip.select('id', alias('returnTripId', db.trip.returnTripFor.id))

// Aliased sub-collection — pass the relation ref; row shape inferred, fields type-checked
db.user.select('id', aliasedRelation('shifts', db.user.trips, {
  fields: ['id', 'state'],
  where: eq(db.trip.state, 'CONFIRMED'),
}))

// CASE expression — caseWhen(branches, else?). With `else` → T; without → T | null.
db.trip.select('id', alias('priority', caseWhen(
  [{ when: eq(db.trip.state, 'COMPLETED'), then: 2 }],
  0,
)))
```

## Mutations

Mutations are methods on every entity handle — `db.<entity>.insert/update/delete/bulkDelete/bulkUpdate/link/unlink`:

```typescript
// db.<entity>.insert(input) — typed input (required/optional fields), returns full row
const newUser = await db.user.insert({
  id:        crypto.randomUUID(),
  firstName: 'Alice',
  lastName:  'Smith',
  email:     'alice@example.com',
  role:      'ADMIN',
  enabled:   true,
  account:   accountId,                              // manyToOne FK
  // lastLoginAt omitted — it's nullable
})
// => { id: string, firstName: string, ..., lastLoginAt: Date | null }

// db.<entity>.update(id, patch) — all patch fields optional
const updated = await db.user.update(userId, {
  firstName: 'Alicia',
})
// => { id: string, firstName: string }

// db.<entity>.delete(id) — remove one row by primary key
await db.user.delete(userId)

// db.<entity>.bulkDelete(ids) — remove many rows by primary key
await db.user.bulkDelete([userId, otherUserId])

// db.<entity>.bulkUpdate(updates) — patch many rows from [id, patch] pairs.
// Every patch must set the same fields; only the values differ.
await db.user.bulkUpdate([
  [userId, { enabled: false }],
  [otherUserId, { enabled: true }],
])

// db.<entity>.link/unlink(id, relation, targetId) — add or remove one row of a
// manyToMany junction table. `relation` only accepts manyToMany field names.
await db.user.link(userId, 'stores', storeId)
await db.user.unlink(userId, 'stores', storeId)
```

## Conditional QueryBuilder

For dynamic filtering (paginated lists with optional search/role/etc.):

```typescript
import { queryBuilder } from '@vinctus/oql-typed'

const results = await queryBuilder(db, 'user')
  .select('id', 'firstName', 'role')
  .where(eq(db.user.enabled, true))
  .cond(role, eq(db.user.role, role))                     // applied if `role` is truthy
  .cond(search, ilike(db.user.firstName, `%${search}%`))
  .orderBy(desc(db.user.lastLoginAt))
  .limit(size)
  .offset(page * size)
  .many()
```

## Query API

```typescript
query(db, 'user')           // or just: db.user
  .select(...)              // Optional — fields and relations
  .where(filter)            // Optional — single filter expression
  .findBy(col, v)           // Optional — sugar for .where(eq(col, v)); chains AND
  .findIn(col, vs)          // Optional — sugar for .where(inList(col, vs)); chains AND
  .orderBy(asc(f), ...)     // Optional — sort
  .limit(n)                 // Optional
  .offset(n)                // Optional
  .one()                    // → T | undefined
  .many()                   // → T[]
  .count()                  // → number
  .findOneBy(col, v)        // → T | undefined (terminal — auto-runs .one())
  .findOneById(id)          // → T | undefined (terminal — auto-runs .one())
  .toOQL()                  // → { queryStr, params } — no execution
```

## Schema reference

| Function | Description |
|----------|-------------|
| `defineSchema({ name: entity(...), ... })` | Top-level schema wrapper |
| `entity(fields)` / `entity(tableName, fields)` | Define an entity (entity name comes from the `defineSchema` key) |
| `uuid()`, `text()`, `integer()`, `bigint()`, `float()`, `boolean()`, `timestamp()`, `date()`, `time()`, `interval()`, `json<T>()` | Column types |
| `textArray()`, `integerArray()`, `decimal(p?, s?)` | Array & decimal columns |
| `enumType<T>(name, values)` | Typed enum column |
| `manyToOne(target, { column })` | FK relation (supports dotted paths) |
| `oneToMany(target, { reference? })` | Reverse FK (array) |
| `manyToMany(target, { junction })` | Junction-table relation (array) |
| `oneToOne(target, { reference? })` | One-to-one |

Column modifiers: `.primaryKey()`, `.nullable()`, `.column('db_alias')`

## Migrating from an existing `.dm` file

One-time conversion of a data-model file into a TypeScript schema:

```bash
npx oql-typed-codegen schema.dm src/schema.generated.ts
```

Or programmatically:

```typescript
import { parseDMAndGenerate } from '@vinctus/oql-typed'

const tsSource = parseDMAndGenerate(dmString)
```

The generated file uses `defineSchema(...)` and string-literal relation targets, identical to the hand-written form. Check it in, then retire the `.dm` file: the schema object is the source of truth from then on, and `generateDM(schema)` regenerates the model whenever the backend needs it.
