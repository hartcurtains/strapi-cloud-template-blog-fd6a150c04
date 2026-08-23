import { createHash, timingSafeEqual } from 'node:crypto'
import { errors } from '@strapi/utils'

const { UnauthorizedError } = errors

function matchesSecret(supplied: unknown, expected: unknown): boolean {
  if (typeof supplied !== 'string' || typeof expected !== 'string') return false
  if (supplied.length < 32 || expected.length < 32) return false

  const suppliedDigest = createHash('sha256').update(supplied, 'utf8').digest()
  const expectedDigest = createHash('sha256').update(expected, 'utf8').digest()
  return timingSafeEqual(suppliedDigest, expectedDigest)
}

function bearerToken(authorization: unknown): string | null {
  if (typeof authorization !== 'string') return null
  const parts = authorization.trim().split(/\s+/)
  return parts.length === 2 && parts[0].toLowerCase() === 'bearer' ? parts[1] : null
}

async function validApiToken(token: string | null): Promise<boolean> {
  if (!token || !global.strapi) return false

  try {
    const apiTokenService = global.strapi.service('admin::api-token')
    const apiToken = await apiTokenService.getBy({ accessKey: apiTokenService.hash(token) })
    return Boolean(apiToken && (!apiToken.expiresAt || new Date(apiToken.expiresAt) >= new Date()))
  } catch {
    return false
  }
}

export default async (policyContext: any) => {
  const authorization = policyContext.request.headers.authorization
  const bearer = bearerToken(authorization)
  const headerSecret = policyContext.request.headers['x-catalogue-snapshot-secret']
  const expected = String(process.env.CATALOGUE_REFRESH_SECRET || '').trim()

  // Prefer the existing lifecycle-refresh secret. The API-token fallback keeps
  // deployments that already have a server-only Strapi token working while
  // still rejecting anonymous and browser-originated requests.
  if (!matchesSecret(headerSecret, expected) && !matchesSecret(bearer, expected) && !(await validApiToken(bearer))) {
    throw new UnauthorizedError('Unauthorized')
  }

  return true
}

export { matchesSecret }
