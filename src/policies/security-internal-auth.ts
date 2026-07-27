import { createHash, timingSafeEqual } from 'node:crypto';
import { errors } from '@strapi/utils';

const { UnauthorizedError } = errors;

function authorized(header: unknown, expected: string | undefined): boolean {
  if (!expected || typeof header !== 'string' || !header.startsWith('Bearer ')) return false;
  const supplied = header.slice('Bearer '.length);
  if (!supplied) return false;

  const suppliedDigest = createHash('sha256').update(supplied, 'utf8').digest();
  const expectedDigest = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(suppliedDigest, expectedDigest);
}

export default async (policyContext: any) => {
  if (!authorized(
    policyContext.request.headers.authorization,
    process.env.STRAPI_INTERNAL_SECURITY_SECRET,
  )) {
    throw new UnauthorizedError('Unauthorized');
  }

  return true;
};

export { authorized };
