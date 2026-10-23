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

Value type uses `NoInfer<T>` to prevent literal widening — it must match the field's type exactly. The value may also be an `OQLExpr<T>` (e.g. `currentTimestamp()`), which is emitted inline rather than parameterized.

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
| `arrayContains(arrayField, value)` | `:p = ANY(arrayField)` |
| `like(field, pattern)` | `field LIKE :p` |
| `ilike(field, pattern)` | `field ILIKE :p` |
| `between(field, low, high)` | `field BETWEEN :p AND :q` |
| `isNull(field)` | `field IS NULL` |
| `isNotNull(field)` | `field IS NOT NULL` |

`like` / `ilike` also accept `FieldRef<string \| null>`.

`between` takes an expression in place of any of its three operands, so a range can be anchored to the database clock: `between(field, currentTimestamp(), add(currentTimestamp(), makeInterval({ minutes: 30 })))`.

`arrayContains(arrayField, value)` tests scalar membership in an array-typed column (`textArray()` / `integerArray()`) — the inverse of `inList` (which tests a scalar column against a JS array). `value` is constrained to the column's element type.

## Existence

| Signature | OQL |
|-----------|-----|
| `exists(relation, filter?)` | `EXISTS(relation [filter])` or `EXISTS(relation)` |

## Expressions

| Signature | OQL |
|-----------|-----|
| `fn(name, ...args)` | `name(a, b, ...)` |
| `currentTimestamp()` | `CURRENT_TIMESTAMP` |
| `currentDate()` | `current_date` |
| `add(a, b)` / `subtract(a, b)` | `a + b` / `a - b` |
| `multiply(a, b)` / `divide(a, b)` | `a * b` / `a / b` |
| `ref(m2oRel)` | `&relationName` |
| `outer(field)` | `^entity.field` (correlated reference to the enclosing query) |
| `subquery(rel, expr, filter?)` | `(rel {value: (expr)} [filter])` |
| `alias(label, expr)` | `label: expression` |
| `aliasedRelation(label, rel, spec)` | `label: rel {fields} [where] <orderBy>` |
| `caseWhen(branches, else?)` | `CASE WHEN cond THEN result ... [ELSE result] END` |

Arithmetic operands are columns, expressions, or literals. A nested arithmetic operand is parenthesized, so the written grouping survives precedence. Result types follow PostgreSQL: `number` ⊕ `number` → `number`, `Date` − `Date` → `Interval`, `Date` ± `Interval` → `Date`, `Interval` × / ÷ `number` → `Interval`. `Interval` is a branded type produced by `makeInterval()` or by subtracting two timestamps.

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
| `makeInterval(parts)` | `make_interval(y, m, w, d, h, min, s)` | Omitted parts are zero; returns `Interval` |
| `datePart(field, x)` | `date_part('DOW', x)` | Field is a closed union, emitted as a literal; returns `number` |
| `dateTrunc(unit, x)` | `date_trunc('day', x)` | Unit is a closed union, emitted as a literal; returns `Date` |

## Ordering

| Signature | OQL |
|-----------|-----|
| `asc(field, nulls?)` | `field ASC [NULLS FIRST\|LAST]` |
| `desc(field, nulls?)` | `field DESC [NULLS FIRST\|LAST]` |

`nulls` is `'first'` or `'last'`. Omitted, it uses SQL's default (`asc` → NULLS FIRST, `desc` → NULLS LAST).
