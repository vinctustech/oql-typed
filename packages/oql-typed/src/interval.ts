// A PostgreSQL INTERVAL value — the type an `interval()` column reads back as
// and the operand type interval arithmetic is written against.
//
// Its own module rather than schema.ts or expressions.ts: both import it, and
// a leaf with no imports of its own keeps them from depending on each other.
//
// The runtime shape depends on where the value is read, so the type covers
// both forms:
//   * A top-level `interval` column under PostgreSQL arrives as an object.
//     node-postgres parses OID 1186 with postgres-interval, which sets only
//     the non-zero fields — `{ days: 1, hours: 2, minutes: 30 }`.
//   * Inside a sub-collection the same column arrives as a string. OQL builds
//     a oneToMany/manyToMany projection with to_json(), which renders the
//     interval as text before the driver's parser ever sees it, so the value
//     is PostgreSQL interval syntax: '1 day 02:30:00'.
//   * petradb always returns a string, in ISO-8601 duration form: 'PT30M'.
//
// Installing keepIntervalAsString (see postgres-types.ts) collapses the first
// case into the second, making every read a string.

export interface IntervalObject {
  readonly years?: number
  readonly months?: number
  readonly days?: number
  readonly hours?: number
  readonly minutes?: number
  readonly seconds?: number
  readonly milliseconds?: number
  toPostgres(): string
  toISO(): string
  toISOString(): string
}

// Branded so a text column can never stand in for an interval, and so an
// interval expression can only be built from an interval operand. A plain
// string literal is deliberately NOT an IntervalString — writes widen to
// accept one (see InsertInput), reads do not.
export type IntervalString = string & { readonly __interval: true }

export type Interval = IntervalObject | IntervalString
