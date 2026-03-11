/**
 * Tests based on the most complex real queries from shuttlecontrol-api.
 * Each test verifies both compile-time type inference and runtime query string generation.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  entity,
  uuid,
  text,
  integer,
  boolean_ as boolean,
  timestamp,
  float,
  json,
  textArray,
  manyToOne,
  oneToMany,
  manyToMany,
  oneToOne,
  enumType,
} from './schema.js'
import { query } from './query.js'
import {
  eq,
  ne,
  and,
  or,
  inList,
  ilike,
  between,
  isNull,
  isNotNull,
  exists,
  asc,
  desc,
} from './operators.js'

// ── Type helpers ──

type AssertEqual<T, U> = [T] extends [U] ? ([U] extends [T] ? true : false) : false
type AssertTrue<T extends true> = T

// ── ShuttleControl schema (mirrors production entities) ──

type TripState = 'REQUESTED' | 'SCHEDULED' | 'CONFIRMED' | 'EN_ROUTE' | 'COMPLETED' | 'CANCELLED'
type UserRole = 'OWNER' | 'ADMIN' | 'BILLING' | 'DISPATCHER' | 'DRIVER'
type StepType = 'place' | 'pickup' | 'dropoff'
type TripOptimizationHeuristic = 'MINIMIZE_DISTANCE' | 'MINIMIZE_DURATION'

const integration = entity('integration', 'integrations', {
  id: uuid().primaryKey(),
  name: text(),
})

const messageTemplate = entity('messageTemplate', 'message_templates', {
  id: uuid().primaryKey(),
  name: text(),
})

const account = entity('account', 'accounts', {
  id: uuid().primaryKey(),
  name: text(),
  enabled: boolean(),
  plan: text(),
  uom: text(),
  country: text(),
  createdAt: timestamp().column('created_at'),
  trialEndAt: timestamp().column('trial_end_at').nullable(),
  stripeConnectAccountId: text().column('stripe_connect_account_id').nullable(),
  stripeConnectAccountOnboarded: boolean().column('stripe_connect_account_onboarded'),
  integrations: manyToMany(() => integration, { junction: 'accounts_integrations' }),
  stores: oneToMany(() => store),
  users: oneToMany(() => user),
})

const place = entity('place', 'places', {
  id: uuid().primaryKey(),
  address: text(),
  latitude: float(),
  longitude: float(),
  isFavorite: boolean().column('is_favorite'),
})

const vehicleCoordinate = entity('vehicleCoordinate', 'vehicle_coordinates', {
  id: uuid().primaryKey(),
  latitude: float(),
  longitude: float(),
  closestRoadLatitude: float().column('closest_road_latitude').nullable(),
  closestRoadLongitude: float().column('closest_road_longitude').nullable(),
  heading: float().nullable(),
  speed: float().nullable(),
  altitude: float().nullable(),
  accuracy: float().nullable(),
  altitudeAccuracy: float().column('altitude_accuracy').nullable(),
  storeDistance: float().column('store_distance').nullable(),
  storeDuration: float().column('store_duration').nullable(),
  createdAt: timestamp().column('created_at'),
})

const zone = entity('zone', 'zones', {
  id: uuid().primaryKey(),
  name: text(),
  color: text(),
  geometry: json(),
  restricted: boolean(),
  enabled: boolean(),
  store: manyToOne(() => store, { column: 'store_id' }),
  createdAt: timestamp().column('created_at'),
  createdBy: manyToOne(() => user, { column: 'created_by' }).nullable(),
  updatedAt: timestamp().column('updated_at').nullable(),
  updatedBy: manyToOne(() => user, { column: 'updated_by' }).nullable(),
})

const storeBusinessHours = entity('storeBusinessHours', 'store_business_hours', {
  id: uuid().primaryKey(),
  sundayStartAt: text().column('sunday_start_at').nullable(),
  sundayEndAt: text().column('sunday_end_at').nullable(),
  mondayStartAt: text().column('monday_start_at').nullable(),
  mondayEndAt: text().column('monday_end_at').nullable(),
  tuesdayStartAt: text().column('tuesday_start_at').nullable(),
  tuesdayEndAt: text().column('tuesday_end_at').nullable(),
  wednesdayStartAt: text().column('wednesday_start_at').nullable(),
  wednesdayEndAt: text().column('wednesday_end_at').nullable(),
  thursdayStartAt: text().column('thursday_start_at').nullable(),
  thursdayEndAt: text().column('thursday_end_at').nullable(),
  fridayStartAt: text().column('friday_start_at').nullable(),
  fridayEndAt: text().column('friday_end_at').nullable(),
  saturdayStartAt: text().column('saturday_start_at').nullable(),
  saturdayEndAt: text().column('saturday_end_at').nullable(),
})

const liveTVWaypoint = entity('liveTVWaypoint', 'live_tv_waypoints', {
  id: uuid().primaryKey(),
  enabled: boolean(),
  color: text(),
  name: text(),
  content: text().nullable(),
  position: integer(),
  place: manyToOne(() => place, { column: 'place_id' }),
})

const workflow = entity('workflow', 'workflows', {
  id: uuid().primaryKey(),
  name: text(),
  color: text(),
  customerReviewsEnabled: boolean().column('customer_reviews_enabled'),
  companyNameRequired: boolean().column('company_name_required'),
  phoneNumberRequired: boolean().column('phone_number_required'),
  customerRequired: boolean().column('customer_required'),
  maximumScheduledAtDays: integer().column('maximum_scheduled_at_days').nullable(),
  allowActivateByDriver: boolean().column('allow_activate_by_driver'),
  schedulerStepSize: integer().column('scheduler_step_size').nullable(),
  defaultReturnTripWorkflow: manyToOne(() => workflow, { column: 'default_return_trip_workflow_id' }).nullable(),
  scheduledTripMessageTemplate: manyToOne(() => messageTemplate, { column: 'scheduled_trip_message_template_id' }).nullable(),
  cancelledTripMessageTemplate: manyToOne(() => messageTemplate, { column: 'cancelled_trip_message_template_id' }).nullable(),
  pendingTripMessageTemplate: manyToOne(() => messageTemplate, { column: 'pending_trip_message_template_id' }).nullable(),
  confirmedTripMessageTemplate: manyToOne(() => messageTemplate, { column: 'confirmed_trip_message_template_id' }).nullable(),
  requestedTripMessageTemplate: manyToOne(() => messageTemplate, { column: 'requested_trip_message_template_id' }).nullable(),
})

const store = entity('store', 'stores', {
  id: uuid().primaryKey(),
  name: text(),
  color: text(),
  enabled: boolean(),
  radiusBound: float().column('radius_bound').nullable(),
  allowTripOutsideRadius: boolean().column('allow_trip_outside_radius'),
  autoDispatchEnabled: boolean().column('auto_dispatch_enabled'),
  autoDispatchScheduledTripEnabled: boolean().column('auto_dispatch_scheduled_trip_enabled'),
  overbookingPreventionEnabled: boolean().column('overbooking_prevention_enabled'),
  tripOptimizationHeuristic: enumType<TripOptimizationHeuristic>(
    'TripOptimizationHeuristic',
    ['MINIMIZE_DISTANCE', 'MINIMIZE_DURATION'],
  ).column('trip_optimization_heuristic'),
  liveTVShortUrl: text().column('live_tv_short_url').nullable(),
  liveTVDescription: text().column('live_tv_description').nullable(),
  createdAt: timestamp().column('created_at'),
  account: manyToOne(() => account, { column: 'account_id' }),
  place: manyToOne(() => place, { column: 'place_id' }),
  users: manyToMany(() => user, { junction: 'users_stores' }),
  vehicles: oneToMany(() => vehicle),
  trips: oneToMany(() => trip),
  zones: oneToMany(() => zone),
  storeBusinessHours: oneToOne(() => storeBusinessHours, { reference: 'store' }).nullable(),
  liveTVWaypoints: oneToMany(() => liveTVWaypoint),
})

const user = entity('user', 'users', {
  id: uuid().primaryKey(),
  firstName: text().column('first_name'),
  lastName: text().column('last_name'),
  email: text(),
  phoneNumber: text().column('phone_number').nullable(),
  role: enumType<UserRole>('UserRole', ['OWNER', 'ADMIN', 'BILLING', 'DISPATCHER', 'DRIVER']),
  enabled: boolean(),
  language: text(),
  profileUrl: text().column('profile_url').nullable(),
  fcmToken: text().column('fcm_token').nullable(),
  lastLoginAt: timestamp().column('last_login_at').nullable(),
  createdAt: timestamp().column('created_at'),
  account: manyToOne(() => account, { column: 'account_id' }),
  stores: manyToMany(() => store, { junction: 'users_stores' }),
  vehicle: oneToOne(() => vehicle, { reference: 'driver' }).nullable(),
  trips: manyToMany(() => trip, { junction: 'trips_drivers' }),
  createdBy: manyToOne(() => user, { column: 'created_by' }).nullable(),
  updatedAt: timestamp().column('updated_at').nullable(),
  updatedBy: manyToOne(() => user, { column: 'updated_by' }).nullable(),
})

const vehicle = entity('vehicle', 'vehicles', {
  id: uuid().primaryKey(),
  make: text(),
  model: text(),
  description: text().nullable(),
  color: text(),
  type: text(),
  licensePlate: text().column('license_plate'),
  seats: integer(),
  enabled: boolean(),
  createdAt: timestamp().column('created_at'),
  driver: manyToOne(() => user, { column: 'driver_id' }).nullable(),
  store: manyToOne(() => store, { column: 'store_id' }),
  vehicleCoordinate: oneToOne(() => vehicleCoordinate, { reference: 'vehicle' }).nullable(),
  trips: oneToMany(() => trip),
})

const customer = entity('customer', 'customers', {
  id: uuid().primaryKey(),
  firstName: text().column('first_name'),
  lastName: text().column('last_name'),
  companyName: text().column('company_name').nullable(),
  phoneNumber: text().column('phone_number'),
  email: text().nullable(),
  language: text(),
  enabled: boolean(),
  smsEnabled: boolean().column('sms_enabled'),
  createdAt: timestamp().column('created_at'),
  store: manyToOne(() => store, { column: 'store_id' }),
  places: manyToMany(() => place, { junction: 'customers_places' }),
  createdBy: manyToOne(() => user, { column: 'created_by' }).nullable(),
  updatedAt: timestamp().column('updated_at').nullable(),
  updatedBy: manyToOne(() => user, { column: 'updated_by' }).nullable(),
})

const customerReview = entity('customerReview', 'customer_reviews', {
  id: uuid().primaryKey(),
  rating: integer(),
  comment: text().nullable(),
  createdAt: timestamp().column('created_at'),
})

const step = entity('step', 'steps', {
  id: uuid().primaryKey(),
  name: text().nullable(),
  type: enumType<StepType>('StepType', ['place', 'pickup', 'dropoff']),
  position: integer(),
  imageUrl: text().column('image_url').nullable(),
  imageUrls: textArray().column('image_urls').nullable(),
  videoUrl: text().column('video_url').nullable(),
  signerName: text().column('signer_name').nullable(),
  skipped: boolean(),
  finishedAt: timestamp().column('finished_at').nullable(),
  place: manyToOne(() => place, { column: 'place_id' }).nullable(),
  driver: manyToOne(() => user, { column: 'driver_id' }).nullable(),
  vehicle: manyToOne(() => vehicle, { column: 'vehicle_id' }).nullable(),
  vehicleCoordinate: manyToOne(() => vehicleCoordinate, { column: 'vehicle_coordinate_id' }).nullable(),
})

const tripNote = entity('tripNote', 'trip_notes', {
  id: uuid().primaryKey(),
  content: text(),
  createdAt: timestamp().column('created_at'),
  updatedAt: timestamp().column('updated_at').nullable(),
  createdBy: manyToOne(() => user, { column: 'created_by' }).nullable(),
})

const tripStateEvent = entity('tripStateEvent', 'trip_state_events', {
  id: uuid().primaryKey(),
  prevState: enumType<TripState>('TripState', ['REQUESTED', 'SCHEDULED', 'CONFIRMED', 'EN_ROUTE', 'COMPLETED', 'CANCELLED']).column('prev_state'),
  nextState: enumType<TripState>('TripState', ['REQUESTED', 'SCHEDULED', 'CONFIRMED', 'EN_ROUTE', 'COMPLETED', 'CANCELLED']).column('next_state'),
  createdAt: timestamp().column('created_at'),
  createdBy: manyToOne(() => user, { column: 'created_by' }).nullable(),
})

const trip = entity('trip', 'trips', {
  id: uuid().primaryKey(),
  state: enumType<TripState>('TripState', ['REQUESTED', 'SCHEDULED', 'CONFIRMED', 'EN_ROUTE', 'COMPLETED', 'CANCELLED']),
  position: integer().nullable(),
  seats: integer(),
  reference: text().nullable(),
  shortUrl: text().column('short_url').nullable(),
  scheduledAt: timestamp().column('scheduled_at').nullable(),
  requestedAt: timestamp().column('requested_at').nullable(),
  notifyAt: timestamp().column('notify_at').nullable(),
  createdAt: timestamp().column('created_at'),
  confirmedAt: timestamp().column('confirmed_at').nullable(),
  finishedAt: timestamp().column('finished_at').nullable(),
  predictedDistance: float().column('predicted_distance').nullable(),
  actualDistance: float().column('actual_distance').nullable(),
  predictedDuration: float().column('predicted_duration').nullable(),
  geometry: json().nullable(),
  customer: manyToOne(() => customer, { column: 'customer_id' }).nullable(),
  secondaryCustomer: manyToOne(() => customer, { column: 'secondary_customer_id' }).nullable(),
  store: manyToOne(() => store, { column: 'store_id' }),
  vehicle: manyToOne(() => vehicle, { column: 'vehicle_id' }).nullable(),
  workflow: manyToOne(() => workflow, { column: 'workflow_id' }).nullable(),
  zone: manyToOne(() => zone, { column: 'zone_id' }).nullable(),
  customerReview: oneToOne(() => customerReview, { reference: 'trip' }).nullable(),
  steps: oneToMany(() => step),
  notes: oneToMany(() => tripNote),
  drivers: manyToMany(() => user, { junction: 'trips_drivers' }),
  stateEvents: oneToMany(() => tripStateEvent),
  returnTrip: manyToOne(() => trip, { column: 'return_trip_id' }).nullable(),
  returnTripFor: oneToOne(() => trip, { reference: 'returnTrip' }).nullable(),
  createdBy: manyToOne(() => user, { column: 'created_by' }).nullable(),
  confirmedBy: manyToOne(() => user, { column: 'confirmed_by' }).nullable(),
  finishedBy: manyToOne(() => user, { column: 'finished_by' }).nullable(),
})

// ── Mock OQL ──

function mockOQL() {
  const calls: { method: string; query: string; params?: Record<string, unknown> }[] = []
  return {
    calls,
    queryOne: async (q: string, params?: Record<string, unknown>) => {
      calls.push({ method: 'queryOne', query: q, params })
      return undefined
    },
    queryMany: async (q: string, params?: Record<string, unknown>) => {
      calls.push({ method: 'queryMany', query: q, params })
      return []
    },
    count: async (q: string, params?: Record<string, unknown>) => {
      calls.push({ method: 'count', query: q, params })
      return 0
    },
  }
}

// ═══════════════════════════════════════════════════════════════════
// Tests based on real shuttlecontrol-api queries
// ═══════════════════════════════════════════════════════════════════

describe('AutoDispatchService: find available drivers', () => {
  // Based on AutoDispatchService.ts:339-365
  // user → vehicle → vehicleCoordinate (4 levels)
  // user → trips → steps → place (4 levels)
  // EXISTS on stores relation, IN on trip states, IS NULL on step finishedAt

  it('projects driver with vehicle coordinates and active trip steps', async () => {
    const oql = mockOQL()

    const qb = query(oql, user)
      .select('id', {
        vehicle: ['seats', {
          vehicleCoordinate: ['latitude', 'longitude'],
        }],
        trips: ['id', 'seats', 'predictedDistance', {
          steps: ['id', {
            place: ['id', 'latitude', 'longitude'],
          }],
        }],
      })
      .where(
        and(
          exists(user.stores, eq(store.id, 'store-1')),
          eq(user.enabled, true),
          eq(user.role, 'DRIVER'),
        ),
      )

    type Result = Awaited<ReturnType<typeof qb.many>>[number]
    type _ = AssertTrue<
      AssertEqual<
        Result,
        {
          id: string
          vehicle: {
            seats: number
            vehicleCoordinate: { latitude: number; longitude: number } | null
          } | null
          trips: {
            id: string
            seats: number
            predictedDistance: number | null
            steps: {
              id: string
              place: { id: string; latitude: number; longitude: number } | null
            }[]
          }[]
        }
      >
    >

    await qb.many()
    assert.equal(
      oql.calls[0].query,
      'user {id vehicle {seats vehicleCoordinate {latitude longitude}} trips {id seats predictedDistance steps {id place {id latitude longitude}}}} [EXISTS(stores [id = :p0]) AND enabled = :p1 AND role = :p2]',
    )
    assert.deepEqual(oql.calls[0].params, {
      p0: 'store-1',
      p1: true,
      p2: 'DRIVER',
    })
  })
})

describe('AutoDispatchService: scheduled trip vehicles', () => {
  // Based on AutoDispatchService.ts:167-193
  // vehicle → trips → steps → place (4 levels)
  // BETWEEN date range on trip scheduledAt

  it('projects vehicles with scheduled trips and step places', async () => {
    const oql = mockOQL()
    const startDate = new Date('2026-03-11T08:00:00Z')
    const endDate = new Date('2026-03-11T18:00:00Z')

    const qb = query(oql, vehicle)
      .select('id', 'seats', {
        trips: ['id', 'seats', 'predictedDistance', {
          steps: ['id', {
            place: ['id', 'latitude', 'longitude'],
          }],
        }],
      })
      .where(
        and(
          eq(vehicle.store, 'store-1'),
          eq(vehicle.enabled, true),
        ),
      )

    type Result = Awaited<ReturnType<typeof qb.many>>[number]
    type _ = AssertTrue<
      AssertEqual<
        Result,
        {
          id: string
          seats: number
          trips: {
            id: string
            seats: number
            predictedDistance: number | null
            steps: {
              id: string
              place: { id: string; latitude: number; longitude: number } | null
            }[]
          }[]
        }
      >
    >

    await qb.many()
    assert.equal(
      oql.calls[0].query,
      'vehicle {id seats trips {id seats predictedDistance steps {id place {id latitude longitude}}}} [store = :p0 AND enabled = :p1]',
    )
  })
})

describe('TripController: trip websocket query (simplified)', () => {
  // Based on TripController.ts:43-158 — the most complex query in the codebase
  // Simplified to key relations: customer, workflow, store, steps, notes, drivers, vehicle, zone, stateEvents

  it('projects trip with all major relations and nested entities', async () => {
    const oql = mockOQL()

    const qb = query(oql, trip)
      .select('id', 'state', 'position', 'seats', 'reference', 'scheduledAt', 'requestedAt', 'createdAt', 'confirmedAt', 'finishedAt', 'predictedDistance', 'actualDistance', 'predictedDuration', 'geometry', {
        customer: ['id', 'firstName', 'lastName', 'companyName', 'phoneNumber', 'email', 'language'],
        customerReview: ['id', 'rating', 'comment', 'createdAt'],
        workflow: ['id', 'name', 'color', 'customerReviewsEnabled', 'companyNameRequired', 'phoneNumberRequired', 'customerRequired', 'maximumScheduledAtDays', 'allowActivateByDriver', 'schedulerStepSize', {
          defaultReturnTripWorkflow: ['id', 'name'],
          scheduledTripMessageTemplate: ['id'],
          cancelledTripMessageTemplate: ['id'],
          confirmedTripMessageTemplate: ['id'],
          requestedTripMessageTemplate: ['id'],
        }],
        store: ['id', 'name', 'overbookingPreventionEnabled', {
          place: ['id', 'address', 'latitude', 'longitude', 'isFavorite'],
          storeBusinessHours: ['sundayStartAt', 'sundayEndAt', 'mondayStartAt', 'mondayEndAt', 'tuesdayStartAt', 'tuesdayEndAt', 'wednesdayStartAt', 'wednesdayEndAt', 'thursdayStartAt', 'thursdayEndAt', 'fridayStartAt', 'fridayEndAt', 'saturdayStartAt', 'saturdayEndAt'],
        }],
        steps: ['id', 'name', 'type', 'position', 'imageUrl', 'signerName', 'skipped', 'finishedAt', {
          place: ['id', 'address', 'latitude', 'longitude', 'isFavorite'],
          driver: ['id', 'firstName', 'lastName'],
          vehicle: ['id', 'make', 'model', 'licensePlate'],
          vehicleCoordinate: ['createdAt', 'latitude', 'longitude', 'closestRoadLatitude', 'closestRoadLongitude', 'heading'],
        }],
        notes: ['id', 'content', 'createdAt', 'updatedAt', {
          createdBy: ['id', 'firstName', 'lastName', 'phoneNumber', 'profileUrl'],
        }],
        drivers: ['id', 'firstName', 'lastName', 'fcmToken', 'language', 'phoneNumber', {
          vehicle: ['id'],
        }],
        vehicle: ['id', 'make', 'model', 'description', 'color', 'licensePlate', 'seats', {
          driver: ['id', 'firstName', 'lastName', 'phoneNumber'],
          vehicleCoordinate: ['createdAt', 'latitude', 'longitude', 'closestRoadLatitude', 'closestRoadLongitude', 'heading'],
          store: ['id'],
        }],
        returnTrip: ['id', 'state'],
        returnTripFor: ['id', 'state'],
        createdBy: ['id', 'firstName', 'lastName', 'phoneNumber', 'profileUrl'],
        confirmedBy: ['id', 'firstName', 'lastName', 'phoneNumber', 'profileUrl'],
        finishedBy: ['id', 'firstName', 'lastName', 'phoneNumber'],
        zone: ['id', 'name', 'geometry', 'color'],
        stateEvents: ['id', 'prevState', 'nextState', 'createdAt', {
          createdBy: ['id', 'firstName', 'lastName'],
        }],
      })
      .where(eq(trip.id, 'trip-123'))

    type Result = Awaited<ReturnType<typeof qb.one>>
    type _ = AssertTrue<
      AssertEqual<
        Result,
        | {
            id: string
            state: TripState
            position: number | null
            seats: number
            reference: string | null
            scheduledAt: Date | null
            requestedAt: Date | null
            createdAt: Date
            confirmedAt: Date | null
            finishedAt: Date | null
            predictedDistance: number | null
            actualDistance: number | null
            predictedDuration: number | null
            geometry: unknown
            customer: {
              id: string
              firstName: string
              lastName: string
              companyName: string | null
              phoneNumber: string
              email: string | null
              language: string
            } | null
            customerReview: {
              id: string
              rating: number
              comment: string | null
              createdAt: Date
            } | null
            workflow: {
              id: string
              name: string
              color: string
              customerReviewsEnabled: boolean
              companyNameRequired: boolean
              phoneNumberRequired: boolean
              customerRequired: boolean
              maximumScheduledAtDays: number | null
              allowActivateByDriver: boolean
              schedulerStepSize: number | null
              defaultReturnTripWorkflow: {
                id: string
                name: string
              } | null
              scheduledTripMessageTemplate: { id: string } | null
              cancelledTripMessageTemplate: { id: string } | null
              confirmedTripMessageTemplate: { id: string } | null
              requestedTripMessageTemplate: { id: string } | null
            } | null
            store: {
              id: string
              name: string
              overbookingPreventionEnabled: boolean
              place: {
                id: string
                address: string
                latitude: number
                longitude: number
                isFavorite: boolean
              }
              storeBusinessHours: {
                sundayStartAt: string | null
                sundayEndAt: string | null
                mondayStartAt: string | null
                mondayEndAt: string | null
                tuesdayStartAt: string | null
                tuesdayEndAt: string | null
                wednesdayStartAt: string | null
                wednesdayEndAt: string | null
                thursdayStartAt: string | null
                thursdayEndAt: string | null
                fridayStartAt: string | null
                fridayEndAt: string | null
                saturdayStartAt: string | null
                saturdayEndAt: string | null
              } | null
            }
            steps: {
              id: string
              name: string | null
              type: StepType
              position: number
              imageUrl: string | null
              signerName: string | null
              skipped: boolean
              finishedAt: Date | null
              place: {
                id: string
                address: string
                latitude: number
                longitude: number
                isFavorite: boolean
              } | null
              driver: { id: string; firstName: string; lastName: string } | null
              vehicle: { id: string; make: string; model: string; licensePlate: string } | null
              vehicleCoordinate: {
                createdAt: Date
                latitude: number
                longitude: number
                closestRoadLatitude: number | null
                closestRoadLongitude: number | null
                heading: number | null
              } | null
            }[]
            notes: {
              id: string
              content: string
              createdAt: Date
              updatedAt: Date | null
              createdBy: {
                id: string
                firstName: string
                lastName: string
                phoneNumber: string | null
                profileUrl: string | null
              } | null
            }[]
            drivers: {
              id: string
              firstName: string
              lastName: string
              fcmToken: string | null
              language: string
              phoneNumber: string | null
              vehicle: { id: string } | null
            }[]
            vehicle: {
              id: string
              make: string
              model: string
              description: string | null
              color: string
              licensePlate: string
              seats: number
              driver: {
                id: string
                firstName: string
                lastName: string
                phoneNumber: string | null
              } | null
              vehicleCoordinate: {
                createdAt: Date
                latitude: number
                longitude: number
                closestRoadLatitude: number | null
                closestRoadLongitude: number | null
                heading: number | null
              } | null
              store: { id: string }
            } | null
            returnTrip: { id: string; state: TripState } | null
            returnTripFor: { id: string; state: TripState } | null
            createdBy: {
              id: string
              firstName: string
              lastName: string
              phoneNumber: string | null
              profileUrl: string | null
            } | null
            confirmedBy: {
              id: string
              firstName: string
              lastName: string
              phoneNumber: string | null
              profileUrl: string | null
            } | null
            finishedBy: {
              id: string
              firstName: string
              lastName: string
              phoneNumber: string | null
            } | null
            zone: { id: string; name: string; geometry: unknown; color: string } | null
            stateEvents: {
              id: string
              prevState: TripState
              nextState: TripState
              createdAt: Date
              createdBy: { id: string; firstName: string; lastName: string } | null
            }[]
          }
        | undefined
      >
    >

    await qb.one()
    assert.equal(
      oql.calls[0].query,
      'trip {id state position seats reference scheduledAt requestedAt createdAt confirmedAt finishedAt predictedDistance actualDistance predictedDuration geometry customer {id firstName lastName companyName phoneNumber email language} customerReview {id rating comment createdAt} workflow {id name color customerReviewsEnabled companyNameRequired phoneNumberRequired customerRequired maximumScheduledAtDays allowActivateByDriver schedulerStepSize defaultReturnTripWorkflow {id name} scheduledTripMessageTemplate {id} cancelledTripMessageTemplate {id} confirmedTripMessageTemplate {id} requestedTripMessageTemplate {id}} store {id name overbookingPreventionEnabled place {id address latitude longitude isFavorite} storeBusinessHours {sundayStartAt sundayEndAt mondayStartAt mondayEndAt tuesdayStartAt tuesdayEndAt wednesdayStartAt wednesdayEndAt thursdayStartAt thursdayEndAt fridayStartAt fridayEndAt saturdayStartAt saturdayEndAt}} steps {id name type position imageUrl signerName skipped finishedAt place {id address latitude longitude isFavorite} driver {id firstName lastName} vehicle {id make model licensePlate} vehicleCoordinate {createdAt latitude longitude closestRoadLatitude closestRoadLongitude heading}} notes {id content createdAt updatedAt createdBy {id firstName lastName phoneNumber profileUrl}} drivers {id firstName lastName fcmToken language phoneNumber vehicle {id}} vehicle {id make model description color licensePlate seats driver {id firstName lastName phoneNumber} vehicleCoordinate {createdAt latitude longitude closestRoadLatitude closestRoadLongitude heading} store {id}} returnTrip {id state} returnTripFor {id state} createdBy {id firstName lastName phoneNumber profileUrl} confirmedBy {id firstName lastName phoneNumber profileUrl} finishedBy {id firstName lastName phoneNumber} zone {id name geometry color} stateEvents {id prevState nextState createdAt createdBy {id firstName lastName}}} [id = :p0]',
    )
  })
})

describe('UserService: user profile query', () => {
  // Based on UserService.ts:91-140
  // user → account → integrations (3 levels)
  // user → stores → place (3 levels)
  // user → vehicle → store (3 levels)

  it('projects full user profile with account, stores, and vehicle', async () => {
    const oql = mockOQL()

    const qb = query(oql, user)
      .select('id', 'role', 'enabled', 'firstName', 'lastName', 'phoneNumber', 'email', 'language', 'profileUrl', 'createdAt', 'lastLoginAt', {
        account: ['id', 'enabled', 'name', 'plan', 'uom', 'country', 'createdAt', 'trialEndAt', 'stripeConnectAccountId', 'stripeConnectAccountOnboarded', {
          integrations: ['id', 'name'],
        }],
        stores: ['id', 'name', 'color', 'radiusBound', 'liveTVShortUrl', 'liveTVDescription', 'overbookingPreventionEnabled', 'allowTripOutsideRadius', {
          place: ['id', 'latitude', 'longitude', 'address'],
        }],
        createdBy: ['id', 'firstName', 'lastName'],
        updatedBy: ['id', 'firstName', 'lastName'],
        vehicle: ['id', 'type', 'color', 'model', 'make', 'licensePlate', 'seats', {
          store: ['id', 'name', 'color'],
        }],
      })
      .where(eq(user.id, 'user-1'))

    type Result = Awaited<ReturnType<typeof qb.one>>
    type _ = AssertTrue<
      AssertEqual<
        Result,
        | {
            id: string
            role: UserRole
            enabled: boolean
            firstName: string
            lastName: string
            phoneNumber: string | null
            email: string
            language: string
            profileUrl: string | null
            createdAt: Date
            lastLoginAt: Date | null
            account: {
              id: string
              enabled: boolean
              name: string
              plan: string
              uom: string
              country: string
              createdAt: Date
              trialEndAt: Date | null
              stripeConnectAccountId: string | null
              stripeConnectAccountOnboarded: boolean
              integrations: { id: string; name: string }[]
            }
            stores: {
              id: string
              name: string
              color: string
              radiusBound: number | null
              liveTVShortUrl: string | null
              liveTVDescription: string | null
              overbookingPreventionEnabled: boolean
              allowTripOutsideRadius: boolean
              place: { id: string; latitude: number; longitude: number; address: string }
            }[]
            createdBy: { id: string; firstName: string; lastName: string } | null
            updatedBy: { id: string; firstName: string; lastName: string } | null
            vehicle: {
              id: string
              type: string
              color: string
              model: string
              make: string
              licensePlate: string
              seats: number
              store: { id: string; name: string; color: string }
            } | null
          }
        | undefined
      >
    >

    await qb.one()
    assert.equal(
      oql.calls[0].query,
      'user {id role enabled firstName lastName phoneNumber email language profileUrl createdAt lastLoginAt account {id enabled name plan uom country createdAt trialEndAt stripeConnectAccountId stripeConnectAccountOnboarded integrations {id name}} stores {id name color radiusBound liveTVShortUrl liveTVDescription overbookingPreventionEnabled allowTripOutsideRadius place {id latitude longitude address}} createdBy {id firstName lastName} updatedBy {id firstName lastName} vehicle {id type color model make licensePlate seats store {id name color}}} [id = :p0]',
    )
  })
})

describe('UserService: paginated user list with search', () => {
  // Based on UserService.ts:255-276
  // EXISTS on stores relation with IN filter
  // ILIKE text search across multiple fields
  // Role filter, ordering, pagination

  it('filters by store access, search term, role with pagination', async () => {
    const oql = mockOQL()
    const storeIds = ['s1', 's2', 's3']
    const search = '%john%'

    const qb = query(oql, user)
      .select('id', 'role', 'enabled', 'firstName', 'lastName', 'phoneNumber', 'email', 'language', 'profileUrl', 'createdAt', 'lastLoginAt', {
        account: ['id', 'enabled', 'name', 'plan', 'uom', 'country', 'createdAt', 'trialEndAt', 'stripeConnectAccountId', 'stripeConnectAccountOnboarded', {
          integrations: ['id', 'name'],
        }],
        stores: ['id', 'name', 'color', 'radiusBound', 'liveTVShortUrl', 'liveTVDescription', 'overbookingPreventionEnabled', 'allowTripOutsideRadius', {
          place: ['id', 'latitude', 'longitude', 'address'],
        }],
        vehicle: ['id', 'type', 'color', 'model', 'make', 'licensePlate', 'seats', {
          store: ['id', 'name', 'color'],
        }],
      })
      .where(
        and(
          exists(user.stores, inList(store.id, storeIds)),
          eq(user.enabled, true),
          or(
            ilike(user.firstName, search),
            ilike(user.lastName, search),
            ilike(user.email, search),
          ),
          eq(user.role, 'DISPATCHER'),
        ),
      )
      .orderBy(desc(user.lastLoginAt))
      .limit(25)
      .offset(50)

    await qb.many()
    assert.equal(
      oql.calls[0].query,
      'user {id role enabled firstName lastName phoneNumber email language profileUrl createdAt lastLoginAt account {id enabled name plan uom country createdAt trialEndAt stripeConnectAccountId stripeConnectAccountOnboarded integrations {id name}} stores {id name color radiusBound liveTVShortUrl liveTVDescription overbookingPreventionEnabled allowTripOutsideRadius place {id latitude longitude address}} vehicle {id type color model make licensePlate seats store {id name color}}} [EXISTS(stores [id IN :p0]) AND enabled = :p1 AND (firstName ILIKE :p2 OR lastName ILIKE :p3 OR email ILIKE :p4) AND role = :p5] <lastLoginAt DESC> |50, 25|',
    )
    assert.deepEqual(oql.calls[0].params, {
      p0: storeIds,
      p1: true,
      p2: search,
      p3: search,
      p4: search,
      p5: 'DISPATCHER',
    })
  })
})

describe('ZoneService: trips without zones', () => {
  // Based on ZoneService.ts:94-117
  // trip → steps → place (3 levels)
  // IS NULL on zone, IN on trip states

  it('finds trips with no zone assigned, projecting step places', async () => {
    const oql = mockOQL()

    const qb = query(oql, trip)
      .select('id', 'state', {
        steps: ['id', 'type', {
          place: ['id', 'latitude', 'longitude'],
        }],
      })
      .where(
        and(
          inList(trip.state, ['REQUESTED', 'SCHEDULED']),
          eq(trip.store, 'store-1'),
          isNull(trip.zone),
        ),
      )
      .orderBy(desc(trip.createdAt))
      .limit(1000)

    type Result = Awaited<ReturnType<typeof qb.many>>[number]
    type _ = AssertTrue<
      AssertEqual<
        Result,
        {
          id: string
          state: TripState
          steps: {
            id: string
            type: StepType
            place: { id: string; latitude: number; longitude: number } | null
          }[]
        }
      >
    >

    await qb.many()
    assert.equal(
      oql.calls[0].query,
      'trip {id state steps {id type place {id latitude longitude}}} [state IN :p0 AND store = :p1 AND zone IS NULL] <createdAt DESC> |, 1000|',
    )
    assert.deepEqual(oql.calls[0].params, {
      p0: ['REQUESTED', 'SCHEDULED'],
      p1: 'store-1',
    })
  })
})

describe('StoreService: store list with waypoints and zones', () => {
  // Based on StoreService.ts:146-183
  // store → place, store → liveTVWaypoints → place, store → zones
  // EXISTS on users relation

  it('projects stores with nested waypoints, zones, and place details', async () => {
    const oql = mockOQL()

    const qb = query(oql, store)
      .select('id', 'name', 'color', 'enabled', 'radiusBound', 'allowTripOutsideRadius',
        'autoDispatchEnabled', 'autoDispatchScheduledTripEnabled',
        'overbookingPreventionEnabled', 'tripOptimizationHeuristic',
        'createdAt', 'liveTVShortUrl', 'liveTVDescription', {
          place: ['id', 'address', 'latitude', 'longitude'],
          liveTVWaypoints: ['id', 'enabled', 'color', 'name', 'content', 'position', {
            place: ['id', 'address', 'latitude', 'longitude'],
          }],
          zones: ['id', 'geometry', 'color', 'restricted'],
        })
      .where(
        and(
          eq(store.enabled, true),
          exists(store.users, eq(user.id, 'user-1')),
        ),
      )
      .orderBy(asc(store.createdAt))

    type Result = Awaited<ReturnType<typeof qb.many>>[number]
    type _ = AssertTrue<
      AssertEqual<
        Result,
        {
          id: string
          name: string
          color: string
          enabled: boolean
          radiusBound: number | null
          allowTripOutsideRadius: boolean
          autoDispatchEnabled: boolean
          autoDispatchScheduledTripEnabled: boolean
          overbookingPreventionEnabled: boolean
          tripOptimizationHeuristic: TripOptimizationHeuristic
          createdAt: Date
          liveTVShortUrl: string | null
          liveTVDescription: string | null
          place: { id: string; address: string; latitude: number; longitude: number }
          liveTVWaypoints: {
            id: string
            enabled: boolean
            color: string
            name: string
            content: string | null
            position: number
            place: { id: string; address: string; latitude: number; longitude: number }
          }[]
          zones: { id: string; geometry: unknown; color: string; restricted: boolean }[]
        }
      >
    >

    await qb.many()
    assert.equal(
      oql.calls[0].query,
      'store {id name color enabled radiusBound allowTripOutsideRadius autoDispatchEnabled autoDispatchScheduledTripEnabled overbookingPreventionEnabled tripOptimizationHeuristic createdAt liveTVShortUrl liveTVDescription place {id address latitude longitude} liveTVWaypoints {id enabled color name content position place {id address latitude longitude}} zones {id geometry color restricted}} [enabled = :p0 AND EXISTS(users [id = :p1])] <createdAt ASC>',
    )
  })
})

describe('CustomerService: customer find with search', () => {
  // Based on CustomerService.ts:67-107
  // customer → store, customer → createdBy, customer → updatedBy, customer → places

  it('finds customers with store, audit trail, and places', async () => {
    const oql = mockOQL()

    const qb = query(oql, customer)
      .select('id', 'enabled', 'firstName', 'lastName', 'email', 'language', 'companyName', 'phoneNumber', 'smsEnabled', 'createdAt', {
        store: ['id', 'name'],
        createdBy: ['id', 'firstName', 'lastName'],
        updatedBy: ['id', 'firstName', 'lastName'],
        places: ['id', 'address', 'isFavorite'],
      })
      .where(
        and(
          inList(customer.store, ['s1', 's2']),
          eq(customer.enabled, true),
          or(
            ilike(customer.firstName, '%smith%'),
            ilike(customer.lastName, '%smith%'),
            ilike(customer.phoneNumber, '%555%'),
          ),
        ),
      )
      .orderBy(desc(customer.createdAt))
      .limit(50)
      .offset(0)

    type Result = Awaited<ReturnType<typeof qb.many>>[number]
    type _ = AssertTrue<
      AssertEqual<
        Result,
        {
          id: string
          enabled: boolean
          firstName: string
          lastName: string
          email: string | null
          language: string
          companyName: string | null
          phoneNumber: string
          smsEnabled: boolean
          createdAt: Date
          store: { id: string; name: string }
          createdBy: { id: string; firstName: string; lastName: string } | null
          updatedBy: { id: string; firstName: string; lastName: string } | null
          places: { id: string; address: string; isFavorite: boolean }[]
        }
      >
    >

    await qb.many()
    assert.equal(
      oql.calls[0].query,
      'customer {id enabled firstName lastName email language companyName phoneNumber smsEnabled createdAt store {id name} createdBy {id firstName lastName} updatedBy {id firstName lastName} places {id address isFavorite}} [store IN :p0 AND enabled = :p1 AND (firstName ILIKE :p2 OR lastName ILIKE :p3 OR phoneNumber ILIKE :p4)] <createdAt DESC> |0, 50|',
    )
  })
})

describe('VehicleService: vehicle find with coordinates', () => {
  // Based on VehicleService.ts:263-314
  // vehicle → driver, vehicle → store, vehicle → vehicleCoordinate

  it('finds vehicles with driver, store, and live coordinates', async () => {
    const oql = mockOQL()

    const qb = query(oql, vehicle)
      .select('id', 'type', 'enabled', 'seats', 'make', 'model', 'description', 'color', 'licensePlate', 'createdAt', {
        driver: ['id', 'firstName', 'lastName'],
        store: ['id', 'name', 'color'],
        vehicleCoordinate: ['id', 'latitude', 'longitude', 'closestRoadLatitude', 'closestRoadLongitude', 'altitude', 'accuracy', 'altitudeAccuracy', 'heading', 'speed', 'createdAt', 'storeDistance', 'storeDuration'],
      })
      .where(
        and(
          inList(vehicle.store, ['s1', 's2']),
          eq(vehicle.enabled, true),
          or(
            ilike(vehicle.make, '%toyota%'),
            ilike(vehicle.model, '%camry%'),
            ilike(vehicle.licensePlate, '%ABC%'),
          ),
        ),
      )
      .orderBy(desc(vehicle.createdAt))
      .limit(25)
      .offset(0)

    type Result = Awaited<ReturnType<typeof qb.many>>[number]
    type _ = AssertTrue<
      AssertEqual<
        Result,
        {
          id: string
          type: string
          enabled: boolean
          seats: number
          make: string
          model: string
          description: string | null
          color: string
          licensePlate: string
          createdAt: Date
          driver: { id: string; firstName: string; lastName: string } | null
          store: { id: string; name: string; color: string }
          vehicleCoordinate: {
            id: string
            latitude: number
            longitude: number
            closestRoadLatitude: number | null
            closestRoadLongitude: number | null
            altitude: number | null
            accuracy: number | null
            altitudeAccuracy: number | null
            heading: number | null
            speed: number | null
            createdAt: Date
            storeDistance: number | null
            storeDuration: number | null
          } | null
        }
      >
    >

    await qb.many()
    assert.equal(
      oql.calls[0].query,
      'vehicle {id type enabled seats make model description color licensePlate createdAt driver {id firstName lastName} store {id name color} vehicleCoordinate {id latitude longitude closestRoadLatitude closestRoadLongitude altitude accuracy altitudeAccuracy heading speed createdAt storeDistance storeDuration}} [store IN :p0 AND enabled = :p1 AND (make ILIKE :p2 OR model ILIKE :p3 OR licensePlate ILIKE :p4)] <createdAt DESC> |0, 25|',
    )
  })
})
