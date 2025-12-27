import React, { useState, useCallback } from 'react';

export default function ImageUploader({ 
  images = [], 
  onImagesChange, 
  maxImages = 10,
  acceptedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
}) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({});
  const [imageErrors, setImageErrors] = useState({}); // Track which images have errors

  // Debug logging
  console.log('🖼️ ImageUploader received images:', images);

  const getAuthHeaders = () => {
    const token = localStorage.getItem('strapi-token') || localStorage.getItem('jwtToken');
    return {
      ...(token && { 'Authorization': `Bearer ${token}` })
    };
  };

  const handleImageUpload = async (files) => {
    if (!files || files.length === 0) return;

    setUploading(true);
    const formData = new FormData();
    
    Array.from(files).forEach(file => {
      formData.append('files', file);
    });

    try {
      const response = await fetch('/api/upload', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: formData
      });

      if (!response.ok) {
        throw new Error(`Upload failed: ${response.status}`);
      }

      const uploadedFiles = await response.json();
      const newImageIds = uploadedFiles.map(f => f.id);
      
      // Add new images to existing ones
      const updatedImages = [...images, ...newImageIds];
      onImagesChange(updatedImages);
      
      console.log('✅ Images uploaded successfully:', newImageIds);
    } catch (error) {
      console.error('❌ Error uploading images:', error);
      alert('Failed to upload images. Please try again.');
    } finally {
      setUploading(false);
      setUploadProgress({});
    }
  };

  const handleFileSelect = (e) => {
    const files = e.target.files;
    handleImageUpload(files);
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
    
    const files = e.dataTransfer.files;
    const imageFiles = Array.from(files).filter(file => 
      acceptedTypes.includes(file.type)
    );
    
    if (imageFiles.length > 0) {
      handleImageUpload(imageFiles);
    }
  }, [acceptedTypes]);

  const removeImage = (indexToRemove) => {
    const updatedImages = images.filter((_, index) => index !== indexToRemove);
    onImagesChange(updatedImages);
  };

  const getImageUrl = (imageId) => {
    // Handle both string IDs and object IDs
    const id = typeof imageId === 'object' ? imageId.id : imageId;
    
    // If it's already a full URL, return it
    if (typeof imageId === 'object' && imageId.url) {
      console.log('🖼️ Using full image URL:', imageId.url);
      return imageId.url;
    }
    
    // Otherwise, use the admin API endpoint for images
    const url = `/admin/upload/files/${id}`;
    console.log('🖼️ Image URL generated:', url, 'for ID:', id);
    return url;
  };

  return (
    <div style={{ marginBottom: '24px' }}>
      <label style={{
        display: 'block',
        marginBottom: '12px',
        fontSize: '14px',
        fontWeight: '600',
        color: '#374151'
      }}>
        📸 Product Images
        <span style={{ color: '#6b7280', fontWeight: '400', marginLeft: '8px' }}>
          ({images.length}/{maxImages})
        </span>
      </label>

      {/* Upload Area */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        style={{
          border: `2px dashed ${isDragOver ? '#3b82f6' : '#d1d5db'}`,
          borderRadius: '12px',
          padding: '32px',
          textAlign: 'center',
          background: isDragOver ? '#eff6ff' : '#f9fafb',
          transition: 'all 0.3s ease',
          cursor: 'pointer',
          marginBottom: '16px'
        }}
        onClick={() => document.getElementById('image-upload').click()}
      >
        <input
          id="image-upload"
          type="file"
          multiple
          accept={acceptedTypes.join(',')}
          onChange={handleFileSelect}
          style={{ display: 'none' }}
        />
        
        {uploading ? (
          <div>
            <div style={{ fontSize: '24px', marginBottom: '8px' }}>⏳</div>
            <div style={{ fontSize: '16px', fontWeight: '600', color: '#3b82f6' }}>
              Uploading images...
            </div>
          </div>
        ) : (
          <div>
            <div style={{ fontSize: '32px', marginBottom: '12px' }}>📁</div>
            <div style={{ fontSize: '16px', fontWeight: '600', color: '#374151', marginBottom: '4px' }}>
              Drop images here or click to browse
            </div>
            <div style={{ fontSize: '14px', color: '#6b7280' }}>
              Supports: JPG, PNG, GIF, WebP (max {maxImages} images)
            </div>
          </div>
        )}
      </div>

      {/* Image Preview Grid */}
      {images.length > 0 && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
          gap: '12px',
          marginTop: '16px'
        }}>
          {images.map((imageId, index) => (
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
              {imageErrors[index] ? (
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: '100%',
                  color: '#6b7280',
                  fontSize: '12px'
                }}>
                  Image Error
                </div>
              ) : (
                <img
                  src={getImageUrl(imageId)}
                  alt={`Product image ${index + 1}`}
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover'
                  }}
                  onError={(e) => {
                    e.target.style.display = 'none';
                    // SECURITY: Use React state instead of innerHTML
                    setImageErrors(prev => ({ ...prev, [index]: true }));
                  }}
                />
              )}
              
              {/* Remove Button */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  removeImage(index);
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
                  justifyContent: 'center',
                  transition: 'all 0.2s ease'
                }}
                onMouseEnter={(e) => {
                  e.target.style.background = 'rgba(239, 68, 68, 1)';
                  e.target.style.transform = 'scale(1.1)';
                }}
                onMouseLeave={(e) => {
                  e.target.style.background = 'rgba(239, 68, 68, 0.9)';
                  e.target.style.transform = 'scale(1)';
                }}
              >
                ✕
              </button>
              
              {/* Image Index */}
              <div style={{
                position: 'absolute',
                bottom: '4px',
                left: '4px',
                background: 'rgba(0, 0, 0, 0.7)',
                color: 'white',
                fontSize: '10px',
                padding: '2px 6px',
                borderRadius: '4px',
                fontWeight: '600'
              }}>
                {index + 1}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Upload Instructions */}
      {images.length === 0 && (
        <div style={{
          background: 'linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%)',
          padding: '16px',
          borderRadius: '8px',
          border: '1px solid #bae6fd',
          marginTop: '12px'
        }}>
          <div style={{ fontSize: '14px', color: '#0369a1', fontWeight: '600', marginBottom: '4px' }}>
            💡 Image Upload Tips:
          </div>
          <ul style={{ fontSize: '12px', color: '#0369a1', margin: '0', paddingLeft: '16px' }}>
            <li>Upload high-quality images for better product presentation</li>
            <li>Use consistent aspect ratios for a professional look</li>
            <li>First image will be used as the main product image</li>
            <li>Images are automatically optimized by Strapi</li>
          </ul>
        </div>
      )}
    </div>
  );
}
