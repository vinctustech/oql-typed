/**
 * generateDM() — the .dm data model the backend factories hand to OQL.
 * Every column kind, modifier and relation shape is pinned here, because a
 * wrong line in the model surfaces as an opaque parse error at startup.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { generateDM } from './generate-dm.js'
import {
  defineSchema,
  entity,
  uuid,
  text,
  integer,
  bigint,
  float,
  boolean,
  timestamp,
  date,
  time,
  interval,
  json,
  textArray,
  integerArray,
  decimal,
  enumType,
  manyToOne,
  oneToMany,
  manyToMany,
  oneToOne,
} from './schema.js'
import { schema } from './test-schema.js'

// The body of one entity block, without the header or the closing brace.
function entityBody(dm: string, entityName: string): string[] {
  const match = new RegExp(`^entity ${entityName}[^{]*\\{\\n([\\s\\S]*?)\\n\\}$`, 'm').exec(dm)
  assert.ok(match, `no entity '${entityName}' in:\n${dm}`)
  return match[1].split('\n')
}

describe('generateDM: column kinds', () => {
  it('maps every column constructor to its data-model type', () => {
    const dm = generateDM(
      defineSchema({
        widget: entity({
          id: uuid().primaryKey(),
          name: text(),
          count: integer(),
          total: bigint(),
          ratio: float(),
          active: boolean(),
          createdAt: timestamp(),
          day: date(),
          clock: time(),
          span: interval(),
          payload: json(),
          tags: textArray(),
          sectors: integerArray(),
        }),
      }),
    )
    assert.deepStrictEqual(entityBody(dm, 'widget'), [
      '  *id: uuid',
      '   name: text!',
      '   count: integer!',
      '   total: bigint!',
      '   ratio: float!',
      '   active: bool!',
      '   createdAt: timestamp!',
      '   day: date!',
      '   clock: time!',
      '   span: interval!',
      '   payload: json!',
      '   tags: text[]!',
      '   sectors: integer[]!',
    ])
  })

  it('marks primary keys, nullability and column aliases', () => {
    const dm = generateDM(
      defineSchema({
        widget: entity({
          code: text().primaryKey(),
          firstName: text().column('first_name'),
          nickname: text().column('nick_name').nullable(),
          retired: boolean().nullable(),
        }),
      }),
    )
    assert.deepStrictEqual(entityBody(dm, 'widget'), [
      '  *code: text',
      '   firstName (first_name): text!',
      '   nickname (nick_name): text',
      '   retired: bool',
    ])
  })

  it('emits each decimal form', () => {
    const dm = generateDM(
      defineSchema({
        widget: entity({
          id: uuid().primaryKey(),
          bare: decimal(),
          precise: decimal(10),
          scaled: decimal(10, 2),
        }),
      }),
    )
    assert.deepStrictEqual(entityBody(dm, 'widget'), [
      '  *id: uuid',
      '   bare: decimal!',
      '   precise: decimal(10)!',
      '   scaled: decimal(10, 2)!',
    ])
  })
})

describe('generateDM: enums', () => {
  it('declares enums before the entities that use them', () => {
    const dm = generateDM(
      defineSchema({
        widget: entity({
          id: uuid().primaryKey(),
          state: enumType<'ON' | 'OFF'>('State', ['ON', 'OFF']),
        }),
      }),
    )
    assert.ok(dm.startsWith('enum State { ON OFF }\n\n'))
    assert.deepStrictEqual(entityBody(dm, 'widget'), ['  *id: uuid', '   state: State!'])
  })

  it('declares an enum once no matter how many columns use it', () => {
    const dm = generateDM(
      defineSchema({
        widget: entity({
          id: uuid().primaryKey(),
          state: enumType<'ON' | 'OFF'>('State', ['ON', 'OFF']),
          previousState: enumType<'ON' | 'OFF'>('State', ['ON', 'OFF']).nullable(),
        }),
        gadget: entity({
          id: uuid().primaryKey(),
          state: enumType<'ON' | 'OFF'>('State', ['ON', 'OFF']),
        }),
      }),
    )
    assert.equal(dm.match(/enum State/g)?.length, 1)
    assert.deepStrictEqual(entityBody(dm, 'widget'), [
      '  *id: uuid',
      '   state: State!',
      '   previousState: State',
    ])
  })
})

describe('generateDM: relations', () => {
  it('emits all four relation kinds', () => {
    const dm = generateDM(
      defineSchema({
        widget: entity({
          id: uuid().primaryKey(),
          owner: manyToOne('person', { column: 'owner_id' }),
          keeper: manyToOne('person', { column: 'keeper_id' }).nullable(),
          plain: manyToOne('person'),
          parts: oneToMany('part'),
          labels: manyToMany('label', { junction: 'widgets_labels' }),
          manual: oneToOne('manual'),
        }),
        person: entity({ id: uuid().primaryKey() }),
        part: entity({ id: uuid().primaryKey() }),
        label: entity({ id: uuid().primaryKey() }),
        manual: entity({ id: uuid().primaryKey() }),
      }),
    )
    assert.deepStrictEqual(entityBody(dm, 'widget'), [
      '  *id: uuid',
      '  owner (owner_id): person!',
      '  keeper (keeper_id): person',
      '  plain: person!',
      '  parts: [part]',
      '  labels: [label] (widgets_labels)',
      '  manual: <manual>',
    ])
  })

  it('emits the reverse reference of a oneToMany and a oneToOne', () => {
    const dm = generateDM(
      defineSchema({
        widget: entity({
          id: uuid().primaryKey(),
          parts: oneToMany('part', { reference: 'widget' }),
          manual: oneToOne('manual', { reference: 'widget' }),
        }),
        part: entity({ id: uuid().primaryKey(), widget: manyToOne('widget', { column: 'widget_id' }) }),
        manual: entity({ id: uuid().primaryKey(), widget: manyToOne('widget', { column: 'widget_id' }) }),
      }),
    )
    assert.deepStrictEqual(entityBody(dm, 'widget'), [
      '  *id: uuid',
      '  parts: [part].widget',
      '  manual: <manual>.widget',
    ])
  })
})

describe('generateDM: entities', () => {
  it('names the table when the schema gives one, and omits it otherwise', () => {
    const dm = generateDM(
      defineSchema({
        widget: entity('widgets', { id: uuid().primaryKey() }),
        gadget: entity({ id: uuid().primaryKey() }),
      }),
    )
    assert.ok(dm.includes('entity widget (widgets) {'))
    assert.ok(dm.includes('entity gadget {'))
  })

  it('accepts an entity written as a plain object', () => {
    const dm = generateDM({ widget: { id: uuid().primaryKey(), name: text() } })
    assert.ok(dm.includes('entity widget {'))
    assert.deepStrictEqual(entityBody(dm, 'widget'), ['  *id: uuid', '   name: text!'])
  })

  it('keeps entities in schema order', () => {
    const dm = generateDM(
      defineSchema({
        zebra: entity({ id: uuid().primaryKey() }),
        aardvark: entity({ id: uuid().primaryKey() }),
      }),
    )
    assert.ok(dm.indexOf('entity zebra') < dm.indexOf('entity aardvark'))
  })
})

describe('generateDM: junction tables', () => {
  it('synthesizes a junction entity for a manyToMany', () => {
    const dm = generateDM(
      defineSchema({
        widget: entity({ id: uuid().primaryKey(), labels: manyToMany('label', { junction: 'widgets_labels' }) }),
        label: entity({ id: uuid().primaryKey(), widgets: manyToMany('widget', { junction: 'widgets_labels' }) }),
      }),
    )
    assert.equal(dm.match(/entity widgets_labels/g)?.length, 1)
    assert.deepStrictEqual(entityBody(dm, 'widgets_labels'), [
      '  widget (widget_id): widget',
      '  label (label_id): label',
    ])
  })

  it('leaves a junction the schema declares itself alone', () => {
    const dm = generateDM(
      defineSchema({
        widget: entity({ id: uuid().primaryKey(), labels: manyToMany('label', { junction: 'widgetLabel' }) }),
        label: entity({ id: uuid().primaryKey() }),
        widgetLabel: entity('widgets_labels', {
          widget: manyToOne('widget', { column: 'widget_id' }),
          label: manyToOne('label', { column: 'label_id' }),
          position: integer(),
        }),
      }),
    )
    assert.equal(dm.match(/entity widgetLabel/g)?.length, 1)
    assert.deepStrictEqual(entityBody(dm, 'widgetLabel'), [
      '  widget (widget_id): widget!',
      '  label (label_id): label!',
      '   position: integer!',
    ])
  })
})

describe('generateDM: the shuttlecontrol-shaped test schema', () => {
  it('declares both enums, every entity and both junctions', () => {
    const dm = generateDM(schema)
    assert.ok(dm.startsWith('enum Role { ADMIN DISPATCHER DRIVER }'))
    assert.ok(dm.includes('enum TripState { REQUESTED CONFIRMED EN_ROUTE COMPLETED CANCELLED }'))
    for (const entityName of Object.keys(schema)) {
      assert.ok(new RegExp(`^entity ${entityName}[ {]`, 'm').test(dm), `missing entity ${entityName}`)
    }
    assert.deepStrictEqual(entityBody(dm, 'users_stores'), [
      '  store (store_id): store',
      '  user (user_id): user',
    ])
    assert.deepStrictEqual(entityBody(dm, 'customers_places'), [
      '  customer (customer_id): customer',
      '  place (place_id): place',
    ])
  })

  it('renders the user entity exactly', () => {
    assert.deepStrictEqual(entityBody(generateDM(schema), 'user'), [
      '  *id: uuid',
      '   firstName (first_name): text!',
      '   lastName (last_name): text!',
      '   email: text!',
      '   role: Role!',
      '   enabled: bool!',
      '   lastLoginAt (last_login_at): timestamp',
      '  account (account_id): account!',
      '  stores: [store] (users_stores)',
      '  vehicle: <vehicle>.driver',
    ])
  })
})
