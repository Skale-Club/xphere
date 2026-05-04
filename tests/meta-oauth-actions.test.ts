import { describe, it } from 'vitest'

describe('META-02: connectMeta', () => {
  it.todo('generates a CSRF state cookie before redirecting')
  it.todo('redirects to https://www.facebook.com/dialog/oauth')
  it.todo('requests pages_show_list, pages_messaging, instagram_manage_messages, and pages_read_engagement')
  it.todo('uses https://operator.skale.club/api/meta/callback as the redirect URI')
})

describe('META-04: disconnectMetaChannel', () => {
  it.todo('deletes exactly one channel row for the active org')
  it.todo('revalidates /integrations/meta')
})

describe('META-06: updateMetaChannelAutomation', () => {
  it.todo('allows different automation ids for messenger and instagram rows on the same page')
  it.todo('allows clearing the automation binding')
})
