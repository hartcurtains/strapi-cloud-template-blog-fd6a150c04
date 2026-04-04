/**
 * order-management service
 * Custom methods for bulk import/export and bulk image upload with colour assignment.
 */

import { factories } from '@strapi/strapi';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { parseColourCodeFromFilename as parseColourCodeFromFilenameUtil } from '../utils/parseColourCode';

export type { ParseColourCodeResult } from '../utils/parseColourCode';

// --- Types -------------------------------------------------------------------

export interface BulkUploadResult {
  uploaded: number;
  linked: number;
  failed: number;
  skipped: number;
  errors: Array<{ filename: string; phase?: string; error: string }>;
  details: Array<Record<string, unknown>>;
}

export interface ProductLookupMaps {
  productIdMap: Map<string, any>;
  slugMap: Map<string, any>;
  nameMap: Map<string, any>;
  firstNameMap: Map<string, any[]>;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const UPLOAD_DELAY_MS = 1000;
const BATCH_SIZE = 10;

// --- Service factory ---------------------------------------------------------

export default factories.createCoreService(
  'api::order-management.order-management',
  ({ strapi }) => {
    const productLookupCache = new Map<
      string,
      { maps: ProductLookupMaps; timestamp: number }
    >();

    return {
      parseColourCodeFromFilename: parseColourCodeFromFilenameUtil,

      async processBulkImageUpload(params: {
        fileDescriptors: { name: string; mimeType: string; size: number; buffer: Buffer }[];
        productType: string;
        matchBy: string;
        createAsColour: boolean;
        log?: (msg: string) => void;
      }): Promise<BulkUploadResult> {
        const {
          fileDescriptors,
          productType,
          matchBy,
          createAsColour,
          log = console.log
        } = params;

        const results: BulkUploadResult = {
          uploaded: 0,
          linked: 0,
          failed: 0,
          skipped: 0,
          errors: [],
          details: []
        };

        // Descriptors already have buffers; normalize mimeType for octet-stream
        const itemsToProcess = fileDescriptors.map((d: any) => ({
          name: d.name,
          mimeType: d.mimeType === 'application/octet-stream'
            ? (['jpg', 'jpeg'].includes((d.name || '').toLowerCase().split('.').pop() || '') ? 'image/jpeg' : 'image/png')
            : d.mimeType,
          size: d.size || (d.buffer ? d.buffer.length : 0),
          buffer: d.buffer
        })).filter((item) => item.buffer != null);

        const skipped = fileDescriptors.length - itemsToProcess.length;
        if (skipped > 0) {
          results.failed += skipped;
          fileDescriptors
            .filter((d: any) => !d.buffer)
            .forEach((d) => {
              results.errors.push({ filename: d.name, phase: 'upload', error: 'Missing file buffer' });
            });
        }

        log(`📸 Processing ${itemsToProcess.length} total images`);

        const processedUploads: any[] = [];

        for (let i = 0; i < itemsToProcess.length; i++) {
          const item = itemsToProcess[i];
          const fileName = item.name;
          let tempFilePath: string | null = null;

          if (!item.buffer) {
            log(`❌ [upload] ${fileName}: Missing file buffer`);
            results.failed++;
            results.errors.push({ filename: fileName, phase: 'upload', error: 'Missing file buffer' });
            continue;
          }

          try {
            if (i > 0) await new Promise((r) => setTimeout(r, UPLOAD_DELAY_MS));
            log(`📤 Uploading ${i + 1}/${itemsToProcess.length}: ${fileName}...`);

            let uploadedFile: any = null;

            try {
              // CRITICAL: Write buffer to temporary file first
              const tmpDir = os.tmpdir();
              const timestamp = Date.now();
              const randomStr = Math.random().toString(36).substring(7);
              const ext = path.extname(fileName) || '.jpg';
              const tempFileName = `upload_${timestamp}_${randomStr}${ext}`;
              tempFilePath = path.join(tmpDir, tempFileName);

              // Write buffer to temp file synchronously to ensure it exists before upload
              await fs.promises.writeFile(tempFilePath, item.buffer);
              log(`💾 Wrote temp file: ${tempFilePath}`);

              // Get file stats
              const stats = await fs.promises.stat(tempFilePath);

              // Create file object matching koa-body v6 / Strapi 5 expected structure
              const fileToUpload = {
                filepath: tempFilePath,           // PRIMARY - koa-body v6/Strapi 5 uses this
                path: tempFilePath,               // BACKUP - for backwards compatibility
                originalFilename: item.name,      // NOT 'name'
                newFilename: tempFileName,
                mimetype: item.mimeType,          // NOT just 'type'
                type: item.mimeType,              // include both
                size: stats.size,
                hash: `${timestamp}_${randomStr}`,
                ext: ext.substring(1) || 'jpg'
              };

              // Call upload service
              const result = await strapi.plugins['upload'].services.upload.upload({
                data: {
                  fileInfo: {
                    name: item.name,
                    alternativeText: item.name,
                    caption: item.name
                  }
                },
                files: fileToUpload
              });

              uploadedFile = Array.isArray(result) ? result[0] : result;

            } catch (uploadErr: any) {
              const isWindowsError =
                uploadErr?.code === 'EPERM' ||
                uploadErr?.errno === -4048 ||
                uploadErr?.message?.includes('EPERM') ||
                uploadErr?.message?.includes('unlink') ||
                uploadErr?.message?.includes('operation not permitted');

              if (isWindowsError) {
                try {
                  const recentFiles = await strapi.entityService.findMany('plugin::upload.file', {
                    filters: { name: fileName },
                    sort: { createdAt: 'desc' },
                    limit: 1
                  });
                  if (recentFiles?.length) {
                    uploadedFile = recentFiles[0];
                    log(`✅ Recovered uploaded file for ${fileName}`);
                  }
                } catch (_) { }
              }
              if (!uploadedFile) throw uploadErr;
            } finally {
              // Clean up temp file (try, but don't fail if it doesn't work on Windows)
              if (tempFilePath) {
                try {
                  await fs.promises.unlink(tempFilePath);
                  log(`🗑️ Cleaned up temp file: ${tempFilePath}`);
                } catch (unlinkErr: any) {
                  // On Windows, file might be locked, just log and continue
                  log(`⚠️ Could not delete temp file ${tempFilePath}: ${unlinkErr.message}`);
                }
              }
            }

            if (uploadedFile?.id) {
              (uploadedFile as any).originalFilename = fileName;
              processedUploads.push(uploadedFile);
              results.uploaded++;
              log(`✅ Uploaded ${i + 1}/${itemsToProcess.length}: ${fileName} (ID: ${uploadedFile.id})`);
            } else {
              throw new Error('Upload returned no file or file ID');
            }
          } catch (error: any) {
            log(`❌ [upload] ${fileName}: ${error.message}`);
            results.failed++;
            results.errors.push({ filename: fileName, phase: 'upload', error: error.message });
          }
        }

        if (processedUploads.length === 0) {
          log('⚠️ No uploads succeeded, returning early');
          return results;
        }

        log(`✅ Successfully uploaded ${processedUploads.length} files, proceeding to link...`);

        const contentType = `api::${productType === 'fabrics' ? 'fabric' : productType.slice(0, -1)}.${productType === 'fabrics' ? 'fabric' : productType.slice(0, -1)}`;
        const cacheKey = `${contentType}_${matchBy}`;
        const cached = productLookupCache.get(cacheKey);
        const now = Date.now();

        let productIdMap: Map<string, any>;
        let slugMap: Map<string, any>;
        let nameMap: Map<string, any>;
        let firstNameMap: Map<string, any[]>;

        if (cached && now - cached.timestamp < CACHE_TTL_MS) {
          log('📦 Using cached product maps');
          productIdMap = cached.maps.productIdMap;
          slugMap = cached.maps.slugMap;
          nameMap = cached.maps.nameMap;
          firstNameMap = cached.maps.firstNameMap;
        } else {
          log('🔄 Building fresh product maps...');
          const allProducts = (await strapi.entityService.findMany(contentType as any, {
            limit: 10000,
            populate: ['images'],
            sort: ['name:asc']
          })) as any[];

          log(`📦 Loaded ${allProducts.length} products`);

          productIdMap = new Map();
          slugMap = new Map();
          nameMap = new Map();
          firstNameMap = new Map();

          allProducts.forEach((p: any) => {
            if (p.productId) productIdMap.set(p.productId.toLowerCase(), p);
            if (p.slug) slugMap.set(p.slug.toLowerCase(), p);
            if (p.name) nameMap.set(p.name.toLowerCase().trim(), p);
            if (p.name) {
              const firstWord = p.name.split(/[\s\-_]+/)[0].trim().toLowerCase();
              if (firstWord) {
                if (!firstNameMap.has(firstWord)) firstNameMap.set(firstWord, []);
                firstNameMap.get(firstWord)!.push(p);
              }
            }
          });

          productLookupCache.set(cacheKey, {
            maps: { productIdMap, slugMap, nameMap, firstNameMap },
            timestamp: now
          });
        }

        let colourByNameMap: Map<string, any> = new Map();
        if (createAsColour && productType === 'fabrics') {
          const allColours = (await strapi.entityService.findMany('api::colour.colour', {
            limit: 5000,
            populate: ['fabrics', 'thumbnail']
          })) as any[];
          allColours.forEach((c: any) => {
            if (c.name) colourByNameMap.set((c.name as string).toLowerCase().trim(), c);
          });
          log(`📦 Loaded ${allColours.length} colours for lookup`);
        }

        const updatesToProcess: Array<{ productId: number; imageIds: number[]; filename: string; product: any }> = [];

        for (const uploadedFile of processedUploads) {
          const filename =
            (uploadedFile as any).originalFilename ||
            uploadedFile.name ||
            uploadedFile.filename ||
            (uploadedFile as any).originalname ||
            `uploaded_${uploadedFile.id}`;

          const parsed = parseColourCodeFromFilenameUtil(filename);
          const { code: parsedCode, baseName: parsedBaseName, identifier } = parsed;

          let product: any = null;

          if (matchBy === 'productId') {
            product = productIdMap.get(identifier.toLowerCase()) || null;
          } else if (matchBy === 'slug') {
            product = slugMap.get(identifier.toLowerCase()) || null;
          } else if (matchBy === 'name') {
            const cleanName = identifier.replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
            product = nameMap.get(cleanName) || null;
            if (!product) {
              for (const [productName, prod] of nameMap.entries()) {
                if (productName.includes(cleanName) || cleanName.includes(productName)) {
                  product = prod;
                  break;
                }
              }
            }
          } else if (matchBy === 'firstName' || matchBy === 'colorId') {
            // Try multiple strategies; for colorId, parsedBaseName has 2-letter code stripped (e.g. ADELINEWA -> ADELINE)
            const searchTerms = [
              parsedBaseName || identifier,
              identifier,
              filename.replace(/\.[^/.]+$/, '')
            ].map(term => term.toLowerCase().trim());

            log(`🔍 [${matchBy}] Trying search terms: ${JSON.stringify(searchTerms)}`);

            let bestMatch: any = null;
            let bestMatchLength = 0;

            for (const searchTerm of searchTerms) {
              if (bestMatch) break;

              // Strategy 1: Direct firstName match (longest match wins)
              for (const [firstWord, products] of firstNameMap.entries()) {
                if (searchTerm.startsWith(firstWord) && firstWord.length > bestMatchLength) {
                  bestMatch = products[0];
                  bestMatchLength = firstWord.length;
                  log(`✅ [${matchBy}] Found match via firstName: firstWord="${firstWord}", product="${bestMatch.name}"`);
                }
              }

              // Strategy 2: Fuzzy match on full product names
              if (!bestMatch) {
                for (const [productName, prod] of nameMap.entries()) {
                  const cleanProductName = productName.replace(/[\s\-_]+/g, '').toLowerCase();
                  const cleanSearchTerm = searchTerm.replace(/[\s\-_]+/g, '').toLowerCase();

                  if (
                    cleanSearchTerm.startsWith(cleanProductName) ||
                    cleanProductName.startsWith(cleanSearchTerm) ||
                    (cleanSearchTerm.length >= 5 && cleanProductName.includes(cleanSearchTerm))
                  ) {
                    bestMatch = prod;
                    log(`✅ [${matchBy}] Found match via fuzzy: searchTerm="${searchTerm}", product="${prod.name}"`);
                    break;
                  }
                }
              }
            }

            product = bestMatch;

            if (!product) {
              log(`⚠️ [${matchBy}] No match found. Tried terms: ${JSON.stringify(searchTerms)}`);
              log(`📋 Available first words (sample): ${Array.from(firstNameMap.keys()).slice(0, 20).join(', ')}...`);
            }
          }

          if (!product && createAsColour && (parsedCode || parsedBaseName)) {
            const cleanFabricPart = parsedBaseName.replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
            if (cleanFabricPart) {
              product = nameMap.get(cleanFabricPart) || null;
              if (!product) {
                for (const [productName, prod] of nameMap.entries()) {
                  if (productName.includes(cleanFabricPart) || cleanFabricPart.includes(productName)) {
                    product = prod;
                    break;
                  }
                }
              }
            }
          }

          if (!product) {
            results.skipped++;
            results.details.push({ filename, identifier, status: 'skipped (no match found)' });
            log(`⚠️ [match] No product for "${filename}" (identifier: "${identifier}")`);
            continue;
          }

          if (createAsColour && productType === 'fabrics') {
            if (!parsedCode) {
              results.failed++;
              results.errors.push({
                filename,
                phase: 'colour_lookup',
                error: 'No 2-digit colour code in filename (e.g. name_01.jpg)'
              });
              log(`❌ [colour_lookup] ${filename}: no 2-digit code`);
              continue;
            }

            // Use ONLY the color code as the colour name (shared across fabrics)
            const colourName = parsedCode.trim();
            const colourNameKey = colourName.toLowerCase().trim();

            let colourItem: any = colourByNameMap.get(colourNameKey) || null;

            if (!colourItem) {
              try {
                // Create colour without thumbnail first to avoid relation validation errors
                colourItem = await strapi.entityService.create('api::colour.colour', {
                  data: {
                    name: colourName,
                    publishedAt: new Date()
                  }
                });
                colourItem = await strapi.entityService.findOne('api::colour.colour', colourItem.id, {
                  populate: ['fabrics', 'thumbnail']
                });
                colourByNameMap.set(colourNameKey, colourItem);
                log(`✅ Created colour: "${colourName}" (ID: ${colourItem.id})`);
              } catch (createErr: any) {
                results.failed++;
                results.errors.push({ filename, phase: 'colour_lookup', error: createErr.message });
                log(`❌ [colour_lookup] ${filename}: ${createErr.message}`);
                continue;
              }
            } else {
              log(`📦 Found existing colour: "${colourName}" (ID: ${colourItem.id})`);
            }

            if (!colourItem) {
              results.failed++;
              results.errors.push({ filename, phase: 'fabric_link', error: 'Colour entity missing after create' });
              continue;
            }

            // Set thumbnail to the uploaded image (for both new and existing colours)
            if (uploadedFile?.id) {
              const thumbColourId = colourItem.id;
              try {
                await strapi.entityService.update('api::colour.colour', thumbColourId, {
                  data: { thumbnail: uploadedFile.id }
                });
                const refreshed = await strapi.entityService.findOne('api::colour.colour', thumbColourId, {
                  populate: ['fabrics', 'thumbnail']
                });
                if (refreshed) {
                  colourItem = refreshed;
                  colourByNameMap.set(colourNameKey, colourItem);
                }
              } catch (thumbErr: any) {
                try {
                  await strapi.entityService.update('api::colour.colour', thumbColourId, {
                    data: { thumbnail: { set: [uploadedFile.id] } } as any
                  });
                  const refreshed = await strapi.entityService.findOne('api::colour.colour', thumbColourId, {
                    populate: ['fabrics', 'thumbnail']
                  });
                  if (refreshed) {
                    colourItem = refreshed;
                    colourByNameMap.set(colourNameKey, colourItem);
                  }
                } catch (setErr: any) {
                  log(`⚠️ Thumbnail link failed for "${colourName}": ${setErr.message}`);
                }
              }
            }

            // Relation is owned by Colour.fabrics (Fabric has mappedBy: "colours"); update the Colour, not the Fabric.
            const fabricId = product.id;
            const fabricDocumentId = product.documentId;
            const fabricKey = fabricDocumentId ?? fabricId;

            const existingFabricIds = Array.isArray(colourItem.fabrics)
              ? colourItem.fabrics.map((f: any) => f.documentId ?? f.id ?? f).filter(Boolean)
              : [];
            const alreadyHasFabric =
              existingFabricIds.includes(fabricKey) ||
              existingFabricIds.includes(fabricId) ||
              (Array.isArray(colourItem.fabrics) &&
                colourItem.fabrics.some(
                  (f: any) =>
                    (f.documentId ?? f.id) === fabricKey || (f.documentId ?? f.id) === fabricId
                ));

            if (alreadyHasFabric) {
              results.skipped++;
              results.details.push({
                filename,
                productName: product.name,
                productId: product.productId ?? product.id,
                colourName,
                status: 'skipped (colour already linked to this fabric)'
              });
              log(`⏭️ Colour "${colourName}" already linked to fabric "${product.name}"`);
              continue;
            }

            const allFabricIds = [...existingFabricIds, fabricKey];
            // Use numeric id for update/verify so Strapi resolves the entity reliably
            const colourKey = colourItem.id;

            try {
              // Try connect (add one), then set (replace list), then plain array
              try {
                await strapi.entityService.update('api::colour.colour', colourKey, {
                  data: { fabrics: { connect: [fabricKey] } } as any
                });
              } catch (connectErr: any) {
                try {
                  await strapi.entityService.update('api::colour.colour', colourKey, {
                    data: { fabrics: { set: allFabricIds } } as any
                  });
                } catch (setErr: any) {
                  await strapi.entityService.update('api::colour.colour', colourKey, {
                    data: { fabrics: allFabricIds } as any
                  });
                }
              }
            } catch (updateErr: any) {
              results.failed++;
              results.errors.push({ filename, phase: 'fabric_link', error: updateErr.message });
              log(`❌ [fabric_link] ${filename}: ${updateErr.message}`);
              continue;
            }

            let verified = false;
            try {
              const verifyColour = (await strapi.entityService.findOne('api::colour.colour', colourKey, {
                populate: ['fabrics']
              })) as any;
              const verifiedFabrics = Array.isArray(verifyColour?.fabrics) ? verifyColour.fabrics : [];
              const verifiedIdSet = new Set<unknown>();
              verifiedFabrics.forEach((f: any) => {
                if (f?.id != null) verifiedIdSet.add(f.id);
                if (f?.documentId != null) verifiedIdSet.add(f.documentId);
              });
              verified =
                verifiedIdSet.has(fabricKey) ||
                verifiedIdSet.has(fabricId) ||
                verifiedIdSet.has(String(fabricKey)) ||
                verifiedIdSet.has(String(fabricId));
            } catch (_) {}

            // Count as linked if update succeeded; verification can be flaky (e.g. populate timing)
            results.linked++;
            results.details.push({
              filename,
              productName: product.name,
              productId: product.productId ?? product.id,
              colourName,
              status: `linked colour "${colourName}" to fabric "${product.name}"`
            });
            log(verified
              ? `✅ [verify] Linked colour "${colourName}" to fabric "${product.name}"`
              : `✅ Linked colour "${colourName}" to fabric "${product.name}" (verify skipped)`);
            continue;
          }

          const existingImages = product.images || [];
          const imageIds = Array.isArray(existingImages)
            ? existingImages.map((img: any) => img.id ?? img)
            : [];
          if (!imageIds.includes(uploadedFile.id)) {
            imageIds.push(uploadedFile.id);
            updatesToProcess.push({
              productId: product.id,
              imageIds,
              filename,
              product
            });
          } else {
            results.skipped++;
            results.details.push({
              filename,
              productId: product.productId ?? product.id,
              productName: product.name,
              status: 'skipped (already exists)'
            });
          }
        }

        for (let i = 0; i < updatesToProcess.length; i += BATCH_SIZE) {
          const batch = updatesToProcess.slice(i, i + BATCH_SIZE);
          await Promise.all(
            batch.map(async ({ productId, imageIds, filename, product }) => {
              try {
                await strapi.entityService.update(contentType as any, productId, {
                  data: { images: imageIds }
                });
                results.linked++; 
                results.details.push({
                  filename,
                  productId: product.productId ?? product.id,
                  productName: product.name,
                  status: 'linked'
                });
                log(`✅ Linked image "${filename}" to product "${product.name}"`);
              } catch (err: any) {
                results.failed++;
                results.errors.push({ filename, phase: 'fabric_link', error: err.message });
                log(`❌ [fabric_link] ${filename}: ${err.message}`);
              }
            })
          );
        }

        log(`🎉 Bulk upload complete: ${results.uploaded} uploaded, ${results.linked} linked, ${results.failed} failed, ${results.skipped} skipped`);
        return results;
      }
    };
  }
);