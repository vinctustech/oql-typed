---
title: Query API
description: Reference for query() and queryBuilder().
---

## `query(db, entityName)`

Returns a `QueryStarter<S, Name>`.

```typescript
query(db, 'user')
  .select(...)         // optional — fields and relations
  .where(filter)       // optional — single filter expression
  .orderBy(...)        // optional — sort
  .limit(n)            // optional
  .offset(n)           // optional
  .one()               // → T | undefined
  .many()              // → T[]
  .count()             // → number
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

Accepts either a `FilterExpr` or a bare `FieldRef<boolean>` (short for `eq(field, true)`).

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

## Mutations

### `insert(oql, entity, input)`

Returns the full row. Required fields (non-nullable, no default) are enforced at the type level.

### `update(oql, entity, id, patch)`

Returns the primary key plus the patched fields. All patch fields are optional.
