import { errors } from '@strapi/utils';
import { authorized } from './stripe-webhook-lifecycle-auth';

const { UnauthorizedError } = errors;

export default async (policyContext: any) => {
  if (!authorized(
    policyContext.request.headers.authorization,
    process.env.ABANDONED_PAYMENTS_TRANSITION_SECRET
  )) {
    throw new UnauthorizedError('Unauthorized');
  }

  return true;
};
