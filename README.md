# @vinctus/oql-typed

Compile-time typed queries for [OQL](https://github.com/vinctustech/oql). Define your data model in TypeScript and get fully inferred result types — no manual type parameters needed.

📖 **[Read the full documentation →](https://vinctustech.github.io/oql-typed/)**

## Install

```bash
npm install @vinctus/oql-typed
```

Requires one of the OQL backends as a peer dependency:

- `@vinctus/oql-pg` — PostgreSQL backend
- `@vinctus/oql-petradb` — in-memory backend (great for tests)

## Quick taste

```typescript
import { entity, uuid, text, boolean, typedOQL, query, eq } from '@vinctus/oql-typed'

const user = entity('user', 'users', {
  id:      uuid().primaryKey(),
  email:   text(),
  enabled: boolean(),
})

const db = typedOQL(oql, { user })

const active = await query(db, 'user')
  .select('id', 'email')
  .where(eq(db.user.enabled, true))
  .many()
// => { id: string, email: string }[]
```

See the [docs](https://vinctustech.github.io/oql-typed/) for the full guide — schema, queries, operators, expressions, mutations, and the conditional QueryBuilder.

## Repository layout

This repo is a pnpm workspace:

- `packages/oql-typed` — the published `@vinctus/oql-typed` library
- `docs` — Starlight documentation site deployed to GitHub Pages

## License

ISC
