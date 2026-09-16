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
| `.default()` | The database supplies the value when an insert omits the column. |
| `.column('alias')` | Overrides the database column name. |

`.default()` is for `NOT NULL` columns that carry a database default (`DEFAULT ''`, `DEFAULT 0`, `DEFAULT now()`). It makes the column optional in `InsertInput` without adding `| null`, so reads stay non-null and passing `null` remains a type error. No default value is stored in the schema.

## Relations

Relation targets are **string literals** matching keys in `defineSchema(...)`.

| Function | Description |
|----------|-------------|
| `manyToOne(target, { column })` | Foreign key to one target row. Field access on a `manyToOne` field returns a `RelationFieldRef` that supports dotted paths (`db.post.author.email`). |
| `oneToMany(target, { reference? })` | Reverse FK — a typed array of target rows. `reference` names the field on the target that holds the FK back, for when the target has more than one FK to this entity. |
| `manyToMany(target, { junction })` | Junction-table relation. |
| `oneToOne(target, { reference? })` | Exactly-one relation. `reference` names the field on the target that holds the FK back. |

Every relation supports `.nullable()` for optional / nullable cases.

## DB handle

### `createPostgresDB(schema, connection, options?)`

Builds a PostgreSQL-backed `DB<S>`. The data model is generated from `schema`, so nothing else is needed.

```typescript
const db = createPostgresDB(schema, {
  host: 'localhost',
  port: 5432,
  database: 'blog',
  user: 'blog',
  password: secret,
  // ssl: false, idleTimeoutMillis: 7200000, max: 10  ← defaults
})
```

| Connection field | Default | Description |
|------------------|---------|-------------|
| `host`, `port`, `database`, `user`, `password` | — | Required. |
| `ssl` | `false` | `true`, or the driver's SSL option object. |
| `idleTimeoutMillis` | `7200000` | How long a pooled connection may idle. |
| `max` | `10` | Pool size. |
| `typeParsers` | none | Result parsers keyed by PostgreSQL type OID — see below. |

`options.engine` selects the query engine — `'ast'` (default) or `'string'`.

#### Result type parsing

`typeParsers` is a `Record<number, (value: string) => unknown>`, keyed by PostgreSQL type OID. The parsers are installed on the driver instance this package uses, so no `pg` dependency of your own is needed. No parser is installed by default.

```typescript
import {
  PostgresTypeOid,
  keepJsonAsString,
  parseInt8AsNumber,
  parseTimestampAsUtcDate,
} from '@vinctus/oql-typed'

const db = createPostgresDB(schema, {
  host, port, database, user, password,
  typeParsers: {
    [PostgresTypeOid.INT8]: parseInt8AsNumber,
    [PostgresTypeOid.TIMESTAMP]: parseTimestampAsUtcDate,
    [PostgresTypeOid.JSON]: keepJsonAsString,
  },
})
```

| Export | Description |
|--------|-------------|
| `PostgresTypeOid` | `INT8` (20), `TIMESTAMP` (1114), `TIMESTAMPTZ` (1184), `JSON` (114), `NUMERIC` (1700). |
| `parseInt8AsNumber` | `bigint` text as a `number`; values past `Number.MAX_SAFE_INTEGER` lose precision. |
| `parseTimestampAsUtcDate` | A zoneless `timestamp` as a `Date` read in UTC rather than the local zone. |
| `keepJsonAsString` | Leaves `json` as the raw string. |
| `PostgresTypeParser` | The parser type, `(value: string) => unknown`. |

### `createPetraDB(schema, options?)`

Builds an in-memory `DB<S>` on the PetraDB engine, for tests. `@vinctus/oql-petradb` is an **optional peer dependency**: install it to use this factory, and the call throws a message naming the package if it is missing.

```typescript
const db = createPetraDB(schema)
const persisted = createPetraDB(schema, { storage: 'persistent', path: './fixture.db' })
```

`options.storage` is `'memory'` (default), `'persistent'` or `'text'`; `options.path` is the file for the latter two; `options.engine` is as above.

### `db.close()`

Releases whatever the backend holds — the PostgreSQL connection pool, above all. A no-op on backends that hold nothing open, so it is always safe to call on shutdown.

### `typedOQL(oqlInstance, schema, options?)`

The escape hatch for a backend you construct yourself. Wraps an `OQLInstance` and returns a `DB<S>` whose entity handles (`db.user`, `db.post`, ...) carry typed field refs **and** the full set of query starter methods (`select`, `where`, `findBy`, `findIn`, `findOneBy`, `findOneById`, `orderBy`, `limit`, `offset`, `one`, `many`, `count`, `toOQL`).

```typescript
const db = typedOQL(oqlInstance, schema)

db.post.id                // FieldRef<string>
db.post.author            // RelationFieldRef — manyToOne
db.post.author.email      // FieldRef<string>   (dotted path)

db.post.select('id').many()                      // query starter on the handle
db.post.findOneById(id)                          // ditto
```

