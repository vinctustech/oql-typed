---
title: Operators reference
description: Signatures for every operator and expression helper.
---

## Comparison

| Signature | OQL |
|-----------|-----|
| `eq(field, value)` | `field = :p` |
| `ne(field, value)` | `field != :p` |
| `gt(field, value)` | `field > :p` |
| `gte(field, value)` | `field >= :p` |
| `lt(field, value)` | `field < :p` |
| `lte(field, value)` | `field <= :p` |

Value type uses `NoInfer<T>` to prevent literal widening — it must match the field's type exactly.

## Logical

| Signature | OQL |
|-----------|-----|
| `and(...exprs)` | `a AND b AND c` |
| `or(...exprs)` | `(a OR b OR c)` |
| `not(expr)` | `NOT (expr)` |

## List / string / range / null

| Signature | OQL |
|-----------|-----|
| `inList(field, values)` | `field IN :p` |
| `notInList(field, values)` | `field NOT IN :p` |
| `like(field, pattern)` | `field LIKE :p` |
| `ilike(field, pattern)` | `field ILIKE :p` |
| `between(field, low, high)` | `field BETWEEN :p AND :q` |
| `isNull(field)` | `field IS NULL` |
| `isNotNull(field)` | `field IS NOT NULL` |

`like` / `ilike` also accept `FieldRef<string \| null>`.

## Existence

| Signature | OQL |
|-----------|-----|
| `exists(relation, filter?)` | `EXISTS(relation [filter])` or `EXISTS(relation)` |

## Expressions

| Signature | OQL |
|-----------|-----|
| `fn(name, ...args)` | `name(a, b, ...)` |
| `raw(text)` | literal `text` |
| `ref(m2oRel)` | `&relationName` |
| `subquery<T>(rel, projection, filter?)` | `(rel {projection} [filter])` |
| `alias(label, expr)` | `label: expression` |
| `aliasedRelation(label, rel, spec)` | `label: rel {fields} [where] <orderBy>` |

## Typed function wrappers

| Signature | OQL | Notes |
|-----------|-----|-------|
| `lower(field)` / `upper(field)` | `lower(field)` / `upper(field)` | Propagates nullability |
| `trim(field)` | `trim(field)` | Propagates nullability |
| `length(field)` | `length(field)` | Propagates nullability |
| `concat(...args)` | `concat(a, b, ...)` | PG `concat` — `STABLE`, not indexable |
| `concatOp(...args)` | `(a \|\| b \|\| ...)` | PG `\|\|` — `IMMUTABLE` (indexable), but NULL-propagating |
| `coalesce(...args)` | `coalesce(a, b, ...)` | Result non-null if any arg is typed non-null |
| `count(field)` / `count('*')` | `count(field)` / `count(*)` | Always non-null |
| `sum(field)` / `avg(field)` | `sum(field)` / `avg(field)` | Returns `number \| null` |
| `min(field)` / `max(field)` | `min(field)` / `max(field)` | Returns `T \| null` |

## Ordering

| Signature | OQL |
|-----------|-----|
| `asc(field)` | `field ASC` |
| `desc(field)` | `field DESC` |
