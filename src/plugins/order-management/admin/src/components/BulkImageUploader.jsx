import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Upload, X, CheckCircle, AlertCircle, Loader2, Image as ImageIcon } from 'lucide-react';
import { extractColorId, matchImageToProduct, parseColorIdFromFilename } from '../utils/imageMatching';
import adminCatalogRoutes from '../../../shared/routes';
import { fetchAllFabrics } from '../../../shared/fetch-all-fabrics';
import AshleyWildeFolderImporter from './AshleyWildeFolderImporter';
import { normalizeStagingError, parseStagingResponse, STAGING_PARSER_VERSION, STAGING_RETRY_MESSAGE } from '../utils/stagingResponse';

function bulkUploadErrorMessage(error) {
  const status = error?.status || error?.response?.status;
  if (status === 503 || error?.code === 'ASHLEY_WILDE_UPSTREAM_UNAVAILABLE') return STAGING_RETRY_MESSAGE;
  if (status === 413) return 'The server rejected this upload because the request was too large. Retry with a smaller file.';
  if (/unexpected token|json/i.test(String(error?.message || ''))) return 'The upload response was invalid. Check its status before retrying.';
  return error?.message || 'The image upload failed. Try again.';
}

export default function BulkImageUploader({ productType = 'fabrics' }) {
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [matchBy, setMatchBy] = useState('colorId'); // Default to color ID matching
  const [results, setResults] = useState(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({
    current: 0,
    total: 0,
    currentFileName: '',
    status: '' // 'uploading', 'matching', 'linking', 'complete'
  });

  // New state for color ID matching
  const [imageMatches, setImageMatches] = useState([]);
  const [products, setProducts] = useState([]);
  const [colorMappings, setColorMappings] = useState({});
  const [showColorMapping, setShowColorMapping] = useState(false);
  const catalogueControllerRef = useRef(null);

  const getAuthHeaders = () => {
    // Use Strapi's internal admin API - get the JWT token from Strapi's admin context
    // This matches the pattern used in ProductManagementPage
    const token = window.strapi?.auth?.getToken?.() ||
      localStorage.getItem('strapi-token') ||
      localStorage.getItem('jwtToken');

    return {
      ...(token && { 'Authorization': `Bearer ${token}` })
    };
  };

  // Fetch products when component mounts or productType changes
  useEffect(() => {
    const controller = new AbortController();
    catalogueControllerRef.current = controller;
    const fetchProducts = async () => {
      try {
        const apiPath = `/api/${productType}`;
        if (productType === 'fabrics') {
          const data = await fetchAllFabrics({ fetchImpl: fetch, headers: getAuthHeaders(), populate: '*', signal: controller.signal });
          setProducts(data.data);
          return;
        }
        const response = await fetch(`${apiPath}?populate=*`, {
          headers: getAuthHeaders(), signal: controller.signal
        });

        if (response.ok) {
          const data = await response.json();
          setProducts(data.data || []);
        }
      } catch (error) {
        if (!controller.signal.aborted) console.error('Error fetching products:', error);
      }
    };

    if (matchBy === 'colorId') {
      fetchProducts();
    }
    return () => {
      controller.abort();
      if (catalogueControllerRef.current === controller) catalogueControllerRef.current = null;
    };
  }, [productType, matchBy]);

  const cancelCatalogueRequests = useCallback(() => {
    catalogueControllerRef.current?.abort();
  }, []);

  const handleFileSelect = (files) => {
    const validFiles = Array.from(files).filter(file =>
      file.type.startsWith('image/') ||
      file.type === 'application/zip' ||
      file.type === 'application/x-zip-compressed' ||
      file.name.toLowerCase().endsWith('.zip')
    );

    setSelectedFiles(prev => [...prev, ...validFiles]);
    setResults(null);

    // If using color ID matching, match images to products
    if (matchBy === 'colorId' && products.length > 0) {
      const matches = validFiles.map(file => {
        const productMatches = matchImageToProduct(file.name, products);
        const parsed = parseColorIdFromFilename(file.name);

        return {
          file,
          colorId: parsed.colorId,
          matches: productMatches,
          selectedProduct: productMatches[0]?.productId || null
        };
      });

      setImageMatches(prev => [...prev, ...matches]);

      // Extract unique color IDs
      const uniqueColorIds = [...new Set(matches.map(m => m.colorId))];
      const newMappings = {};
      uniqueColorIds.forEach(id => {
        if (!colorMappings[id]) {
          newMappings[id] = '';
        }
      });
      setColorMappings(prev => ({ ...prev, ...newMappings }));
    }
  };

  const handleFileInput = (e) => {
    if (e.target.files) {
      handleFileSelect(e.target.files);
    }
  };

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files) {
      handleFileSelect(e.dataTransfer.files);
    }
  }, []);

  const removeFile = (index) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
    setImageMatches(prev => prev.filter((_, i) => i !== index));
    setResults(null);
  };

  const handleUpload = async () => {
    if (selectedFiles.length === 0) {
      alert('Please select at least one image');
      return;
    }

    setUploading(true);
    setResults(null);

    // Initialize progress
    setUploadProgress({
      current: 0,
      total: selectedFiles.length,
      currentFileName: '',
      status: 'starting'
    });

    const allResults = {
      uploaded: 0,
      linked: 0,
      failed: 0,
      skipped: 0,
      errors: [],
      details: []
    };

    // Upload in batches of 10 to balance progress visibility with API efficiency
    const BATCH_SIZE = 10;
    const batches = [];
    for (let i = 0; i < selectedFiles.length; i += BATCH_SIZE) {
      batches.push(selectedFiles.slice(i, i + BATCH_SIZE));
    }

    try {
      // Process each batch
      for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
        const batch = batches[batchIndex];

        // Upload files in batch one at a time for progress visibility
        for (let fileIndex = 0; fileIndex < batch.length; fileIndex++) {
          const file = batch[fileIndex];
          const fileName = file.name;
          const globalIndex = batchIndex * BATCH_SIZE + fileIndex + 1;

          setUploadProgress({
            current: globalIndex,
            total: selectedFiles.length,
            currentFileName: fileName,
            status: 'uploading'
          });

          try {
            const formData = new FormData();
            formData.append('files', file);
            formData.append('productType', productType);
            formData.append('matchBy', matchBy);

            // Add color ID matching data if in color ID mode
            if (matchBy === 'colorId' && imageMatches[globalIndex - 1]) {
              const match = imageMatches[globalIndex - 1];
              formData.append('colorId', match.colorId);
              formData.append('selectedProductId', match.selectedProduct || '');
              formData.append('colorName', colorMappings[match.colorId] || '');
            }

            const response = await fetch(adminCatalogRoutes.bulkImageUpload, {
              method: 'POST',
              headers: getAuthHeaders(),
              body: formData,
              credentials: 'include', // Include cookies/session for authentication
            });

            console.debug('[Ashley Wilde staging]', {
              step: 'bulk-upload-response-parser',
              parserVersion: STAGING_PARSER_VERSION,
              fileName,
            });
            const data = await parseStagingResponse(response);

            // Merge results
            if (data.results) {
              allResults.uploaded += data.results.uploaded || 0;
              allResults.linked += data.results.linked || 0;
              allResults.failed += data.results.failed || 0;
              allResults.skipped += data.results.skipped || 0;
              if (data.results.errors) allResults.errors.push(...data.results.errors);
              if (data.results.details) allResults.details.push(...data.results.details);
            }

            // Longer delay between uploads to avoid Windows file locking and overwhelming the server
            // Match backend delay (1000ms) plus a bit extra for network
            if (fileIndex < batch.length - 1 || batchIndex < batches.length - 1) {
              await new Promise(resolve => setTimeout(resolve, 1200)); // 1.2 second delay
            }
          } catch (error) {
            console.error(`❌ Error uploading ${fileName}:`, error);
            const normalized = await normalizeStagingError(error);
            const safeMessage = bulkUploadErrorMessage(normalized);
            allResults.failed++;
            allResults.errors.push({
              filename: fileName,
              error: safeMessage
            });
            setUploadProgress(prev => ({ ...prev, status: 'error' }));

            // Continue with next file even if one fails
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        }
      }

      setResults(allResults);
      setSelectedFiles([]); // Clear after successful upload

      console.log('✅ Bulk upload completed:', allResults);
    } catch (error) {
      console.error('❌ Error in upload process:', error);
      const normalized = await normalizeStagingError(error);
      alert(`Failed to upload images: ${bulkUploadErrorMessage(normalized)}`);
    } finally {
      setUploading(false);
      setUploadProgress({
        current: 0,
        total: 0,
        currentFileName: '',
        status: ''
      });
    }
  };

  const getIdentifierFromFilename = (filename) => {
    return filename.replace(/\.[^/.]+$/, '');
  };

  return (
    <div className={`bulk-image-upload-shell${uploading ? ' bulk-image-upload-shell--uploading' : ''}`}>
      <div style={{ marginBottom: '32px' }}>
        <h2 style={{ fontSize: '24px', fontWeight: '700', color: '#111827', marginBottom: '8px' }}>
          📸 Bulk Image Upload
        </h2>
        <p style={{ fontSize: '14px', color: '#6b7280' }}>
          Upload multiple images and automatically link them to existing products
        </p>
      </div>

      {productType === 'fabrics' && <AshleyWildeFolderImporter onStagingStart={cancelCatalogueRequests} />}

      {/* Match By Selection */}
      <div className="bulk-match-methods" style={{ marginBottom: '24px', padding: '16px', background: '#f9fafb', borderRadius: '8px' }}>
        <label style={{ display: 'block', fontSize: '14px', fontWeight: '600', color: '#374151', marginBottom: '8px' }}>
          Match Images By:
        </label>
        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
            <input
              type="radio"
              value="colorId"
              checked={matchBy === 'colorId'}
              onChange={(e) => setMatchBy(e.target.value)}
              style={{ marginRight: '8px' }}
            />
            <span style={{ fontSize: '14px', color: '#374151' }}>
              <strong>Color ID (Smart Matching)</strong> - Extract last 2 chars as color ID and match product name
            </span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
            <input
              type="radio"
              value="productId"
              checked={matchBy === 'productId'}
              onChange={(e) => setMatchBy(e.target.value)}
              style={{ marginRight: '8px' }}
            />
            <span style={{ fontSize: '14px', color: '#374151' }}>
              Product ID (e.g., "FAB-ABELLA-TATTON.jpg" → "FAB-ABELLA-TATTON")
            </span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
            <input
              type="radio"
              value="slug"
              checked={matchBy === 'slug'}
              onChange={(e) => setMatchBy(e.target.value)}
              style={{ marginRight: '8px' }}
            />
            <span style={{ fontSize: '14px', color: '#374151' }}>
              Slug
            </span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
            <input
              type="radio"
              value="name"
              checked={matchBy === 'name'}
              onChange={(e) => setMatchBy(e.target.value)}
              style={{ marginRight: '8px' }}
            />
            <span style={{ fontSize: '14px', color: '#374151' }}>
              Product Name (partial match)
            </span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
            <input
              type="radio"
              value="firstName"
              checked={matchBy === 'firstName'}
              onChange={(e) => setMatchBy(e.target.value)}
              style={{ marginRight: '8px' }}
            />
            <span style={{ fontSize: '14px', color: '#374151' }}>
              First Name (e.g., "Abella Fabric" matches "abella.jpg")
            </span>
          </label>
        </div>
      </div>

      {/* Upload Area */}
      <div
        className="bulk-upload-dropzone"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => document.getElementById('bulk-image-upload').click()}
        style={{
          border: `2px dashed ${isDragOver ? '#3b82f6' : '#d1d5db'}`,
          borderRadius: '12px',
          padding: '48px',
          textAlign: 'center',
          background: isDragOver ? '#eff6ff' : '#f9fafb',
          transition: 'all 0.3s ease',
          cursor: 'pointer',
          marginBottom: '24px'
        }}
      >
        <input
          id="bulk-image-upload"
          type="file"
          multiple
          accept="image/*,.zip"
          onChange={handleFileInput}
          style={{ display: 'none' }}
        />

        <ImageIcon size={48} style={{ color: '#9ca3af', marginBottom: '16px' }} />
        <div style={{ fontSize: '18px', fontWeight: '600', color: '#374151', marginBottom: '8px' }}>
          Drop images here or click to browse
        </div>
        <div style={{ fontSize: '14px', color: '#6b7280' }}>
          Select multiple images or ZIP folders to upload and auto-link to products
        </div>
      </div>

      {/* Selected Files Preview */}
      {selectedFiles.length > 0 && (
        <div style={{ marginBottom: '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h3 style={{ fontSize: '16px', fontWeight: '600', color: '#374151' }}>
              Selected Images ({selectedFiles.length})
            </h3>
            <button
              onClick={() => setSelectedFiles([])}
              style={{
                padding: '6px 12px',
                fontSize: '14px',
                color: '#ef4444',
                background: 'transparent',
                border: '1px solid #ef4444',
                borderRadius: '6px',
                cursor: 'pointer'
              }}
            >
              Clear All
            </button>
          </div>

          <div className="bulk-selected-files-grid" style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
            gap: '16px'
          }}>
            {selectedFiles.map((file, index) => (
              <div
                key={index}
                style={{
                  position: 'relative',
                  aspectRatio: '1',
                  borderRadius: '8px',
                  overflow: 'hidden',
                  background: '#f3f4f6',
                  border: '2px solid #e5e7eb'
                }}
              >
                <img
                  src={URL.createObjectURL(file)}
                  alt={file.name}
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover'
                  }}
                />
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    removeFile(index);
                  }}
                  style={{
                    position: 'absolute',
                    top: '4px',
                    right: '4px',
                    background: 'rgba(239, 68, 68, 0.9)',
                    color: 'white',
                    border: 'none',
                    borderRadius: '50%',
                    width: '24px',
                    height: '24px',
                    fontSize: '12px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  <X size={14} />
                </button>
                <div style={{
                  position: 'absolute',
                  bottom: '0',
                  left: '0',
                  right: '0',
                  background: 'rgba(0, 0, 0, 0.7)',
                  color: 'white',
                  fontSize: '10px',
                  padding: '4px 8px',
                  wordBreak: 'break-all'
                }}>
                  {file.name}
                </div>
                <div style={{
                  position: 'absolute',
                  top: '4px',
                  left: '4px',
                  background: 'rgba(0, 0, 0, 0.7)',
                  color: 'white',
                  fontSize: '10px',
                  padding: '2px 6px',
                  borderRadius: '4px'
                }}>
                  {getIdentifierFromFilename(file.name)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Image Matches Preview (Color ID Mode) */}
      {matchBy === 'colorId' && imageMatches.length > 0 && (
        <div style={{ marginBottom: '24px' }}>
          <h3 style={{ fontSize: '16px', fontWeight: '600', color: '#374151', marginBottom: '16px' }}>
            Image Matches ({imageMatches.length})
          </h3>

          <div style={{ display: 'grid', gap: '16px' }}>
            {imageMatches.map((match, index) => (
              <div
                key={index}
                style={{
                  padding: '16px',
                  background: 'white',
                  borderRadius: '8px',
                  border: '2px solid #e5e7eb'
                }}
              >
                <div style={{ display: 'flex', gap: '16px', alignItems: 'start' }}>
                  {/* Image Preview */}
                  <div style={{
                    width: '100px',
                    height: '100px',
                    borderRadius: '8px',
                    overflow: 'hidden',
                    flexShrink: 0,
                    background: '#f3f4f6'
                  }}>
                    <img
                      src={URL.createObjectURL(match.file)}
                      alt={match.file.name}
                      style={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover'
                      }}
                    />
                  </div>

                  {/* Match Info */}
                  <div className="bulk-image-match-content" style={{ flex: 1 }}>
                    <div style={{ fontSize: '14px', fontWeight: '600', color: '#374151', marginBottom: '8px' }}>
                      {match.file.name}
                    </div>
                    <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '12px' }}>
                      Color ID: <span style={{
                        background: '#dbeafe',
                        color: '#1e40af',
                        padding: '2px 8px',
                        borderRadius: '4px',
                        fontWeight: '600'
                      }}>{match.colorId}</span>
                    </div>

                    {/* Product Selection */}
                    <div>
                      <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#374151', marginBottom: '4px' }}>
                        Select Product:
                      </label>
                      <select
                        value={match.selectedProduct || ''}
                        onChange={(e) => {
                          const newMatches = [...imageMatches];
                          newMatches[index].selectedProduct = e.target.value ? parseInt(e.target.value) : null;
                          setImageMatches(newMatches);
                        }}
                        style={{
                          width: '100%',
                          padding: '8px 12px',
                          fontSize: '14px',
                          border: '1px solid #d1d5db',
                          borderRadius: '6px',
                          background: 'white'
                        }}
                      >
                        <option value="">Select a product...</option>
                        {match.matches.map((productMatch, idx) => (
                          <option key={idx} value={productMatch.productId}>
                            {productMatch.productName} ({productMatch.confidence}% match)
                          </option>
                        ))}
                        {products.filter(p => !match.matches.find(m => m.productId === p.id)).map(product => (
                          <option key={product.id} value={product.id}>
                            {product.name} (manual)
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Match Confidence */}
                    {match.matches.length > 0 && match.matches[0].confidence && (
                      <div style={{ marginTop: '8px', fontSize: '12px' }}>
                        <span style={{
                          color: match.matches[0].confidence >= 80 ? '#059669' :
                            match.matches[0].confidence >= 60 ? '#f59e0b' : '#ef4444'
                        }}>
                          {match.matches[0].confidence >= 80 ? '✓ High confidence' :
                            match.matches[0].confidence >= 60 ? '⚠ Medium confidence' : '⚠ Low confidence'}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Color Mapping Interface */}
      {matchBy === 'colorId' && Object.keys(colorMappings).length > 0 && (
        <div style={{ marginBottom: '24px', padding: '16px', background: '#f0f9ff', borderRadius: '8px', border: '1px solid #bae6fd' }}>
          <h3 style={{ fontSize: '16px', fontWeight: '600', color: '#374151', marginBottom: '12px' }}>
            Color ID Mappings
          </h3>
          <p style={{ fontSize: '14px', color: '#6b7280', marginBottom: '16px' }}>
            Define what each color ID means (e.g., "01" = "Navy Blue")
          </p>

          <div className="bulk-color-mappings-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '12px' }}>
            {Object.keys(colorMappings).map(colorId => (
              <div key={colorId}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#374151', marginBottom: '4px' }}>
                  Color ID "{colorId}":
                </label>
                <input
                  type="text"
                  value={colorMappings[colorId]}
                  onChange={(e) => setColorMappings(prev => ({ ...prev, [colorId]: e.target.value }))}
                  placeholder="e.g., Navy Blue"
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    fontSize: '14px',
                    border: '1px solid #d1d5db',
                    borderRadius: '6px',
                    background: 'white'
                  }}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Upload Button */}
      {selectedFiles.length > 0 && !uploading && (
        <div style={{ marginBottom: '24px' }}>
          <button
            className="bulk-upload-submit"
            onClick={handleUpload}
            style={{
              padding: '12px 24px',
              fontSize: '16px',
              fontWeight: '600',
              color: 'white',
              background: '#3b82f6',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              margin: '0 auto'
            }}
          >
            <Upload size={20} />
            Upload & Link {selectedFiles.length} Image{selectedFiles.length !== 1 ? 's' : ''}
          </button>
        </div>
      )}

      {/* Uploading State with Progress Bar */}
      {uploading && (
        <div style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          background: 'white',
          borderTop: '2px solid #e5e7eb',
          padding: '20px 24px',
          boxShadow: '0 -4px 6px rgba(0,0,0,0.1)',
          zIndex: 1000
        }}>
          <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
            {/* Progress Text */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '12px'
            }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '16px', fontWeight: '600', color: '#374151', marginBottom: '4px' }}>
                  {uploadProgress.status === 'uploading' && '📤 Uploading...'}
                  {uploadProgress.status === 'matching' && '🔍 Matching...'}
                  {uploadProgress.status === 'linking' && '🔗 Linking...'}
                  {uploadProgress.status === 'error' && '❌ Error'}
                  {uploadProgress.status === 'complete' && '✅ Complete'}
                </div>
                <div style={{ fontSize: '14px', color: '#6b7280' }}>
                  {uploadProgress.currentFileName && (
                    <>
                      Processing: <strong>{uploadProgress.currentFileName}</strong>
                    </>
                  )}
                </div>
              </div>
              <div style={{ fontSize: '16px', fontWeight: '600', color: '#3b82f6', marginLeft: '16px' }}>
                {uploadProgress.current}/{uploadProgress.total}
              </div>
            </div>

            {/* Progress Bar */}
            <div style={{
              width: '100%',
              height: '12px',
              background: '#e5e7eb',
              borderRadius: '6px',
              overflow: 'hidden',
              marginBottom: '8px',
              position: 'relative'
            }}>
              <div style={{
                width: `${uploadProgress.total > 0 ? (uploadProgress.current / uploadProgress.total) * 100 : 0}%`,
                height: '100%',
                background: uploadProgress.status === 'error' ? '#ef4444' :
                  uploadProgress.status === 'complete' ? '#10b981' : '#3b82f6',
                transition: 'width 0.3s ease, background 0.3s ease',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'flex-end',
                paddingRight: '8px',
                minWidth: uploadProgress.status === 'uploading' ? '40px' : '0'
              }}>
                {uploadProgress.status === 'uploading' && uploadProgress.current > 0 && (
                  <Loader2 size={10} style={{ color: 'white', animation: 'spin 1s linear infinite' }} />
                )}
              </div>
            </div>

            {/* Percentage and Status */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              fontSize: '12px',
              color: '#6b7280',
              marginTop: '4px'
            }}>
              <span>
                {uploadProgress.total > 0
                  ? `${Math.round((uploadProgress.current / uploadProgress.total) * 100)}% complete`
                  : 'Starting...'}
              </span>
              <span style={{ fontWeight: '600' }}>
                {uploadProgress.current > 0 && uploadProgress.total > 0
                  ? `${uploadProgress.current} of ${uploadProgress.total} files`
                  : ''}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Results */}
      {results && (
        <div style={{
          marginTop: '32px',
          padding: '24px',
          background: '#f9fafb',
          borderRadius: '12px',
          border: '1px solid #e5e7eb'
        }}>
          <h3 style={{ fontSize: '18px', fontWeight: '600', color: '#374151', marginBottom: '16px' }}>
            Upload Results
          </h3>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '24px' }}>
            <div style={{ padding: '16px', background: 'white', borderRadius: '8px' }}>
              <div style={{ fontSize: '24px', fontWeight: '700', color: '#3b82f6' }}>
                {results.uploaded}
              </div>
              <div style={{ fontSize: '14px', color: '#6b7280' }}>Uploaded</div>
            </div>
            <div style={{ padding: '16px', background: 'white', borderRadius: '8px' }}>
              <div style={{ fontSize: '24px', fontWeight: '700', color: '#10b981' }}>
                {results.linked}
              </div>
              <div style={{ fontSize: '14px', color: '#6b7280' }}>Linked to Products</div>
            </div>
            <div style={{ padding: '16px', background: 'white', borderRadius: '8px' }}>
              <div style={{ fontSize: '24px', fontWeight: '700', color: '#f59e0b' }}>
                {results.skipped}
              </div>
              <div style={{ fontSize: '14px', color: '#6b7280' }}>Skipped</div>
            </div>
            <div style={{ padding: '16px', background: 'white', borderRadius: '8px' }}>
              <div style={{ fontSize: '24px', fontWeight: '700', color: '#ef4444' }}>
                {results.failed}
              </div>
              <div style={{ fontSize: '14px', color: '#6b7280' }}>Failed</div>
            </div>
          </div>

          {/* Details */}
          {results.details && results.details.length > 0 && (
            <div>
              <h4 style={{ fontSize: '16px', fontWeight: '600', color: '#374151', marginBottom: '12px' }}>
                Details
              </h4>
              <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
                {results.details.map((detail, index) => (
                  <div
                    key={index}
                    style={{
                      padding: '12px',
                      background: 'white',
                      borderRadius: '6px',
                      marginBottom: '8px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      fontSize: '14px'
                    }}
                  >
                    {detail.status === 'linked' ? (
                      <CheckCircle size={20} style={{ color: '#10b981', flexShrink: 0 }} />
                    ) : (
                      <AlertCircle size={20} style={{ color: '#f59e0b', flexShrink: 0 }} />
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: '600', color: '#374151' }}>
                        {detail.filename}
                      </div>
                      {detail.productName && (
                        <div style={{ fontSize: '12px', color: '#6b7280' }}>
                          → {detail.productName} {detail.productId && `(${detail.productId})`}
                        </div>
                      )}
                      <div style={{ fontSize: '12px', color: '#9ca3af', marginTop: '4px' }}>
                        {detail.status}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Errors */}
          {results.errors && results.errors.length > 0 && (
            <div style={{ marginTop: '24px' }}>
              <h4 style={{ fontSize: '16px', fontWeight: '600', color: '#ef4444', marginBottom: '12px' }}>
                Errors
              </h4>
              {results.errors.map((error, index) => (
                <div
                  key={index}
                  style={{
                    padding: '12px',
                    background: '#fef2f2',
                    borderRadius: '6px',
                    marginBottom: '8px',
                    fontSize: '14px',
                    color: '#991b1b'
                  }}
                >
                  <strong>{error.filename}:</strong> {error.error}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <style>{`
        .bulk-image-upload-shell { width: 100%; min-width: 0; padding: 24px; padding-bottom: 24px; }
        .bulk-image-upload-shell--uploading { padding-bottom: 120px; }
        .bulk-image-upload-shell h2, .bulk-image-upload-shell h3 { overflow-wrap: normal; word-break: normal; }
        .bulk-match-methods { min-width: 0; }
        .bulk-match-methods label { min-width: 0; }
        .bulk-match-methods label span { overflow-wrap: anywhere; }
        .bulk-image-match-content { min-width: 0; }
        .bulk-upload-dropzone { min-width: 0; padding: 48px; }
        .bulk-selected-files-grid { grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)) !important; }
        @media (max-width: 640px) {
          .bulk-image-upload-shell { padding: 16px; }
          .bulk-image-upload-shell--uploading { padding-bottom: 148px; }
          .bulk-upload-dropzone { padding: 28px 16px !important; }
          .bulk-color-mappings-grid { grid-template-columns: minmax(0, 1fr) !important; }
          .bulk-upload-submit { max-width: 100%; justify-content: center; flex-wrap: wrap; }
          .bulk-selected-files-grid { grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)) !important; gap: 10px !important; }
          .bulk-match-methods { padding: 14px !important; }
          .bulk-match-methods > div { display: grid !important; gap: 12px !important; }
          .bulk-match-methods label { align-items: flex-start !important; }
        }

        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}


