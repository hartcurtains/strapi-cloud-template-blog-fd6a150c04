import { errors } from '@strapi/utils';
import { authorized } from './stripe-webhook-lifecycle-auth';

const { UnauthorizedError } = errors;

export default async (policyContext: any) => {
  if (!authorized(policyContext.request.headers.authorization, process.env.CHECKOUT_CANCELLATION_SECRET)) {
    throw new UnauthorizedError('Unauthorized');
  }
  return true;
};
