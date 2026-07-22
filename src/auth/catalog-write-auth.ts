'use strict';

const crypto = require('node:crypto');

function authorized(header: unknown, expected: string | undefined): boolean {
  if (!expected || typeof header !== 'string' || !header.startsWith('Bearer ')) return false;
  const supplied = header.slice('Bearer '.length);
  if (!supplied) return false;

  const suppliedDigest = crypto.createHash('sha256').update(supplied, 'utf8').digest();
  const expectedDigest = crypto.createHash('sha256').update(expected, 'utf8').digest();
  return crypto.timingSafeEqual(suppliedDigest, expectedDigest);
}

function bearerToken(ctx: any): string | null {
  const header = ctx?.request?.headers?.authorization;
  if (typeof header !== 'string') return null;
  const parts = header.trim().split(/\s+/);
  return parts.length === 2 && parts[0].toLowerCase() === 'bearer' ? parts[1] : null;
}

async function authenticateAdmin(ctx: any): Promise<any | null> {
  const token = bearerToken(ctx);
  if (!token || !global.strapi) return null;

  try {
    const decoded = global.strapi.service('admin::token').decodeJwtToken(token);
    if (!decoded?.isValid || !decoded.payload?.id) return null;

    const user = await global.strapi.db.query('admin::user').findOne({
      where: { id: decoded.payload.id },
      populate: ['roles'],
    });
    if (!user?.isActive) return null;

    const permissionService = global.strapi.service('admin::permission');
    const ability = permissionService
      ? await permissionService.engine.generateUserAbility(user)
      : null;

    ctx.state.user = user;
    ctx.state.userAbility = ability;
    return { kind: 'admin', user, ability };
  } catch {
    return null;
  }
}

async function authenticateCatalogWrite(ctx: any): Promise<any | null> {
  const authorization = ctx?.request?.headers?.authorization;
  if (authorized(authorization, process.env.STRAPI_API_TOKEN)) return { kind: 'internal' };
  return authenticateAdmin(ctx);
}

module.exports = { authorized, authenticateCatalogWrite, authenticateAdmin, bearerToken };

export {};
