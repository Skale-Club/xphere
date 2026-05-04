import { describe, it } from 'vitest'

describe('GREV-01: addLocation server action', () => {
  it.todo('inserts row with place_id, name, address, maps_url, category, client_name columns')
  it.todo('returns { error: "Not authenticated." } when user session is absent')
  it.todo('returns { error: "No active organization." } when org resolution fails')
  it.todo('returns { error } when org already has a location with the same place_id')
  it.todo('returns { locationId: string } on successful insert')
})

describe('GREV-01: deleteLocation server action', () => {
  it.todo('deletes the location row and all cascaded google_reviews rows')
  it.todo('returns { error } when location does not belong to the current org')
  it.todo('calls revalidatePath("/reviews") after successful delete')
})
