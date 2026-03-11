# @vinctus/oql-typed

Compile-time typed queries for [OQL](https://github.com/vinctustech/oql). Define your data model in TypeScript and get fully inferred result types — no manual type parameters needed.

## Install

```bash
npm install @vinctus/oql-typed
```

Requires `@vinctus/oql` as a peer dependency.

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
  place:   manyToOne(() => place, { column: 'place_id' }),
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
  vehicle:     oneToOne(() => vehicle, { reference: 'driver' }).nullable(),
})
```

### 2. Generate the `.dm` string for OQL

```typescript
import { generateDM } from '@vinctus/oql-typed'
import OQL from '@vinctus/oql'

const dm = generateDM(account, store, user, vehicle, place)

const oql = new OQL(dm, host, port, database, username, password)
```

### 3. Write typed queries

```typescript
import { query, eq, and, inList, ilike, or, exists, desc } from '@vinctus/oql-typed'

// Return type is inferred from the selection — no manual type parameter
const result = await query(oql, user)
  .select('id', 'firstName', 'lastName', { account: ['id', 'name'] })
  .where(eq(user.id, userId))
  .one()
// => { id: string, firstName: string, lastName: string, account: { id: string, name: string } } | undefined

// No selection — returns all scalar fields
const accounts = await query(oql, account).many()
// => { id: string, name: string, enabled: boolean, plan: string }[]

// Complex query with nested relations, filtering, ordering, pagination
const users = await query(oql, user)
  .select('id', 'firstName', 'lastName', 'role', {
    stores: ['id', 'name'],
    vehicle: ['id', 'make', 'model'],
  })
  .where(and(
    exists(user.stores, inList(store.id, storeIds)),
    eq(user.enabled, true),
    or(ilike(user.firstName, `%${search}%`), ilike(user.lastName, `%${search}%`)),
  ))
  .orderBy(desc(user.lastLoginAt))
  .limit(25)
  .offset(0)
  .many()
```

## What the compiler catches

```typescript
// Misspelled field — compile error
query(oql, user).select('id', 'fistName')

// Wrong type in filter — compile error (enabled is boolean, not string)
eq(user.enabled, 'yes')

// Invalid enum value — compile error
eq(user.role, 'SUPERADMIN')

// Accessing a field not in the projection — compile error
const u = await query(oql, user).select('id').one()
u?.firstName  // Property 'firstName' does not exist

// Non-string field with ilike — compile error
ilike(user.enabled, '%test%')
```

## API

### Schema

| Function | Description |
|----------|-------------|
| `entity(name, definition)` | Define an entity. Optional second arg for table name: `entity('user', 'users', { ... })` |
| `uuid()`, `text()`, `integer()`, `float()`, `boolean()`, `timestamp()`, `date()`, `json()` | Column types |
| `textArray()`, `integerArray()`, `decimal(p?, s?)` | Additional column types |
| `enumType<T>(name, values)` | Enum column with typed string union |
| `manyToOne(target, opts?)` | Foreign key relation |
| `oneToMany(target)` | Reverse foreign key (array) |
| `manyToMany(target, { junction })` | Junction table relation (array) |
| `oneToOne(target, opts?)` | One-to-one reverse relation |

Column modifiers: `.primaryKey()`, `.nullable()`, `.column('db_alias')`

### Query

```typescript
query(oql, entity)
  .select(...)           // Optional — select fields and relations
  .where(filter)          // Optional — filter rows
  .orderBy(asc(f), ...)   // Optional — sort
  .limit(n)               // Optional
  .offset(n)              // Optional
  .one()                  // Execute, return T | undefined
  .many()                 // Execute, return T[]
  .count()                // Execute, return number
  .toOQL()                // Return { queryStr, params } without executing
```

### Selection

Scalars as string args, relations as objects with arrays:

```typescript
.select('id', 'name')
.select('id', { account: ['id', 'name'] })
.select('id', { stores: ['id', 'name', { place: ['lat', 'lng'] }] })
```

### Operators

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

### DM Generation

```typescript
import { generateDM } from '@vinctus/oql-typed'

const dmString = generateDM(account, store, user, vehicle)
// Returns the .dm string for the OQL constructor
```

## Bootstrapping from an existing `.dm` file

If you have an existing OQL data model string, use the CLI to generate TypeScript schema definitions:

```bash
npx oql-typed-codegen schema.dm src/schema.generated.ts
```

Or programmatically:

```typescript
import { parseDMAndGenerate } from '@vinctus/oql-typed'

const tsSource = parseDMAndGenerate(dmString)
```
