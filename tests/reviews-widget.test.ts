// @vitest-environment jsdom

import { describe, it } from 'vitest'

describe('GWDGT-02: layout rendering', () => {
  it.todo('renders carousel layout when data-layout="carousel"')
  it.todo('renders grid layout when data-layout="grid"')
  it.todo('renders list layout when data-layout="list"')
  it.todo('renders compact layout when data-layout="compact"')
  it.todo('falls back to list when layout is unknown')
})

describe('GWDGT-05: attribution and review card content', () => {
  it.todo('shows Powered by Google in every layout')
  it.todo('shows author name adjacent to review text')
  it.todo('shows initials fallback when author_photo_url is null')
})

describe('GWDGT-06: graceful failure', () => {
  it.todo('does not throw when data-token is missing')
  it.todo('removes or hides host root when fetch returns non-200')
  it.todo('does not throw when payload is empty or malformed')
  it.todo('does not leak visible error text into the host page')
})

describe('GWDGT-04: public fetch behavior', () => {
  it.todo('calls /api/reviews/{token} relative to the script origin')
  it.todo('uses Shadow DOM and does not write review markup into document.body directly')
})
