import React, { useState, useCallback } from 'react';
import { Upload, X, CheckCircle, AlertCircle, Loader2, Image as ImageIcon } from 'lucide-react';

export default function BulkImageUploader({ productType = 'fabrics' }) {
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [matchBy, setMatchBy] = useState('productId');
  const [createAsColour, setCreateAsColour] = useState(false);
  const [results, setResults] = useState(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({
    current: 0,
    total: 0,
    currentFileName: '',
    status: '' // 'uploading', 'matching', 'linking', 'complete'
  });

  const getAuthHeaders = () => {
    const token = localStorage.getItem('strapi-token') || localStorage.getItem('jwtToken');
    return {
      ...(token && { 'Authorization': `Bearer ${token}` })
    };
  };

  const handleFileSelect = (files) => {
    const imageFiles = Array.from(files).filter(file => 
      file.type.startsWith('image/')
    );
    
    setSelectedFiles(prev => [...prev, ...imageFiles]);
    setResults(null);
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
            formData.append('createAsColour', createAsColour ? 'true' : 'false');

            const response = await fetch('/api/order-management/bulk-image-upload', {
              method: 'POST',
              headers: getAuthHeaders(),
              body: formData
            });

            if (!response.ok) {
              const errorData = await response.json();
              throw new Error(errorData.error || `Upload failed: ${response.status}`);
            }

            const data = await response.json();
            
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
            allResults.failed++;
            allResults.errors.push({
              filename: fileName,
              error: error.message
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
      alert(`Failed to upload images: ${error.message}`);
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
    <div style={{ 
      padding: '24px', 
      paddingBottom: uploading ? '120px' : '24px', // Extra padding when progress bar is visible
      maxWidth: '1200px', 
      margin: '0 auto' 
    }}>
      <div style={{ marginBottom: '32px' }}>
        <h2 style={{ fontSize: '24px', fontWeight: '700', color: '#111827', marginBottom: '8px' }}>
          📸 Bulk Image Upload
        </h2>
        <p style={{ fontSize: '14px', color: '#6b7280' }}>
          Upload multiple images and automatically link them to existing products
        </p>
      </div>

      {/* Create as Colour Option */}
      {productType === 'fabrics' && (
        <div style={{ marginBottom: '24px', padding: '16px', background: '#f0f9ff', borderRadius: '8px', border: '1px solid #bae6fd' }}>
          <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={createAsColour}
              onChange={(e) => setCreateAsColour(e.target.checked)}
              style={{ marginRight: '8px', width: '16px', height: '16px' }}
            />
            <span style={{ fontSize: '14px', color: '#374151' }}>
              <strong>Create as Colour Item:</strong> Create/add image as a colour item and auto-link to matching fabric
            </span>
          </label>
        </div>
      )}

      {/* Match By Selection */}
      <div style={{ marginBottom: '24px', padding: '16px', background: '#f9fafb', borderRadius: '8px' }}>
        <label style={{ display: 'block', fontSize: '14px', fontWeight: '600', color: '#374151', marginBottom: '8px' }}>
          Match Images By:
        </label>
        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
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
          accept="image/*"
          onChange={handleFileInput}
          style={{ display: 'none' }}
        />
        
        <ImageIcon size={48} style={{ color: '#9ca3af', marginBottom: '16px' }} />
        <div style={{ fontSize: '18px', fontWeight: '600', color: '#374151', marginBottom: '8px' }}>
          Drop images here or click to browse
        </div>
        <div style={{ fontSize: '14px', color: '#6b7280' }}>
          Select multiple images to upload and auto-link to products
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
          
          <div style={{
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

      {/* Upload Button */}
      {selectedFiles.length > 0 && !uploading && (
        <div style={{ marginBottom: '24px' }}>
          <button
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
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}





