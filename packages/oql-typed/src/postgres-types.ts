// PostgreSQL result parsing — the OIDs and parsers consumers reach for most
// often. Nothing here is applied by default; pass what you want through
// `typeParsers` on the connection given to createPostgresDB.

import type { Interval } from './interval.js'

export type PostgresTypeParser = (value: string) => unknown

export const PostgresTypeOid = {
  JSON: 114,
  INT8: 20,
  TIMESTAMP: 1114,
  TIMESTAMPTZ: 1184,
  INTERVAL: 1186,
  NUMERIC: 1700,
} as const

export type PostgresTypeOid = (typeof PostgresTypeOid)[keyof typeof PostgresTypeOid]

// The driver returns int8 as a string so 64-bit values survive intact; values
// beyond Number.MAX_SAFE_INTEGER lose precision once converted.
export function parseInt8AsNumber(value: string): number {
  return Number.parseInt(value, 10)
}

// `timestamp` carries no zone, and the driver would otherwise read it in the
// process's local zone; the suffix pins it to UTC.
export function parseTimestampAsUtcDate(value: string): Date {
  return new Date(`${value} GMT+00:00`)
}

export function keepJsonAsString(value: string): string {
  return value
}

// The driver parses `interval` into a postgres-interval object, but the same
// column read through a sub-collection arrives as text — OQL renders those
// with to_json(). Keeping the raw text makes every interval read a string.
export function keepIntervalAsString(value: string): Interval {
  return value as Interval
}
