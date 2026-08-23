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

export default async (policyContext: any) => {
  const authorization = policyContext.request.headers.authorization
  const bearer = typeof authorization === 'string'
    ? authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim()
    : undefined
  const supplied = bearer || policyContext.request.headers['x-catalogue-snapshot-secret']
  const expected = String(process.env.CATALOGUE_REFRESH_SECRET || '').trim()

  if (!matchesSecret(supplied, expected)) {
    throw new UnauthorizedError('Unauthorized')
  }

  return true
}

export { matchesSecret }
