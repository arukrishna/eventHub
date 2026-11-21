# EventHub — Booking Management Test Strategy

Generated: 2026-11-01
Input: `docs/test-scenarios.md` (60 scenarios: TC-001–009, TC-100–110, TC-200–208, TC-300–310, TC-400–408, TC-500–510)
Scope: Booking lifecycle and management

---

## 1. Layer Distribution

| Primary layer | Scenarios | Focus | Approx. run time |
|---|---:|---|---:|
| **Unit** | 3 | Booking reference generation through the service with dependencies mocked | < 1s |
| **API / Integration** | 28 | Auth, validation, booking service rules, ownership, persistence, pagination | 15–45s |
| **Component / UI with mocked API** | 20 | Booking pages and controls under controlled loading, error, and response states | 15–40s |
| **E2E** | 9 | Critical user journeys and cross-account behavior in a real browser | 2–4 min |
| **Total** | **60** | | |

This keeps the broadest coverage at the API and UI layers and reserves E2E for workflows that need real navigation, browser state, or an end-to-end assertion. The repository currently has a Playwright E2E setup only; the Unit, API, and isolated Component/UI suites below are strategy recommendations, not existing test commands. UI tests that use Playwright route interception exercise the full page with a mocked API; they are not isolated React component tests.

---

## 2. Layer Assignments

### Unit — 3 scenarios

Test `bookingService.createBooking` with mocked repository and Prisma dependencies. Keep the helper functions private; control `Math.random` and the clock in the test. This requires adding a unit-test runner/harness, which is not currently configured.

| TC | Scenario | Source and assertions |
|---|---|---|
| TC-102 | Booking reference starts with the event title's first character | `backend/src/services/bookingService.js` — invoke the service with a known event title and verify the generated reference prefix and six-character suffix. |
| TC-405 | Booking reference collision retry and fallback | `backend/src/services/bookingService.js` — make `bookingRepository.findByRef` report collisions for ten generated values; verify retry behavior and the timestamp fallback format. |
| TC-408 | Numeric event title prefix | `backend/src/services/bookingService.js` — invoke the service for a title beginning with a digit and verify the digit is retained in the reference prefix. |

TC-102 also receives an API contract assertion through booking creation. TC-405 is best kept at the service unit boundary: relying on naturally occurring collisions in a database-backed test is nondeterministic.

### API / Integration — 28 scenarios

Use the authenticated HTTP API with an isolated test database/account. Assert status, response body, and persisted state where applicable. The main implementation is in `backend/src/routes/bookingRoutes.js`, `backend/src/controllers/bookingController.js`, `backend/src/services/bookingService.js`, `backend/src/repositories/bookingRepository.js`, `backend/src/validators/bookingValidator.js`, and `backend/src/middleware/authMiddleware.js`.

| TC | Scenario | Endpoint / source |
|---|---|---|
| TC-007 | Lookup own booking by reference | `GET /api/bookings/ref/:ref`; controller and `bookingService.getBookingByRef`. |
| TC-100 | Tenth booking prunes oldest booking from another event | `POST /api/bookings`, then `GET /api/bookings`; `bookingService.createBooking` FIFO selection. |
| TC-101 | Same-event replacement adjusts availability once | `POST /api/bookings`, then `GET /api/events/:id`; `bookingService.createBooking` and `eventRepository.decrementSeats`. |
| TC-106 | Total price equals price multiplied by quantity | `POST /api/bookings`; verify `totalPrice` from the created booking against the event price and quantity. |
| TC-107 | First-page list pagination shape | `GET /api/bookings?page=1&limit=10`; `bookingService.getBookings`. Seed fixtures directly if testing more than the normal nine-booking limit. |
| TC-108 | Cancellation releases computed seats for a dynamic event | `DELETE /api/bookings/:id`, then `GET /api/events/:id`; booking deletion and per-user availability. |
| TC-110 | Event/status filters and newest-first ordering | `GET /api/bookings?eventId=…&status=confirmed&page=1&limit=10`; `bookingRepository.findAll`. |
| TC-201 | Cross-user booking detail returns 403 | `GET /api/bookings/:id`; `bookingService.getBookingById` ownership check. |
| TC-202 | Cross-user cancellation is rejected without deleting the booking | `DELETE /api/bookings/:id`; `bookingService.cancelBooking`. Assert the documented 403 expectation and verify persisted state. See the implementation mismatch below. |
| TC-203 | Unauthenticated booking list returns 401 | `GET /api/bookings`; `authMiddleware`. |
| TC-204 | Unauthenticated booking detail returns 401 | `GET /api/bookings/:id`; `authMiddleware`. |
| TC-205 | Unauthenticated clear-all returns 401 | `DELETE /api/bookings`; `authMiddleware`. |
| TC-206 | Cross-user lookup by reference returns 403 | `GET /api/bookings/ref/:ref`; `bookingService.getBookingByRef`. |
| TC-207 | Clear-all deletes only the authenticated user's bookings | `DELETE /api/bookings`; `bookingService.clearAllBookings` and `bookingRepository.deleteAllForUser`. |
| TC-208 | Unauthenticated booking create and cancel return 401 | `POST /api/bookings` and `DELETE /api/bookings/:id`; route-level `authMiddleware`. |
| TC-301 | Missing booking ID returns 404 | `GET /api/bookings/:id`; `bookingService.getBookingById` and error middleware. |
| TC-302 | Insufficient seats return 400 | `POST /api/bookings`; `bookingService.createBooking` seat check. |
| TC-303 | Missing event returns 404 | `POST /api/bookings`; event lookup in `bookingService.createBooking`. |
| TC-304 | Missing required booking fields return 400 | `POST /api/bookings`; `validateCreateBooking` in `bookingValidator.js`. |
| TC-305 | Zero or negative quantity returns 400 | `POST /api/bookings`; integer range validation in `bookingValidator.js`. |
| TC-306 | Quantity greater than 10 returns 400 | `POST /api/bookings`; integer range validation in `bookingValidator.js`. |
| TC-307 | Repeated cancellation returns 404 | Two `DELETE /api/bookings/:id` requests; `bookingService.cancelBooking`. |
| TC-309 | Invalid customer fields and fractional quantity return 400 | `POST /api/bookings`; name, email, phone, and integer validation in `bookingValidator.js`. |
| TC-310 | Failed tenth booking preserves all existing bookings | `POST /api/bookings`, then `GET /api/bookings`; assert the original nine records remain after both invalid-event and insufficient-seat attempts. This is expected to expose the mutation-order issue below. |
| TC-400 | FIFO pruning chooses the oldest booking from another event | `POST /api/bookings` with nine existing bookings; `bookingService.createBooking` and repository FIFO queries. This overlaps TC-100 and can share a parameterized fixture/test. |
| TC-401 | Equal-quantity same-event replacement preserves available seats | `POST /api/bookings`, then `GET /api/events/:id`; compare availability before and after the replacement. This is expected to expose the seat-decrement issue below. |
| TC-406 | Clear all with one booking returns the correct result | `DELETE /api/bookings`; assert HTTP 200 and the controller's `"1 booking(s) cleared"` message. TC-004 covers the browser journey. |
| TC-407 | Page two returns the expected partial results | `GET /api/bookings?page=2&limit=5`; seed more than five records directly, since the normal booking flow caps a user at nine. |

### Component / UI with mocked API — 20 scenarios

Prefer isolated component tests if a React component harness is introduced. Until then, Playwright route interception can validate page rendering and user interactions without relying on backend data. Booking screens/components: `frontend/app/bookings/page.tsx`, `frontend/app/bookings/[id]/page.tsx`, and `frontend/components/bookings/BookingCard.jsx`.

| TC | Scenario | UI target and assertion |
|---|---|---|
| TC-005 | Navigate back to the bookings list | Booking detail page; click the back link and assert the `/bookings` route. |
| TC-103 | Single-ticket refund eligibility | Refund UI on `[id]/page.tsx`; with quantity 1, check and assert the eligible result. |
| TC-104 | Multi-ticket refund ineligibility | Refund UI; with quantity 3, assert the ineligible result includes the ticket count. |
| TC-105 | Refund spinner duration/state | Refund UI; assert the spinner while checking and result after four seconds. Use a controllable clock rather than an arbitrary sleep. |
| TC-109 | Clear-all control is visible with bookings | Bookings page with a mocked non-empty response; assert the clear-all button is present. |
| TC-300 | Missing booking renders not-found state | Detail page with a mocked 404 response; assert “Booking not found” and the return link. TC-301 covers the real API status. |
| TC-308 | Bookings page renders its server-error state | Bookings page with a mocked failed response; assert error copy and Retry control. |
| TC-402 | Quantity minimum is one | Booking form in `frontend/app/events/[id]/page.tsx`; assert decrement is disabled at the minimum. |
| TC-403 | Quantity maximum is ten | Booking form with enough seats; increment to ten and assert increment is disabled and total updates. |
| TC-404 | Quantity two is the first refund-ineligible value | Refund UI with quantity 2; assert the ineligible message includes “2 tickets”. |
| TC-500 | Bookings list loading skeletons render | Bookings page with a delayed mocked response; assert five skeleton cards before fulfillment. |
| TC-501 | Empty bookings state renders | Bookings page with an empty response; assert the empty-state copy and Browse Events link. |
| TC-502 | Booking detail loading spinner renders | Detail page with a delayed mocked response; assert the loading spinner before fulfillment. |
| TC-503 | Cancellation confirmation dialog renders | Booking detail page with a mocked booking; open the dialog and assert its title, description, and confirm action. |
| TC-504 | Dismissing cancellation does not issue a delete | Booking detail page with a mocked booking; dismiss the dialog and assert no DELETE request was sent. |
| TC-505 | Detail breadcrumb displays the booking reference | Detail page with a mocked booking; assert the breadcrumb and reference text. TC-002 also sees the detail page in a real journey. |
| TC-507 | Clear-all button shows its pending state | Bookings page with a delayed DELETE response; assert “Clearing…” and disabled state while pending. |
| TC-508 | Refund controls transition from idle to result | Refund UI; assert the button, checking spinner, and final result appear in sequence. |
| TC-509 | Detail page renders Access Denied for 403 | Detail page with a mocked 403 response; assert Access Denied rather than not-found. TC-200 verifies the real cross-account flow. |
| TC-510 | Pagination controls render and update the URL | Bookings page with a mocked multi-page response; assert controls and the page query parameter after navigation. |

### E2E — 9 scenarios

Use a real browser and local/test backend with isolated data. Keep API validation, deterministic UI states, and database-heavy FIFO setup out of E2E.

| TC | Scenario | Journey |
|---|---|---|
| TC-001 | View a booking in the bookings list | Sign in, create or seed a booking, open `/bookings`, and verify its card. |
| TC-002 | View booking details | Open a booking card and verify event, customer, payment, and booking information. |
| TC-003 | Cancel a booking from its detail page | Open details, confirm cancellation, and verify redirect, toast, and removal. |
| TC-004 | Clear all bookings | Confirm clear-all and verify the empty state. |
| TC-006 | Navigate to bookings after booking an event | Book from the event page, use “View My Bookings”, and verify the created booking appears. |
| TC-008 | Cancel from a booking list card | Open the card-level dialog, confirm, and verify the refreshed list and success notification. |
| TC-009 | Create a booking and view its confirmation | Submit a valid booking, assert the 201 response and confirmation data, then verify the booking appears in the list. |
| TC-200 | Cross-user access shows Access Denied | Use two isolated authenticated browser contexts; create as A and view the booking as B. |
| TC-506 | Cancellation shows toast and redirects | Covered by TC-003's full journey; retain the ID as a trace to that assertion rather than creating a duplicate test. |

TC-506 is assigned to E2E for traceability but should be asserted inside TC-003, not run as a separate duplicate journey. TC-005 remains a UI test so it can verify the link behavior without repeating the full booking journey.

---

## 3. Decision Rationale for Contested Assignments

### Booking reference cases — TC-102, TC-405, TC-408

The generated reference is produced by `randomRef` and `generateUniqueRef` inside `backend/src/services/bookingService.js`. Unit-level service tests can mock the database/repositories and control randomness/time to cover prefix, collision retry, and fallback deterministically. TC-102 also merits an API assertion against the persisted booking shape; E2E TC-102 currently exists but is redundant for the core rule.

### FIFO, availability, and failed creation — TC-100, TC-101, TC-310, TC-400, TC-401

These are API/integration cases because they depend on persisted booking order, repository queries, and event availability. Use a fixture that creates nine bookings and assert both the booking set and returned event availability. TC-100/TC-400 and TC-101/TC-401 are overlapping pairs; parameterize or share fixtures instead of duplicating expensive setup. Do not assert the documented outcome without checking actual state: current service ordering appears to cause the regressions recorded in Section 5.

### Refund spinner and eligibility — TC-103, TC-104, TC-105, TC-404, TC-508

Refund eligibility is client-only in `RefundEligibility` (`frontend/app/bookings/[id]/page.tsx`); no API or persistence is involved. Keep these at the UI/component layer and use a fake clock for the four-second transition. A multi-minute E2E run adds no meaningful coverage.

### Authentication, authorization, and error presentation — TC-200–208, TC-300, TC-301, TC-509

Test status codes and ownership at the API layer. Keep TC-200 as E2E because it verifies real authentication across two browser sessions. TC-509 separately checks the frontend's 403-specific rendering with a mocked response; it does not replace the API test. Test the not-found UI (TC-300) with a mocked 404 while TC-301 verifies the actual endpoint.

### Validation and pagination — TC-107, TC-304–306, TC-309, TC-407, TC-510

The booking validator is registered before the controller on `POST /api/bookings`; direct API tests verify field-specific 400 responses without form/browser flakiness. Pagination response contents belong at API level, while pagination control rendering and URL changes belong in a mocked UI test. For scenarios requiring more than the nine-booking creation limit, seed test data directly and clean it up.

### UI controls and empty/loading/error states — TC-005, TC-308, TC-402–403, TC-500–505, TC-507–510

These assert a single page/component state and should not require database-backed E2E journeys. The repository has no React Testing Library/Vitest setup, so initially use Playwright route interception as a UI test; add isolated component tooling only if the team wants faster, DOM-level tests.

---

## 4. Existing-Test Anti-Patterns and Gaps

The only discovered automated test file is `tests/booking-management.spec.js`; it currently covers TC-001, TC-002, TC-003/506, TC-004, TC-006, and TC-102. No Unit, API, or isolated Component/UI test runner or suite is configured. The current distribution is therefore E2E-heavy relative to the recommended pyramid.

| Finding | Current evidence | Recommended approach |
|---|---|---|
| E2E tests target a shared hosted environment | The spec uses `https://eventhub.rahulshettyacademy.com`; `playwright.config.ts` also sets that base URL. | Run destructive automated tests against a dedicated local/test deployment and isolated database/account. |
| Tests clear all user bookings | `clearBookings` and TC-004 call the clear-all control for a shared hosted account. | Use per-run accounts or tagged test fixtures; clean up only records created by the test. |
| Fixed account and customer values can collide across runs | The spec reuses the same account, name, email, and phone. | Generate unique test data and isolate parallel/repeated runs. |
| API, component, and unit coverage is absent | `package.json` exposes Playwright only; backend package has no test script. | Add focused API and unit harnesses before expanding E2E coverage; use route-mocked UI tests in the existing Playwright setup in the interim. |
| Overlapping scenarios can duplicate expensive setup | TC-100/TC-400 and TC-101/TC-401 test the same FIFO branches; TC-003/TC-506 overlap. | Parameterize shared API fixtures and keep TC-506 as an assertion within TC-003. |
| Long spinner checks can waste wall-clock time | Refund UI uses a fixed `setTimeout(..., 4000)`. | Use a fake clock in a UI/component test rather than a real four-second E2E wait. |
| Several scenario suggestions put deterministic checks at E2E | Validation, refund rules, loading states, and FIFO behavior do not need a full-stack browser journey. | Follow the layer assignments above; retain E2E only for critical user flows and cross-session behavior. |

---

## 5. Implementation Mismatches to Resolve Before Treating These Tests as Green

These are testable behavioral discrepancies, not changes made by this strategy:

1. **TC-202 cancellation status:** The documented rule expects 403 for another user's cancellation. `bookingService.cancelBooking` calls `bookingRepository.findById(id, userId)`, which filters by owner; a foreign booking therefore appears missing and returns 404 before the explicit ownership check. Decide whether to change the contract or implementation, then align the scenario and assertion.
2. **TC-101 / TC-401 seat accounting:** `bookingService.createBooking` deletes the oldest same-event booking and then decrements the event's stored seats by the new quantity, while event reads also subtract the user's current booked quantity. The resulting availability appears to count the replacement reduction twice. The equal-quantity case should preserve availability; verify and fix the service before expecting these API tests to pass.
3. **TC-310 pruning order:** `createBooking` prunes at the nine-booking limit before checking event existence and seat availability. A failed 10th attempt can therefore delete an existing booking. Move pruning to a point where creation can succeed (ideally make the replacement atomic) or revise the business rule, then assert all original records remain on failure.
4. **Scenario/model pagination tension:** TC-107 and TC-407 need fixtures that exceed the ordinary nine-booking limit. Seed records directly and state clearly that the fixture intentionally bypasses the normal creation flow.

---

## 6. Defense-in-Depth Map

| Critical rule | Unit | API / Integration | Component / UI | E2E |
|---|---|---|---|---|
| Booking reference format and title prefix | TC-102, TC-408 | TC-102 (additional assertion) | — | Existing TC-102 may remain as a smoke check |
| Booking reference collision handling | TC-405 | — | — | — |
| Price calculation and persisted booking | — | TC-106 | — | — |
| FIFO limit and seat availability | — | TC-100, TC-101, TC-310, TC-400, TC-401 | — | — |
| User isolation / authorization | — | TC-201–208 | TC-509 | TC-200 |
| Cancellation | — | TC-202, TC-307 | TC-503–504, TC-008 UI confirmation | TC-003, TC-008 |
| Refund rule and timed UI | — | — | TC-103–105, TC-404, TC-508 | — |
| Booking-list/detail rendering | — | TC-007, TC-107, TC-110 | TC-001 state checks via route mock, TC-300, TC-500–502, TC-505, TC-510 | TC-001, TC-002 |

TC-001 and TC-002 may be implemented as E2E-only if route-mocked UI coverage would duplicate assertions.

---

## 7. Implementation Priority

**Tier 1 — P0 release blockers**
- E2E critical journeys: TC-001, TC-002, TC-003/506, TC-004, TC-006.
- API security and booking integrity: TC-201, TC-202, TC-207, TC-208, TC-302, TC-310.
- FIFO/availability: TC-100, TC-101, TC-400, TC-401.
- Cross-account UI: TC-200.

**Tier 2 — P1 CI coverage**
- API validation and contract: TC-007, TC-106, TC-201–206, TC-301–306, TC-309, TC-110.
- UI booking controls and refund rules: TC-008, TC-103–105, TC-402–404, TC-503–504, TC-508–509.
- Booking cancellation seat behavior: TC-108.

**Tier 3 — P2 regression and state coverage**
- Pagination and boundary fixtures: TC-107, TC-407, TC-510.
- Remaining UI states/navigation: TC-005, TC-109, TC-300, TC-308, TC-500–502, TC-505, TC-507.
- Collision fallback: TC-405; numeric prefix: TC-408; clear-one edge: TC-406.

---

## 8. Suggested Test File Map

| Layer | Suggested test file | Primary source files |
|---|---|---|
| Unit | `backend/tests/unit/bookingService.test.js` | `backend/src/services/bookingService.js`; mocked `bookingRepository`, `eventRepository`, and Prisma client |
| API / Integration | `backend/tests/integration/bookings.test.js` | `backend/src/routes/bookingRoutes.js`, `backend/src/controllers/bookingController.js`, `backend/src/services/bookingService.js`, `backend/src/validators/bookingValidator.js`, `backend/src/middleware/authMiddleware.js` |
| Component / UI | `tests/booking-ui.spec.js` (route-mocked Playwright until an isolated component harness exists) | `frontend/app/bookings/page.tsx`, `frontend/app/bookings/[id]/page.tsx`, `frontend/app/events/[id]/page.tsx`, `frontend/components/bookings/BookingCard.jsx` |
| E2E | `tests/booking-management.spec.js` | Full stack; use dedicated test users and the local/test base URL rather than the shared hosted account |
