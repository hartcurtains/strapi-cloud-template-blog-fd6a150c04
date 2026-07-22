import { errors } from '@strapi/utils';

const { ValidationError } = errors;
const IDENTITY_UID = 'api::fabric-colour-identity.fabric-colour-identity';
const FABRIC_UID = 'api::fabric.fabric';

function token(value: unknown): string {
  return String(value || '').normalize('NFKC').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function relationReference(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (!value || typeof value !== 'object') return '';
  const item = value as Record<string, unknown>;
  if (Array.isArray(item.connect)) return relationReference(item.connect[0]);
  return String(item.documentId || item.id || '');
}

export function buildFabricColourIdentityKey(data: Record<string, unknown>): string {
  const supplier = token(data.supplier);
  const fabricDocumentId = String(data.fabricDocumentId || '').normalize('NFKC').trim();
  const supplierProductCode = token(data.supplierProductCode);
  const supplierColourCode = token(data.supplierColourCode);
  if (!supplier || !fabricDocumentId || !supplierProductCode || !supplierColourCode) {
    throw new ValidationError(
      'A staged colour identity requires supplier, fabric, supplier product code, and supplier colour code. The colour code is never globally unique.',
    );
  }
  return [supplier, fabricDocumentId, supplierProductCode, supplierColourCode].join('|');
}

async function resolveFabric(strapi: any, value: unknown): Promise<any> {
  const reference = relationReference(value);
  if (!reference) throw new ValidationError('A staged colour identity requires a Fabric relation.');

  let fabric = null;
  if (strapi.documents) {
    fabric = await strapi.documents(FABRIC_UID).findOne({ documentId: reference, status: 'draft' }).catch(() => null);
  }
  if (!fabric) fabric = await strapi.entityService.findOne(FABRIC_UID, reference, { populate: [] }).catch(() => null);
  if (!fabric?.documentId) throw new ValidationError('The staged Fabric relation could not be resolved safely.');
  return fabric;
}

async function existingFabric(strapi: any, where: Record<string, unknown>): Promise<any> {
  const identity = await strapi.entityService.findOne(IDENTITY_UID, where.documentId || where.id, { populate: ['fabric'] }).catch(() => null);
  return identity?.fabric || null;
}

async function normalise(strapi: any, data: Record<string, unknown>, currentFabric?: unknown): Promise<void> {
  const fabric = await resolveFabric(strapi, data.fabric || currentFabric);
  data.supplier = String(data.supplier || 'Ashley Wilde').normalize('NFKC').trim();
  data.fabric = fabric.documentId;
  // This scalar is always derived from the resolved relation; client input is
  // intentionally ignored, including on relation updates.
  data.fabricDocumentId = fabric.documentId;
  data.supplierProductCode = token(data.supplierProductCode);
  data.supplierColourCode = token(data.supplierColourCode);
  data.fabricColourCode = token(`${data.supplierProductCode}${data.supplierColourCode}`);
  data.internalColourCode = data.internalColourCode ? token(data.internalColourCode) : null;
  data.displayName = String(data.displayName || `Colour ${data.supplierColourCode}`).normalize('NFKC').trim();
  data.identityKey = buildFabricColourIdentityKey(data);
}

export default {
  async beforeCreate(event: any) {
    await normalise(event.strapi || (global as any).strapi, event.params.data);
  },
  async beforeUpdate(event: any) {
    const strapi = event.strapi || (global as any).strapi;
    const data = event.params.data || {};
    const current = await existingFabric(strapi, event.params.where || {});
    await normalise(strapi, data, current);
  },
};
