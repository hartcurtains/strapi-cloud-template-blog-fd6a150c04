import { createSecurityStateStore, RATE_LIMITS } from '../services/security-state';

const HASH = /^[0-9a-f]{64}$/i;
const ACCOUNT = /^[A-Za-z0-9._:-]{1,128}$/;

function validHash(value: unknown): value is string {
  return typeof value === 'string' && HASH.test(value);
}

function validAccount(value: unknown): value is string {
  return typeof value === 'string' && ACCOUNT.test(value);
}

function validRateLimitCategory(value: unknown): value is string {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(RATE_LIMITS, value);
}

export default {
  async rateLimitCheck(ctx: any) {
    const body = ctx.request.body as any;
    if (!validHash(body?.hashedKey) || !validRateLimitCategory(body?.actionCategory)) {
      return ctx.badRequest('Invalid security request');
    }

    try {
      return ctx.send(await createSecurityStateStore(strapi.db.connection).checkRateLimit({
        hashedKey: body.hashedKey,
        actionCategory: body.actionCategory,
      }));
    } catch (error) {
      strapi.log.error('Security rate-limit persistence failed');
      return ctx.internalServerError('Security operation failed');
    }
  },

  async accountDeletionChallengeCreate(ctx: any) {
    const body = ctx.request.body as any;
    if (!validAccount(body?.accountIdentifier) || !validHash(body?.codeHash)) {
      return ctx.badRequest('Invalid security request');
    }

    try {
      return ctx.send(await createSecurityStateStore(strapi.db.connection).createAccountDeletionChallenge({
        accountIdentifier: body.accountIdentifier,
        codeHash: body.codeHash,
      }));
    } catch (error) {
      strapi.log.error('Account-deletion challenge persistence failed');
      return ctx.internalServerError('Security operation failed');
    }
  },

  async accountDeletionChallengeVerify(ctx: any) {
    const body = ctx.request.body as any;
    if (!validAccount(body?.accountIdentifier) || !validHash(body?.codeHash)) {
      return ctx.badRequest('Invalid security request');
    }

    try {
      return ctx.send(await createSecurityStateStore(strapi.db.connection).verifyAccountDeletionChallenge({
        accountIdentifier: body.accountIdentifier,
        codeHash: body.codeHash,
      }));
    } catch (error) {
      strapi.log.error('Account-deletion challenge verification failed');
      return ctx.internalServerError('Security operation failed');
    }
  },
};
