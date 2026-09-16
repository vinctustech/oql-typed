# @vinctus/oql-typed

Compile-time typed queries for [OQL](https://github.com/vinctustech/oql). Define your data model in TypeScript and get fully inferred result types — no manual type parameters needed.

📖 **[Read the full documentation →](https://vinctustech.github.io/oql-typed/)**

## Install

```bash
npm install @vinctus/oql-typed
```

That's the whole install for PostgreSQL. The in-memory backend used in tests, `@vinctus/oql-petradb`, is an optional peer — install it only if you use `createPetraDB`.

## Quick taste

```typescript
import { defineSchema, entity, uuid, text, boolean, createPostgresDB } from '@vinctus/oql-typed'

const schema = defineSchema({
  user: entity('users', {
    id:      uuid().primaryKey(),
    email:   text(),
    enabled: boolean(),
  }),
})

const db = createPostgresDB(schema, { host, port, database, user, password })

const active = await db.user.select('id', 'email').findBy(db.user.enabled, true).many()
// => { id: string, email: string }[]

const one = await db.user.findOneById(userId)
// => { id, email, enabled } | undefined
```

## Columns with database defaults

Mark a `NOT NULL` column whose value the database supplies with `.default()`:

```typescript
createdAt: timestamp().column('created_at').default(),  // NOT NULL DEFAULT now()
```

The column may be omitted on insert, but it is never `null` on read — so there is no need to declare it `.nullable()` just to make inserts compile.

## Interval columns

`interval()` produces an `Interval`, not a `string`, so an interval column is an arithmetic operand — no cast, no raw OQL:

```typescript
duration: interval(),  // Interval

db.shift.where(gte(subtract(currentTimestamp(), db.shift.startsAt), db.shift.duration))
await db.shift.insert({ startsAt, duration: '30 minutes', store: storeId })
```

Writes take PostgreSQL interval syntax. Reads give back either a parsed `IntervalObject` or an interval string depending on the backend and the projection — see the [interval columns guide](https://vinctustech.github.io/oql-typed/guides/schema/#interval-columns).

See the [docs](https://vinctustech.github.io/oql-typed/) for the full guide — schema, queries, operators, expressions, mutations, transactions, and the conditional QueryBuilder.

## Repository layout

This repo is a pnpm workspace:

- `packages/oql-typed` — the published `@vinctus/oql-typed` library
- `docs` — Starlight documentation site deployed to GitHub Pages

## License

ISC
