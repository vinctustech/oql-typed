---
title: Schema API
description: Reference for defineSchema, entity, column, and relation constructors.
---

## `defineSchema(schema)`

Identity function with a `const` generic — preserves literal types so TypeScript can infer entity names, enum values, and field shapes without manual annotations.

```typescript
export const schema = defineSchema({
  user: entity('users', { /* fields */ }),
  post: entity('posts', { /* fields */ }),
})
```

The **entity name** is the key in the object — that's the name you use in `query(db, 'user')`, in relation targets (`manyToOne('user', ...)`), and in OQL strings.

## `entity(tableName?, fields)`

Defines an entity. Two forms:

```typescript
entity(fields)                  // table name = entity name
entity(tableName, fields)       // override table name
```

The entity name itself comes from the `defineSchema` key, not from `entity(...)`.

## Column types

| Function | TypeScript type |
|----------|-----------------|
| `uuid()` | `string` |
| `text()` | `string` |
| `integer()` | `number` |
| `bigint()` | `bigint` |
| `float()` | `number` |
| `boolean()` | `boolean` |
| `timestamp()` | `Date` |
| `date()` | `Date` |
| `time()` | `string` |
| `interval()` | `string` |
| `json<T = unknown>()` | `T` |
| `textArray()` | `string[]` |
| `integerArray()` | `number[]` |
| `decimal(precision?, scale?)` | `bigint` |
| `enumType<T>(name, values)` | `T` |

## Column modifiers

| Modifier | Effect |
|----------|--------|
| `.primaryKey()` | Marks the column as the primary key. |
| `.nullable()` | Allows `null`; the inferred type becomes `T \| null`. |
| `.column('alias')` | Overrides the database column name. |

## Relations

Relation targets are **string literals** matching keys in `defineSchema(...)`.

| Function | Description |
|----------|-------------|
| `manyToOne(target, { column })` | Foreign key to one target row. Field access on a `manyToOne` field returns a `RelationFieldRef` that supports dotted paths (`db.post.author.email`). |
| `oneToMany(target)` | Reverse FK — a typed array of target rows. |
| `manyToMany(target, { junction })` | Junction-table relation. |
| `oneToOne(target, { reference? })` | Exactly-one relation. `reference` names the field on the target that holds the FK back. |

Every relation supports `.nullable()` for optional / nullable cases.

## DB handle

### `typedOQL(oqlInstance, schema)`

Wraps an `OQLInstance` and returns a `DB<S>` whose entity handles (`db.user`, `db.post`, ...) carry typed field refs **and** the full set of query starter methods (`select`, `where`, `findBy`, `findIn`, `findById`, `orderBy`, `limit`, `offset`, `one`, `many`, `count`, `toOQL`).

```typescript
const db = typedOQL(oqlInstance, schema)

db.post.id                // FieldRef<string>
db.post.author            // RelationFieldRef — manyToOne
db.post.author.email      // FieldRef<string>   (dotted path)

db.post.select('id').many()                      // query starter on the handle
db.post.findById(id)                             // ditto
```

## DM codegen

| Function | Description |
|----------|-------------|
| `parseDMAndGenerate(dmString)` | Parses a `.dm` file and emits TypeScript schema source. |
| `parseDM(dmString)` | Lower-level parser; returns a `ParsedDataModel` object. |
| `generateSchemaTS(parsedDM)` | Emits TypeScript source from a `ParsedDataModel`. |

:::caution
`generateDM(...)` (the schema-object → `.dm` direction) is currently a stub that throws — it's being rebuilt for the schema-object API. For now, keep your `.dm` file as the source of truth and bootstrap TypeScript from it with `parseDMAndGenerate` or the `oql-typed-codegen` CLI. See [DM codegen](/oql-typed/guides/codegen/).
:::
