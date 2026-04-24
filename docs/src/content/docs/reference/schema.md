---
title: Schema API
description: Reference for entity, column, and relation constructors.
---

## `entity(name, tableName?, fields)`

Defines an entity. `tableName` defaults to `name`.

```typescript
const user = entity('user', 'users', { /* fields */ })
```

## Column types

| Function | Type |
|----------|------|
| `uuid()` | `string` |
| `text()` | `string` |
| `integer()` | `number` |
| `bigint()` | `bigint` |
| `float()` | `number` |
| `boolean()` | `boolean` |
| `timestamp()` | `Date` |
| `date()` | `string` |
| `time()` | `string` |
| `interval()` | `string` |
| `json()` | `unknown` |
| `textArray()` | `string[]` |
| `integerArray()` | `number[]` |
| `decimal(precision?, scale?)` | `number` |
| `enumType<T>(name, values)` | `T` |

## Column modifiers

| Modifier | Effect |
|----------|--------|
| `.primaryKey()` | Marks the column as the primary key. |
| `.nullable()` | Allows `null`; the inferred type becomes `T \| null`. |
| `.column('alias')` | Overrides the database column name. |

## Relations

| Function | Description |
|----------|-------------|
| `manyToOne(() => target, { column })` | Foreign key to one target row. Field access on a `manyToOne` field returns a `RelationFieldRef` that supports dotted paths (`db.post.author.email`). |
| `oneToMany(() => target)` | Reverse FK — a typed array of target rows. |
| `manyToMany(() => target, { junction })` | Junction-table relation. |
| `oneToOne(() => target, opts?)` | Exactly-one relation. |

Targets are wrapped in `() => target` to permit circular definitions.

## DB handle

### `typedOQL(oql, schema)`

Wraps an `OQLInstance` and returns a `DB<S>` whose entity handles (`db.user`, `db.post`, ...) carry typed field refs and starter methods.

```typescript
const db = typedOQL(oql, { user, post, comment })

db.post.id                // FieldRef<string>
db.post.author            // RelationFieldRef — manyToOne
db.post.author.email      // FieldRef<string>   (dotted path)
```

## DM codegen

| Function | Description |
|----------|-------------|
| `generateDM(...entities)` | Produces a `.dm` string from TypeScript entities. |
| `parseDMAndGenerate(dmString)` | Parses a `.dm` file and emits TypeScript schema source. |
