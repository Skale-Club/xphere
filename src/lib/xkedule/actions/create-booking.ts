// src/lib/xkedule/actions/create-booking.ts
import { xkeduleFetchJson, type XkeduleCredentials } from '../client'

interface CreateBookingParams {
  customerName?: string
  customerEmail?: string
  customerPhone?: string
  customerAddress?: string
  bookingDate?: string       // YYYY-MM-DD
  startTime?: string         // HH:MM
  serviceId?: number | string
  staffMemberId?: number | string
  paymentMethod?: string
  [key: string]: unknown
}

interface BookingResponse {
  id: number
  status: string
  bookingDate?: string
  startTime?: string
  [key: string]: unknown
}

export async function createXkeduleBooking(
  params: Record<string, unknown>,
  credentials: XkeduleCredentials
): Promise<string> {
  const {
    customerName,
    customerEmail,
    customerPhone,
    customerAddress,
    bookingDate,
    startTime,
    serviceId,
    staffMemberId,
    paymentMethod = 'site',
  } = params as CreateBookingParams

  if (!customerName || !customerPhone || !customerAddress || !bookingDate || !startTime || !serviceId) {
    return 'Missing required booking fields: customerName, customerPhone, customerAddress, bookingDate, startTime, serviceId.'
  }

  const body: Record<string, unknown> = {
    customerName,
    customerPhone,
    customerAddress,
    bookingDate,
    startTime,
    paymentMethod,
    items: [{ serviceId: Number(serviceId), quantity: 1 }],
  }

  if (customerEmail) body.customerEmail = customerEmail
  if (staffMemberId) body.staffMemberId = Number(staffMemberId)

  const booking = await xkeduleFetchJson<BookingResponse>(
    '/api/bookings',
    'POST',
    body,
    credentials
  )

  return `Booking confirmed. ID: ${booking.id} | Date: ${booking.bookingDate ?? bookingDate} at ${booking.startTime ?? startTime} | Status: ${booking.status}`
}
