---
title: Query API
description: Reference for query() and queryBuilder().
---

## `query(db, entityName)`

Returns a `QueryStarter<S, Name>`.

```typescript
query(db, 'user')
  .select(...)         // optional — fields and relations
  .where(filter)       // optional — single filter expression (overwrites)
  .findBy(col, v)      // optional — sugar for where(eq(col, v)); chains AND
  .findIn(col, vs)     // optional — sugar for where(inList(col, vs)); chains AND
  .orderBy(...)        // optional — sort
  .limit(n)            // optional
  .offset(n)           // optional
  .one()               // → T | undefined
  .many()              // → T[]
  .count()             // → number
  .findById(id)        // → T | undefined  (terminal — auto-runs .one())
  .toOQL()             // → { queryStr, params } — no execution
```

### `.select(...args)`

Variadic. Scalars are strings, relations are objects. Returns a `QueryBuilder` whose result type is inferred from the arguments.

```typescript
.select('id', 'email')
.select('id', { author: ['id', 'firstName'] })
.select('id', {
  posts: ['id', 'title', { tags: ['name'] }],
})
.select('id', {
  posts: {
    fields: ['id', 'title'],
    where: ne(db.post.status, 'ARCHIVED'),
    orderBy: [desc(db.post.createdAt)],
  },
})
```

If `.select()` is not called, the result includes all scalar fields (`InferDefaultProjection`).

### `.where(filter)`

Accepts either a `FilterExpr` or a bare `FieldRef<boolean>` (short for `eq(field, true)`). On `QueryBuilder`, repeated `.where()` calls **overwrite** the previous filter — use `.findBy()` / `.findIn()` to AND, or build a single `and(...)` expression.

### `.findBy(field, value)`

Sugar for `.where(eq(field, value))`. Chainable: repeated calls AND together. Same overloads as `eq` — accepts a scalar `FieldRef<T>` (typed value) or a `manyToOne` `RelationFieldRef` (FK lookup).

```typescript
db.user.findBy(db.user.email, 'a@b.com').one()
db.post.findBy(db.post.status, 'PUBLISHED').findBy(db.post.author, authorId).many()
```

### `.findIn(field, values)`

Sugar for `.where(inList(field, values))`. Chainable: repeated calls AND together.

```typescript
db.post.findIn(db.post.status, ['PUBLISHED', 'DRAFT']).many()
db.trip.findBy(db.trip.store, storeId).findIn(db.trip.state, ['CONFIRMED']).many()
```

### `.findById(id)` — terminal

Sugar for `.where(eq(<entity>.id, id)).one()`. **Terminates the chain** — returns `Promise<T | undefined>`. The PK column is auto-detected from the schema; the `id` argument is typed via `PKType<S, Name>`.

```typescript
const u = await db.user.findById(userId)
const stub = await db.user.select('id', 'firstName').findById(userId)
```

Not available on `CondQueryBuilder` (use `findBy` + `.one()` if you need to combine with `.cond()`).

## `queryBuilder(db, entityName)`

Same as `query()`, plus conditional filtering:

### `.cond(value, filter)`

Applies `filter` only when `value` is truthy. Falsy values are skipped without contributing to the generated OQL or params.

```typescript
queryBuilder(db, 'user')
  .select('id', 'firstName')
  .where(eq(db.user.enabled, true))
  .cond(role, eq(db.user.role, role))
  .cond(search, ilike(db.user.firstName, `%${search}%`))
```

`queryBuilder` also supports `.findBy()` and `.findIn()` — both append to the filter list (no overwrite semantics). `.findById()` is not available here.

## Mutations

### `insert(oql, entity, input)`

Returns the full row. Required fields (non-nullable, no default) are enforced at the type level.

### `update(oql, entity, id, patch)`

Returns the primary key plus the patched fields. All patch fields are optional.
