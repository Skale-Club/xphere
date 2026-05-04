/** @vitest-environment jsdom */

import { describe, it } from 'vitest'

describe('META-03: connected channels list', () => {
  it.todo('shows connected page name and linked Instagram username')
  it.todo('shows active status, last sync, and capability badges per channel')
})

describe('META-05: reconnect prompt', () => {
  it.todo('shows reconnect UI when connection_error contains Meta error 190')
  it.todo('does not show the channel as healthy when is_active is false')
})

describe('META-04 and META-06: channel controls', () => {
  it.todo('renders a disconnect action per channel row')
  it.todo('renders independent automation selectors for messenger and instagram')
  it.todo('allows saving different automation ids for the two rows on the same page')
})

describe('META-01: connect entry point', () => {
  it.todo('renders a Connect with Facebook primary CTA when no channels exist')
})
