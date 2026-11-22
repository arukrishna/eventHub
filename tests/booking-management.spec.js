import { test, expect } from '@playwright/test';

const USER_EMAIL    = process.env.EVENTHUB_TEST_USER_EMAIL;
const USER_PASSWORD = process.env.EVENTHUB_TEST_USER_PASSWORD;
const CUSTOMER_PHONE = '9876543210';
let createdBookingRef;

// ── Helpers ────────────────────────────────────────────────────────────────────

async function login(page) {
  await page.goto('/login');
  await page.getByPlaceholder('you@email.com').fill(USER_EMAIL);
  await page.getByLabel('Password').fill(USER_PASSWORD);
  await page.locator('#login-btn').click();
  await expect(page.getByRole('link', { name: /Browse Events/i }).first()).toBeVisible();
}

async function getBookings(page) {
  const responsePromise = page.waitForResponse((response) =>
    new URL(response.url()).pathname.endsWith('/api/bookings') &&
    response.request().method() === 'GET'
  );
  await page.goto('/bookings');
  await expect(page.getByRole('heading', { name: 'My Bookings' })).toBeVisible();
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  return (await response.json()).data;
}

/**
 * Books the first available (non-sold-out) event on the events page.
 * Returns the created booking details and records its reference for cleanup.
 * Precondition: user must be logged in before calling.
 */
async function bookEvent(page) {
  const existingBookings = await getBookings(page);
  if (existingBookings.length >= 9) {
    throw new Error('The dedicated E2E account must have fewer than 9 bookings before a test runs.');
  }

  await page.goto('/events');

  // Pick the first card that has a visible "Book Now" button (not sold out)
  const firstCard = page.getByTestId('event-card').filter({
    has: page.getByTestId('book-now-btn'),
  }).first();
  await expect(firstCard).toBeVisible();

  // Capture title before navigating away
  const eventTitle = (await firstCard.locator('h3').textContent())?.trim() ?? '';
  console.log(`Booking event: "${eventTitle}"`);

  await firstCard.getByTestId('book-now-btn').click();
  await expect(page).toHaveURL(/\/events\/\d+/);

  // Fill booking form
  const testId = Date.now();
  const customerName = `E2E User ${testId}`;
  const customerEmail = `e2e-${testId}@example.com`;
  await page.getByLabel('Full Name').fill(customerName);
  await page.locator('#customer-email').fill(customerEmail);
  await page.getByPlaceholder('+91 98765 43210').fill(CUSTOMER_PHONE);

  const bookingResponsePromise = page.waitForResponse((response) =>
    new URL(response.url()).pathname.endsWith('/api/bookings') &&
    response.request().method() === 'POST'
  );
  await page.getByRole('button', { name: 'Confirm Booking' }).click();
  const bookingResponse = await bookingResponsePromise;
  expect(bookingResponse.status()).toBe(201);
  const { data: booking } = await bookingResponse.json();
  createdBookingRef = booking.bookingRef;

  const refEl = page.locator('.booking-ref').first();
  await expect(refEl).toBeVisible();
  const bookingRef = (await refEl.textContent())?.trim() ?? '';
  expect(bookingRef).toBe(booking.bookingRef);
  return {
    booking,
    bookingRef,
    eventTitle,
    customerName,
    customerEmail,
    totalPrice: Number(booking.totalPrice),
  };
}

const formatPrice = (amount) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(amount);

async function cancelBookingCard(page, bookingRef) {
  const bookings = await getBookings(page);
  if (!bookings.some((booking) => booking.bookingRef === bookingRef)) return;

  const card = page.getByTestId('booking-card').filter({ hasText: bookingRef });
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Cancel Booking' }).click();
  await page.locator('#confirm-dialog-yes').click();
  await expect(card).toHaveCount(0);
}

// ── Test Suite ─────────────────────────────────────────────────────────────────

test.describe('Booking Management — Critical Happy Paths', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(
      !USER_EMAIL || !USER_PASSWORD,
      'Set EVENTHUB_TEST_USER_EMAIL and EVENTHUB_TEST_USER_PASSWORD for a dedicated test account.'
    );
    await login(page);
  });

  test.afterEach(async ({ page }) => {
    const bookingRef = createdBookingRef;
    createdBookingRef = undefined;
    if (bookingRef) await cancelBookingCard(page, bookingRef);
  });

  // TC-001 ───────────────────────────────────────────────────────────────────
  test('TC-001: displays booking card on bookings list page', async ({ page }) => {
    const { bookingRef, eventTitle, totalPrice } = await bookEvent(page);

    await page.goto('/bookings');

    const card = page.getByTestId('booking-card').filter({ hasText: bookingRef });
    await expect(card).toBeVisible();
    await expect(card).toContainText(eventTitle);
    await expect(card).toContainText('confirmed');
    await expect(card).toContainText(bookingRef);
    await expect(card).toContainText('1 ticket');
    await expect(card).toContainText(formatPrice(totalPrice));
    await expect(card.getByRole('link', { name: 'View Details' })).toBeVisible();
  });

  // TC-002 ───────────────────────────────────────────────────────────────────
  test('TC-002: shows all sections on booking detail page', async ({ page }) => {
    const { booking, bookingRef, eventTitle, customerName, customerEmail, totalPrice } = await bookEvent(page);

    await page.goto('/bookings');
    const card = page.getByTestId('booking-card').filter({ hasText: bookingRef });
    await card.getByRole('link', { name: 'View Details' }).click();
    await expect(page).toHaveURL(/\/bookings\/\d+/);

    await expect(page.getByRole('navigation').filter({ hasText: bookingRef })).toContainText(bookingRef);
    await expect(page.getByRole('heading', { name: eventTitle })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Event Details' })).toBeVisible();
    await expect(page.getByText(booking.event.category, { exact: true })).toBeVisible();
    const formattedEventDate = await page.evaluate(
      (eventDate) =>
        new Date(eventDate).toLocaleDateString('en-IN', {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        }),
      booking.event.eventDate,
    );
    await expect(page.getByText(formattedEventDate, { exact: true })).toBeVisible();
    await expect(page.getByText(booking.event.venue, { exact: true })).toBeVisible();
    await expect(page.getByText(booking.event.city, { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Customer Details' })).toBeVisible();
    await expect(page.getByText(customerName, { exact: true })).toBeVisible();
    await expect(page.getByText(customerEmail, { exact: true })).toBeVisible();
    await expect(page.getByText(CUSTOMER_PHONE, { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Payment Summary' })).toBeVisible();
    await expect(page.getByText('Tickets', { exact: true }).locator('..')).toContainText(String(booking.quantity));
    await expect(page.getByText('Price per ticket', { exact: true }).locator('..'))
      .toContainText(formatPrice(Number(booking.event.price)));
    await expect(page.getByRole('main')).toContainText(formatPrice(totalPrice));
    await expect(page.getByText(`#${booking.id}`, { exact: true })).toBeVisible();
    await expect(page.locator('#check-refund-btn')).toBeVisible();
  });

  // TC-003 + TC-506 ──────────────────────────────────────────────────────────
  test('TC-003: cancels booking from detail page — shows toast and redirects', async ({ page }) => {
    const { bookingRef } = await bookEvent(page);

    await page.goto('/bookings');
    const card = page.getByTestId('booking-card').filter({ hasText: bookingRef });
    await card.getByRole('link', { name: 'View Details' }).click();
    await expect(page).toHaveURL(/\/bookings\/\d+/);

    await page.getByRole('button', { name: 'Cancel Booking' }).click();
    await expect(page.getByText('Cancel this booking?')).toBeVisible();
    await expect(page.locator('#confirm-dialog-yes')).toBeVisible();
    await page.locator('#confirm-dialog-yes').click();

    await expect(page).toHaveURL(/\/bookings$/);
    await expect(page.getByText('Booking cancelled successfully')).toBeVisible();
    await expect(page.getByTestId('booking-card').filter({ hasText: bookingRef })).toHaveCount(0);
    createdBookingRef = undefined;
  });

  // TC-006 ───────────────────────────────────────────────────────────────────
  test('TC-006: navigates to bookings list after booking via View My Bookings link', async ({ page }) => {
    const { bookingRef } = await bookEvent(page);
    await page.getByRole('link', { name: 'View My Bookings' }).click();
    await expect(page).toHaveURL('/bookings');
    await expect(page.getByTestId('booking-card').filter({ hasText: bookingRef })).toBeVisible();
  });

  // TC-102 ───────────────────────────────────────────────────────────────────
  test('TC-102: booking reference starts with first letter of event title (uppercase)', async ({ page }) => {
    const { bookingRef, eventTitle } = await bookEvent(page);
    const expectedPrefix = eventTitle[0].toUpperCase();
    expect(bookingRef).toMatch(new RegExp(`^${expectedPrefix}-[A-Z0-9]{6}$`));
  });

  // TC-004 ───────────────────────────────────────────────────────────────────
  test('TC-004: clears all bookings and shows empty state', async ({ page }) => {
    const existingBookings = await getBookings(page);
    if (existingBookings.length > 0) {
      test.skip(true, 'The clear-all test requires a dedicated account with no pre-existing bookings.');
    }

    await bookEvent(page);

    await page.goto('/bookings');
    await expect(page.getByTestId('booking-card').first()).toBeVisible();

    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: /clear all bookings/i }).click();

    await expect(page.getByText('No bookings yet')).toBeVisible();
    await expect(page.getByRole('main').getByRole('link', { name: 'Browse Events' })).toBeVisible();
  });

});
