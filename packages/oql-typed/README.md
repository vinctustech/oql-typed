# @vinctus/oql-typed

Compile-time typed queries for [OQL](https://github.com/vinctustech/oql). Define your data model in TypeScript and get fully inferred result types — no manual type parameters needed.

## Install

```bash
npm install @vinctus/oql-typed
```

Requires one of the OQL backends as a peer dependency:

- `@vinctus/oql-pg` — PostgreSQL backend
- `@vinctus/oql-petradb` — In-memory backend (great for tests)

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

### 2. Wrap your OQL instance

```typescript
import { readFileSync } from 'node:fs'
import { typedOQL } from '@vinctus/oql-typed'
import { OQL_PG } from '@vinctus/oql-pg'
import { schema } from './schema.js'

// Keep your schema.dm alongside schema.ts. Use oql-typed-codegen to bootstrap
// schema.ts from schema.dm; see the codegen guide.
const dm = readFileSync(new URL('./schema.dm', import.meta.url), 'utf8')
const oql = new OQL_PG(dm, host, port, database, username, password)

export const db = typedOQL(oql, schema)
```

### 3. Write typed queries

```typescript
import { eq, and, inList, ilike, desc } from '@vinctus/oql-typed'

// Result type is inferred from .select() — no manual type parameter.
// db.user.select(...) is shorthand for query(db, 'user').select(...).
const result = await db.user
  .select('id', 'firstName', 'lastName', { account: ['id', 'name'] })
  .findById(userId)
// => { id: string, firstName: string, lastName: string, account: { id: string, name: string } } | undefined

// No selection — returns all scalar fields
const accounts = await db.account.many()
// => { id: string, name: string, enabled: boolean, plan: string }[]

// Common shortcuts: .findBy() (single eq), .findIn() (IN list) — both chainable AND
const drivers = await db.user
  .findBy(db.user.role, 'DRIVER')
  .findIn(db.user.enabled, [true])
  .many()
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

### Filtered sub-collections

Add `where` and `orderBy` to a nested relation:

```typescript
.select('id', 'name', {
  trips: {
    fields: ['id', 'state', 'seats'],
    where: ne(db.trip.state, 'COMPLETED'),
    orderBy: [desc(db.trip.createdAt)],
  },
})
```

### Dotted paths on `manyToOne`

Access fields on related entities directly in filters:

```typescript
.where(and(
  eq(db.trip.store.account.id, accountId),     // multi-level FK chain
  inList(db.trip.store.id, storeIds),
))
```

## Operators

| Operator | Example |
|----------|---------|
| `eq`, `ne`, `gt`, `gte`, `lt`, `lte` | `eq(db.user.enabled, true)` |
| `and`, `or`, `not` | `and(eq(...), or(...))` |
| `inList`, `notInList` | `inList(db.user.role, ['ADMIN', 'DRIVER'])` |
| `like`, `ilike` | `ilike(db.user.firstName, '%john%')` |
| `between` | `between(db.user.lastLoginAt, start, end)` |
| `isNull`, `isNotNull` | `isNull(db.trip.vehicle)` |
| `exists` | `exists(db.user.stores, eq(db.store.id, storeId))` |
| `asc`, `desc` | `desc(db.user.lastLoginAt)` |

## Expressions

For OQL features beyond plain field comparisons:

```typescript
import { fn, raw, ref, subquery, alias, aliasedRelation } from '@vinctus/oql-typed'
import { lower, upper, trim, length, concat, concatOp, coalesce, count, sum, avg, min, max } from '@vinctus/oql-typed'

// Function call in a filter — fn(name, ...args)
ilike(fn('concat', db.vehicle.make, raw("' '"), db.vehicle.model), '%toyota%')

// Indexable concat — use concatOp() for PG `||` (IMMUTABLE, indexable)
ilike(concatOp(db.user.firstName, raw("' '"), db.user.lastName), '%john%')

// Reference operator (&) — check the FK column itself
isNull(ref(db.trip.returnTripFor))                     // → &returnTripFor IS NULL

// Subquery in a filter — (relation {projection}) op value
eq(subquery<number>(db.vehicle.drivers, ['count(*)']), 0)

// Aliased projection — label: (expression)
db.trip.select('id', alias('returnTripId', db.trip.returnTripFor.id))

// Aliased sub-collection — outer label + typed inner projection
db.user.select('id', aliasedRelation('shifts', 'trips', {
  fields: ['id', 'state'],
  where: eq(db.trip.state, 'CONFIRMED'),
}))

// Raw OQL escape hatch — for anything without a typed wrapper
db.post.select('id', raw('count: sum(seats)'))
```

## Mutations

```typescript
import { insert, update } from '@vinctus/oql-typed'

// insert(db, entityName, input) — typed input (required/optional fields), returns full row
const newUser = await insert(db, 'user', {
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

// update(db, entityName, id, patch) — all patch fields optional
const updated = await update(db, 'user', userId, {
  firstName: 'Alicia',
})
// => { id: string, firstName: string }
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
  .findById(id)             // → T | undefined (auto-terminates with .one())
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
| `oneToMany(target)` | Reverse FK (array) |
| `manyToMany(target, { junction })` | Junction-table relation (array) |
| `oneToOne(target, { reference? })` | One-to-one |

Column modifiers: `.primaryKey()`, `.nullable()`, `.column('db_alias')`

## Bootstrapping from an existing `.dm` file

```bash
npx oql-typed-codegen schema.dm src/schema.generated.ts
```

Or programmatically:

```typescript
import { parseDMAndGenerate } from '@vinctus/oql-typed'

const tsSource = parseDMAndGenerate(dmString)
```

The generated file uses `defineSchema(...)` and string-literal relation targets, identical to the hand-written form.

> **Note:** The reverse direction — generating a `.dm` string from a TypeScript schema with `generateDM(...)` — is currently a stub that throws. It's being rebuilt for the schema-object API. Until then, treat the `.dm` file as the source of truth and run codegen to keep `schema.ts` in sync.
