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

```typescript
import {
  entity, uuid, text, integer, boolean, timestamp, float,
  manyToOne, oneToMany, manyToMany, oneToOne, enumType,
} from '@vinctus/oql-typed'

type Role = 'ADMIN' | 'DISPATCHER' | 'DRIVER'

const account = entity('account', 'accounts', {
  id:      uuid().primaryKey(),
  name:    text(),
  enabled: boolean(),
  plan:    text(),
})

const store = entity('store', 'stores', {
  id:      uuid().primaryKey(),
  name:    text(),
  enabled: boolean(),
  account: manyToOne(() => account, { column: 'account_id' }),
  users:   manyToMany(() => user, { junction: 'users_stores' }),
})

const user = entity('user', 'users', {
  id:          uuid().primaryKey(),
  firstName:   text().column('first_name'),
  lastName:    text().column('last_name'),
  email:       text(),
  role:        enumType<Role>('Role', ['ADMIN', 'DISPATCHER', 'DRIVER']),
  enabled:     boolean(),
  lastLoginAt: timestamp().column('last_login_at').nullable(),
  account:     manyToOne(() => account, { column: 'account_id' }),
  stores:      manyToMany(() => store, { junction: 'users_stores' }),
})
```

### 2. Generate the `.dm` string for OQL

```typescript
import { generateDM } from '@vinctus/oql-typed'
import { OQL_PG } from '@vinctus/oql-pg'

const dm = generateDM(account, store, user)
const oql = new OQL_PG(dm, host, port, database, username, password)
```

### 3. Write typed queries

```typescript
import { query, eq, and, inList, ilike, or, exists, desc } from '@vinctus/oql-typed'

// Result type is inferred from .select() — no manual type parameter.
// .findById() is sugar for .where(eq(<entity>.id, X)).one() and auto-terminates.
const result = await query(oql, user)
  .select('id', 'firstName', 'lastName', { account: ['id', 'name'] })
  .findById(userId)
// => { id: string, firstName: string, lastName: string, account: { id: string, name: string } } | undefined

// No selection — returns all scalar fields
const accounts = await query(oql, account).many()
// => { id: string, name: string, enabled: boolean, plan: string }[]

// Common shortcuts: .findBy() (single eq), .findIn() (IN list) — both chainable AND
const drivers = await query(oql, user)
  .findBy(user.role, 'DRIVER')
  .findIn(user.status, ['ACTIVE', 'ON_BREAK'])
  .many()
```

## What the compiler catches

```typescript
query(oql, user).select('id', 'fistName')           // ✗ misspelled field
eq(user.enabled, 'yes')                             // ✗ wrong type (boolean expected)
eq(user.role, 'SUPERADMIN')                         // ✗ invalid enum value
ilike(user.enabled, '%test%')                       // ✗ ilike requires string field

const u = await query(oql, user).select('id').one()
u?.firstName                                         // ✗ not in projection
```

## Selection

Scalars as string args, relations as objects:

```typescript
.select('id', 'name')                                                      // scalars
.select('id', { account: ['id', 'name'] })                                 // simple relation
.select('id', { stores: ['id', 'name', { place: ['lat', 'lng'] }] })       // nested
```

### Filtered sub-collections

Add `where` and `orderBy` to a nested relation:

```typescript
.select('id', 'name', {
  trips: {
    fields: ['id', 'state', 'seats'],
    where: ne(trip.state, 'COMPLETED'),
    orderBy: [desc(trip.createdAt)],
  },
})
```

### Dotted paths on `manyToOne`

Access fields on related entities directly in filters:

```typescript
.where(and(
  eq(trip.store.account.id, accountId),     // multi-level FK chain
  inList(trip.store.id, storeIds),
))
```

## Operators

| Operator | Example |
|----------|---------|
| `eq`, `ne`, `gt`, `gte`, `lt`, `lte` | `eq(user.enabled, true)` |
| `and`, `or`, `not` | `and(eq(...), or(...))` |
| `inList`, `notInList` | `inList(user.role, ['ADMIN', 'DRIVER'])` |
| `like`, `ilike` | `ilike(user.firstName, '%john%')` |
| `between` | `between(user.lastLoginAt, start, end)` |
| `isNull`, `isNotNull` | `isNull(trip.vehicle)` |
| `exists` | `exists(user.stores, eq(store.id, storeId))` |
| `asc`, `desc` | `desc(user.lastLoginAt)` |

## Expressions

For OQL features beyond plain field comparisons:

```typescript
import { fn, raw, ref, subquery, alias } from '@vinctus/oql-typed'

// Function call in a filter — fn(name, ...args)
ilike(fn('concat', vehicle.make, raw("' '"), vehicle.model), '%toyota%')

// Reference operator (&) — check the FK column itself, not the joined entity
isNull(ref(trip.returnTripFor))                     // → &returnTripFor IS NULL

// Subquery in a filter — (relation {projection}) op value
eq(subquery(vehicle.drivers, ['count(*)']), 0)      // vehicles with no drivers

// Aliased projection — label: (expression)
.select('id', alias('returnTripId', trip.returnTripFor.id))

// Raw OQL escape hatch — for anything without a typed wrapper
.select('id', raw('count: sum(seats)'))
```

## Mutations

```typescript
import { insert, update } from '@vinctus/oql-typed'

// insert() — typed input (required/optional fields), returns full row
const newUser = await insert(oql, user, {
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

// update() — all fields optional, returns updated fields + PK
const updated = await update(oql, user, userId, {
  firstName: 'Alicia',
})
// => { id: string, firstName: string }
```

## Conditional QueryBuilder

For dynamic filtering (paginated lists with optional search/role/etc.):

```typescript
import { queryBuilder } from '@vinctus/oql-typed'

const results = await queryBuilder(oql, user)
  .select('id', 'firstName', 'role')
  .where(eq(user.enabled, true))
  .cond(role, eq(user.role, role))                   // applied if `role` is truthy
  .cond(search, ilike(user.firstName, `%${search}%`))
  .orderBy(desc(user.lastLoginAt))
  .limit(size)
  .offset(page * size)
  .many()
```

## Query API

```typescript
query(oql, entity)
  .select(...)            // Optional — fields and relations
  .where(filter)           // Optional — single filter expression
  .orderBy(asc(f), ...)    // Optional — sort
  .limit(n)                // Optional
  .offset(n)               // Optional
  .one()                   // → T | undefined
  .many()                  // → T[]
  .count()                 // → number
  .toOQL()                 // → { queryStr, params } — no execution
```

## Schema reference

| Function | Description |
|----------|-------------|
| `entity(name, definition)` | Define an entity. Optional table name: `entity('user', 'users', { ... })` |
| `uuid()`, `text()`, `integer()`, `bigint()`, `float()`, `boolean()`, `timestamp()`, `date()`, `time()`, `interval()`, `json()` | Column types |
| `textArray()`, `integerArray()`, `decimal(p?, s?)` | Array & decimal columns |
| `enumType<T>(name, values)` | Typed enum column |
| `manyToOne(target, opts?)` | FK relation (supports dotted paths) |
| `oneToMany(target)` | Reverse FK (array) |
| `manyToMany(target, { junction })` | Junction-table relation (array) |
| `oneToOne(target, opts?)` | One-to-one |

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

> **Note:** The generated file includes `// @ts-nocheck` at the top. This suppresses TS7022 errors from circular entity references (e.g., `user` → `account` → `users: [user]`) in strict mode. Call-site type inference (result types, typo detection, operator type checks) is unaffected and works fully.
