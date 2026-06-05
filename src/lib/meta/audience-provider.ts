// MetaConnectionProvider — abstraction over how a Meta access token is obtained.
//
// MVP: AgencySystemUserProvider uses a single META_SYSTEM_USER_TOKEN (Skale's
// Business Manager system user) that has ads_management on all client accounts.
//
// Future: OrgOAuthProvider will fetch a per-org token from the integrations
// table — a new implementation of the same interface, no sync-logic changes.

export interface MetaAudienceConnection {
  token: string
  adAccountId: string
}

export interface MetaConnectionProvider {
  getConnection(orgId: string, adAccountId: string): Promise<MetaAudienceConnection>
}

export class AgencySystemUserProvider implements MetaConnectionProvider {
  async getConnection(_orgId: string, adAccountId: string): Promise<MetaAudienceConnection> {
    const token = process.env.META_SYSTEM_USER_TOKEN
    if (!token) throw new Error('META_SYSTEM_USER_TOKEN is not configured')
    return { token, adAccountId }
  }
}
