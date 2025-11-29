import React, { useState, useEffect } from 'react';
import ImageUploader from '../components/ImageUploader';
import excelHelper from '../utils/excelHelper';
import pdfHelper from '../utils/pdfHelper';
import { 
  Scissors, Blinds, Sofa, Tag, Layers, Palette, Settings, PackageSearch, 
  Plus, Download, Upload, FileText, Edit, Trash2, CheckSquare, Loader2, 
  PackageX, X, FileSpreadsheet, CheckCircle, Lightbulb, Heart, File 
} from 'lucide-react';

// Add spinner animation style
const spinnerStyle = `
  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
`;

export default function ProductManagementPage() {
  const [activeTab, setActiveTab] = useState('fabrics');
  const [products, setProducts] = useState({});
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedProducts, setSelectedProducts] = useState([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [formData, setFormData] = useState({});
  const [errors, setErrors] = useState({});
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importFile, setImportFile] = useState(null);
  const [importPreview, setImportPreview] = useState(null);
  const [importing, setImporting] = useState(false);
  const [showTemplateDropdown, setShowTemplateDropdown] = useState(false);
  const [importPreviewModal, setImportPreviewModal] = useState(false);
  const [importValidation, setImportValidation] = useState(null);
  const [importMode, setImportMode] = useState('file'); // 'file' or 'json'
  const [jsonInput, setJsonInput] = useState('');
  const [jsonError, setJsonError] = useState(null);

  // Product types configuration
  const productTypes = {
    fabrics: {
      name: 'Fabrics',
      icon: <Scissors size={16} />,
      apiPath: '/api/fabrics',
      fields: [
        { key: 'name', label: 'Name', type: 'text', required: true },
        { key: 'description', label: 'Description', type: 'textarea' },
        { key: 'productId', label: 'Product ID', type: 'text', required: true },
        { key: 'slug', label: 'Slug', type: 'text', required: true },
        { key: 'colour', label: 'Color', type: 'text', required: true },
        { key: 'pattern', label: 'Pattern', type: 'text', required: true },
        { key: 'composition', label: 'Composition', type: 'text', required: true },
        { key: 'price_per_metre', label: 'Price per Metre', type: 'number', required: true },
        { key: 'patternRepeat_cm', label: 'Pattern Repeat (cm)', type: 'number', required: true },
        { key: 'usableWidth_cm', label: 'Usable Width (cm)', type: 'number', required: true },
        { key: 'martindale', label: 'Martindale', type: 'number', required: true },
        { key: 'availability', label: 'Availability', type: 'select', options: ['in_stock', 'out_of_stock', 'discontinued'], required: true },
        { key: 'is_featured', label: 'Featured', type: 'checkbox' },
        { key: 'featured_until', label: 'Featured Until', type: 'datetime' }
      ]
    },
    blinds: {
      name: 'Blinds',
      icon: <Blinds size={16} />,
      apiPath: '/api/blinds',
      fields: [
        { key: 'name', label: 'Name', type: 'text', required: true },
        { key: 'fabrics', label: 'Fabrics', type: 'relation', relationType: 'manyToMany', target: 'fabrics' },
        { key: 'linings', label: 'Linings', type: 'relation', relationType: 'manyToMany', target: 'linings' },
        { key: 'trimmings', label: 'Trimmings', type: 'relation', relationType: 'manyToMany', target: 'trimmings' },
        { key: 'mechanisations', label: 'Mechanisations', type: 'relation', relationType: 'manyToMany', target: 'mechanisations' },
        { key: 'blind_type', label: 'Blind Type', type: 'relation', relationType: 'oneToOne', target: 'blind-types' }
      ]
    },
    curtains: {
      name: 'Curtains',
      icon: <Blinds size={16} />,
      apiPath: '/api/curtains',
      fields: [
        { key: 'name', label: 'Name', type: 'text', required: true },
        { key: 'fabrics', label: 'Fabrics', type: 'relation', relationType: 'manyToMany', target: 'fabrics' },
        { key: 'linings', label: 'Linings', type: 'relation', relationType: 'manyToMany', target: 'linings' },
        { key: 'trimmings', label: 'Trimmings', type: 'relation', relationType: 'manyToMany', target: 'trimmings' },
        { key: 'curtain_type', label: 'Curtain Type', type: 'relation', relationType: 'oneToOne', target: 'curtain-types' }
      ]
    },
    cushions: {
      name: 'Cushions',
      icon: <Sofa size={16} />,
      apiPath: '/api/cushions',
      fields: [
        { key: 'name', label: 'Name', type: 'text', required: true },
        { key: 'fabrics', label: 'Fabrics', type: 'relation', relationType: 'manyToMany', target: 'fabrics' },
        { key: 'cushion_type', label: 'Cushion Type', type: 'relation', relationType: 'oneToOne', target: 'cushion-types' }
      ]
    },
    brands: {
      name: 'Brands',
      icon: <Tag size={16} />,
      apiPath: '/api/brands',
      fields: [
        { key: 'name', label: 'Name', type: 'text', required: true },
        { key: 'description', label: 'Description', type: 'textarea' },
        { key: 'thumbnail', label: 'Thumbnail', type: 'file', required: false },
        { key: 'fabrics', label: 'Fabrics', type: 'relation', relationType: 'oneToMany', target: 'fabrics' }
      ]
    },
    linings: {
      name: 'Linings',
      icon: <Layers size={16} />,
      apiPath: '/api/linings',
      fields: [
        { key: 'liningType', label: 'Lining Type', type: 'text', required: true },
        { key: 'price', label: 'Price', type: 'number', required: true },
        { key: 'colour', label: 'Colour', type: 'text', required: true },
        { key: 'fabrics', label: 'Fabrics', type: 'relation', relationType: 'manyToMany', target: 'fabrics' }
      ]
    },
    trimmings: {
      name: 'Trimmings',
      icon: <Palette size={16} />,
      apiPath: '/api/trimmings',
      fields: [
        { key: 'type', label: 'Type', type: 'text', required: true },
        { key: 'price', label: 'Price', type: 'number', required: true },
        { key: 'fabrics', label: 'Fabrics', type: 'relation', relationType: 'manyToMany', target: 'fabrics' }
      ]
    },
    mechanisations: {
      name: 'Mechanisations',
      icon: <Settings size={16} />,
      apiPath: '/api/mechanisations',
      fields: [
        { key: 'type', label: 'Type', type: 'text', required: true },
        { key: 'price', label: 'Price', type: 'number', required: true },
        { key: 'blinds', label: 'Blinds', type: 'relation', relationType: 'manyToMany', target: 'blinds' }
      ]
    },
    pricing_rules: {
      name: 'Pricing Rules',
      icon: <Tag size={16} />,
      apiPath: '/api/pricing-rules',
      fields: [
        { key: 'name', label: 'Name', type: 'text', required: true },
        { key: 'product_type', label: 'Product Type', type: 'select', options: ['curtain', 'blind', 'cushion'], required: true },
        { key: 'formula', label: 'Formula', type: 'json', required: true },
        { key: 'curtains', label: 'Curtains', type: 'relation', relationType: 'manyToMany', target: 'curtains' },
        { key: 'blinds', label: 'Blinds', type: 'relation', relationType: 'manyToMany', target: 'blinds' },
        { key: 'cushions', label: 'Cushions', type: 'relation', relationType: 'manyToMany', target: 'cushions' }
      ]
    },
    care_instructions: {
      name: 'Care Instructions',
      icon: <Heart size={16} />,
      apiPath: '/api/care-instructions',
      fields: [
        { key: 'name', label: 'Name', type: 'text', required: true },
        { key: 'description', label: 'Description', type: 'textarea' },
        { key: 'fabrics', label: 'Fabrics', type: 'relation', relationType: 'manyToMany', target: 'fabrics' }
      ]
    }
  };

  useEffect(() => {
    fetchProducts();
  }, [activeTab]);

  // Close template dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (showTemplateDropdown && !event.target.closest('[data-template-dropdown]')) {
        setShowTemplateDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showTemplateDropdown]);

  const getAuthHeaders = () => {
    // Use Strapi's internal admin API - bypasses all permission restrictions
    // Get the JWT token from Strapi's admin context or localStorage
    const token = window.strapi?.auth?.getToken?.() || 
                  localStorage.getItem('strapi-token') || 
                  localStorage.getItem('jwtToken');
    
    return {
      'Content-Type': 'application/json',
      ...(token && { 'Authorization': `Bearer ${token}` })
    };
  };

  const fetchProducts = async () => {
    try {
      setLoading(true);
      const apiPath = productTypes[activeTab].apiPath;
      console.log(`🔍 Fetching products for ${activeTab} from ${apiPath}`);

      // Use populate=* for all product types to ensure all relations are loaded
      // For fabrics, also explicitly populate brand to ensure it loads
      let populateParam = 'populate=*';
      let fullUrl = `${apiPath}?${populateParam}`;
      
      if (activeTab === 'fabrics') {
        // Add explicit brand population for fabrics (Strapi v4+ requires this)
        fullUrl = `${apiPath}?populate[0]=brand&populate[1]=images&populate[2]=curtains&populate[3]=blinds&populate[4]=cushions&populate[5]=care_instructions`;
      } else if (activeTab === 'linings') {
        // Populate fabrics relation
        fullUrl = `${apiPath}?populate[0]=fabrics`;
      } else if (activeTab === 'trimmings') {
        fullUrl = `${apiPath}?populate[0]=fabrics`;
      } else if (activeTab === 'mechanisations') {
        fullUrl = `${apiPath}?populate[0]=blinds`;
      } else if (activeTab === 'care_instructions') {
        // Add explicit fabric population for care instructions
        fullUrl = `${apiPath}?populate[0]=fabrics`;
      } else if (activeTab === 'brands') {
        // Explicitly populate fabrics relation for brands (oneToMany in Strapi v4)
        fullUrl = `${apiPath}?populate[0]=fabrics`;
      } else {
        fullUrl = `${apiPath}?${populateParam}`;
      }
      
      fullUrl += '&publicationState=preview';
      console.log(`🔗 Full API URL: ${fullUrl}`);
      
      // Try Strapi's admin API first (bypasses permissions)
      let response = await fetch(fullUrl, {
        headers: getAuthHeaders(),
      });
      
      // If that fails, try without publicationState (admin API doesn't need it)
      if (!response.ok) {
        console.log(`⚠️  First attempt failed (${response.status}), trying admin API...`);
        const adminUrl = `${apiPath}?${populateParam}`;
        response = await fetch(adminUrl, {
          headers: getAuthHeaders(),
        });
      }

      console.log(`🔍 Response status: ${response.status}`);
      console.log(`🔍 Response ok: ${response.ok}`);
      console.log(`🔍 Using API: ${response.url}`);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`🔍 Error response: ${errorText}`);
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      console.log(`📦 Fetched products data for ${activeTab}:`, data);
      console.log(`📦 Data length: ${data.data ? data.data.length : 'no data'}`);
      
      // Professional debugging and diagnostics
      console.log(`📦 RAW API RESPONSE for ${activeTab}:`, data);
      
      if (data.data && data.data.length > 0) {
        const firstItem = data.data[0];
        console.log(`\n🔍 DIAGNOSTIC FOR ${activeTab.toUpperCase()}:`);
        console.log(`  ├─ Item name: ${firstItem.name || firstItem.type || firstItem.liningType || 'N/A'}`);
        console.log(`  ├─ All fields: ${Object.keys(firstItem).join(', ')}`);
        
        // Debug relations for specific types
        if (activeTab === 'brands') {
          console.log(`  ├─ Has fabrics field: ${firstItem.hasOwnProperty('fabrics') ? 'YES' : 'NO'}`);
          console.log(`  ├─ Fabrics value:`, firstItem.fabrics);
          console.log(`  ├─ Fabrics is array: ${Array.isArray(firstItem.fabrics) ? 'YES' : 'NO'}`);
          if (Array.isArray(firstItem.fabrics) && firstItem.fabrics.length > 0) {
            console.log(`  ├─ ✅ FABRICS POPULATED! Count: ${firstItem.fabrics.length}`);
            firstItem.fabrics.forEach((fabric, idx) => {
              console.log(`  │  ├─ Fabric ${idx + 1}: ${fabric?.name || 'Unknown'}`);
            });
          } else {
            console.log(`  ├─ ❌ FABRICS NOT POPULATED or EMPTY`);
          }
        }
        
        if (activeTab === 'linings' || activeTab === 'trimmings' || activeTab === 'mechanisations') {
          if (activeTab === 'linings') {
            console.log(`  ├─ Has fabrics: ${firstItem.hasOwnProperty('fabrics') ? 'YES' : 'NO'}`);
            console.log(`  ├─ Fabrics: ${Array.isArray(firstItem.fabrics) ? `${firstItem.fabrics.length} items` : 'NOT ARRAY'}`);
            if (Array.isArray(firstItem.fabrics) && firstItem.fabrics.length > 0) {
              firstItem.fabrics.forEach((fabric, idx) => {
                console.log(`  │  ├─ Fabric ${idx + 1}: ${fabric?.name || 'Unknown'}`);
              });
            }
          }
          if (activeTab === 'trimmings') {
            console.log(`  ├─ Has fabrics: ${firstItem.hasOwnProperty('fabrics') ? 'YES' : 'NO'}`);
            console.log(`  ├─ Fabrics: ${Array.isArray(firstItem.fabrics) ? `${firstItem.fabrics.length} items` : 'NOT ARRAY'}`);
            if (Array.isArray(firstItem.fabrics) && firstItem.fabrics.length > 0) {
              firstItem.fabrics.forEach((fabric, idx) => {
                console.log(`  │  ├─ Fabric ${idx + 1}: ${fabric?.name || 'Unknown'}`);
              });
            }
          }
          if (activeTab === 'mechanisations') {
            console.log(`  ├─ Has blinds: ${firstItem.hasOwnProperty('blinds') ? 'YES' : 'NO'}`);
            console.log(`  ├─ Blinds: ${Array.isArray(firstItem.blinds) ? `${firstItem.blinds.length} items` : 'NOT ARRAY'}`);
          }
        }
        
        if (activeTab === 'blinds' || activeTab === 'curtains' || activeTab === 'cushions') {
          console.log(`  ├─ Fabrics field exists: ${firstItem.hasOwnProperty('fabrics') ? 'YES' : 'NO'}`);
          console.log(`  ├─ Fabrics value:`, firstItem.fabrics);
          console.log(`  ├─ Fabrics is array: ${Array.isArray(firstItem.fabrics) ? 'YES' : 'NO'}`);
          
          if (Array.isArray(firstItem.fabrics) && firstItem.fabrics.length > 0) {
            console.log(`  ├─ ✅ FABRICS POPULATED! Count: ${firstItem.fabrics.length}`);
            firstItem.fabrics.forEach((fabric, idx) => {
              console.log(`  │  ├─ Fabric ${idx + 1}: ${fabric?.name || 'Unknown'} (${fabric?.availability || 'N/A'})`);
            });
          } else if (Array.isArray(firstItem.fabrics) && firstItem.fabrics.length === 0) {
            console.log(`  ├─ ⚠️  FABRICS ARRAY IS EMPTY - No fabrics assigned in database`);
          } else {
            console.log(`  ├─ ❌ FABRICS NOT POPULATED - Possible permission issue`);
            console.log(`  └─ 🔧 FIX: Check Strapi Settings → Users & Permissions → Roles → Public`);
            console.log(`     └─ Ensure '${activeTab}.find' has 'fabrics' field enabled`);
          }
          
          // Check linings
          if (firstItem.hasOwnProperty('linings')) {
            console.log(`  ├─ Linings: ${Array.isArray(firstItem.linings) ? `${firstItem.linings.length} items` : 'NOT ARRAY'}`);
          }
        }
        console.log(`\n`);
      } else {
        console.log(`⚠️  NO DATA returned for ${activeTab}`);
      }

      // Special handling for brands: manually attach fabrics if relation doesn't exist
      if (activeTab === 'brands' && data.data) {
        console.log('🔧 Brands: fabrics relation not available, manually fetching fabrics...');
        try {
          // Fetch all fabrics with their brands populated
          const fabricsResponse = await fetch('/api/fabrics?populate[0]=brand&publicationState=preview', {
            headers: getAuthHeaders(),
          });
          
          if (fabricsResponse.ok) {
            const fabricsData = await fabricsResponse.json();
            const fabrics = fabricsData.data || [];
            
            // Group fabrics by brand ID
            const fabricsByBrand = {};
            fabrics.forEach(fabric => {
              if (fabric.brand && fabric.brand.id) {
                const brandId = fabric.brand.id;
                if (!fabricsByBrand[brandId]) {
                  fabricsByBrand[brandId] = [];
                }
                // Add fabric without the brand relation to avoid circular reference
                const fabricWithoutBrand = { ...fabric };
                delete fabricWithoutBrand.brand;
                fabricsByBrand[brandId].push(fabricWithoutBrand);
              }
            });
            
            // Attach fabrics to each brand
            data.data.forEach(brand => {
              if (fabricsByBrand[brand.id]) {
                brand.fabrics = fabricsByBrand[brand.id];
                console.log(`✅ Attached ${fabricsByBrand[brand.id].length} fabrics to brand "${brand.name}":`, fabricsByBrand[brand.id].map(f => f.name).join(', '));
              } else {
                brand.fabrics = [];
              }
            });
            
            console.log('✅ Manually populated fabrics for all brands');
            
            // Re-run diagnostic after manual population
            if (data.data && data.data.length > 0) {
              const firstBrand = data.data[0];
              console.log(`\n🔍 POST-MANUAL-POPULATION DIAGNOSTIC FOR BRANDS:`);
              console.log(`  ├─ Brand name: ${firstBrand.name}`);
              console.log(`  ├─ Has fabrics field: ${firstBrand.hasOwnProperty('fabrics') ? 'YES' : 'NO'}`);
              console.log(`  ├─ Fabrics value:`, firstBrand.fabrics);
              console.log(`  ├─ Fabrics is array: ${Array.isArray(firstBrand.fabrics) ? 'YES' : 'NO'}`);
              if (Array.isArray(firstBrand.fabrics) && firstBrand.fabrics.length > 0) {
                console.log(`  ├─ ✅ FABRICS POPULATED! Count: ${firstBrand.fabrics.length}`);
                firstBrand.fabrics.forEach((fabric, idx) => {
                  console.log(`  │  ├─ Fabric ${idx + 1}: ${fabric?.name || 'Unknown'}`);
                });
              } else {
                console.log(`  ├─ ⚠️ FABRICS ARRAY IS EMPTY`);
              }
              console.log(`\n`);
            }
          }
        } catch (error) {
          console.error('❌ Error manually fetching fabrics for brands:', error);
        }
      }

      // For brands, ensure we create a new array reference to trigger React re-render
      if (activeTab === 'brands' && data.data) {
        const brandsWithFabrics = data.data.map(brand => ({ ...brand }));
        setProducts(prev => ({
          ...prev,
          [activeTab]: brandsWithFabrics
        }));
      } else {
        setProducts(prev => ({
          ...prev,
          [activeTab]: data.data || []
        }));
      }
    } catch (error) {
      console.error(`❌ Error fetching products for ${activeTab}:`, error);
      setProducts(prev => ({
        ...prev,
        [activeTab]: []
      }));
    } finally {
      setLoading(false);
    }
  };

  // Helper function to get field values for different product types
  const getProductFieldValue = (product, fieldKey) => {
    switch (activeTab) {
      case 'fabrics':
        return product[fieldKey];
      case 'blinds':
      case 'curtains':
      case 'cushions':
        // These only have 'name' field and relations
        return fieldKey === 'name' ? product[fieldKey] : null;
      case 'brands':
        return product[fieldKey];
      case 'linings':
        return product[fieldKey];
      case 'trimmings':
      case 'mechanisations':
        return product[fieldKey];
      default:
        return product[fieldKey];
    }
  };

  // Helper function to get relation count for display
  const getRelationCount = (product, relationKey) => {
    if (!product[relationKey]) return 0;
    if (Array.isArray(product[relationKey])) return product[relationKey].length;
    return product[relationKey] ? 1 : 0;
  };

  // Helper function to get product status based on related fabrics
  const getProductStatus = (product) => {
    switch (activeTab) {
      case 'blinds':
      case 'curtains':
      case 'cushions':
        // For these product types, status depends on related fabrics
        if (product.fabrics && product.fabrics.length > 0) {
          // Check if any fabric is available
          const hasAvailableFabric = product.fabrics.some(fabric => 
            fabric.availability === 'in_stock'
          );
          return hasAvailableFabric ? 'in_stock' : 'out_of_stock';
        }
        return 'out_of_stock'; // No fabrics = out of stock
      
      case 'fabrics':
        return product.availability || 'unknown';
      
      case 'brands':
      case 'linings':
      case 'trimmings':
      case 'mechanisations':
        // These don't have availability field, so show as available
        return 'available';
      
      default:
        return 'unknown';
    }
  };

  // Helper function to get status display text
  const getStatusDisplayText = (product) => {
    const status = getProductStatus(product);
    switch (status) {
      case 'in_stock':
        return 'IN STOCK';
      case 'out_of_stock':
        return 'OUT OF STOCK';
      case 'available':
        return 'AVAILABLE';
      case 'discontinued':
        return 'DISCONTINUED';
      default:
        return 'UNKNOWN';
    }
  };

  // Helper function to get main relation info for table display
  const getMainRelationInfo = (product) => {
    switch (activeTab) {
      case 'fabrics':
        // Display comprehensive fabric relations
        const fabricBrand = product.brand?.name ? `Brand: ${product.brand.name}` : 'No brand assigned';
        const fabricCurtains = product.curtains?.length > 0 ? `Curtains: ${product.curtains.length}` : '';
        const fabricBlinds = product.blinds?.length > 0 ? `Blinds: ${product.blinds.length}` : '';
        const fabricCushions = product.cushions?.length > 0 ? `Cushions: ${product.cushions.length}` : '';
        const fabricCare = product.care_instructions?.length > 0 ? `Care: ${product.care_instructions.length}` : '';
        
        const fabricRelations = [fabricBrand, fabricCurtains, fabricBlinds, fabricCushions, fabricCare].filter(Boolean);
        return fabricRelations.join(', ') || 'No relations assigned';
        
      case 'blinds':
        const blindFabricNames = product.fabrics?.map(f => f?.name).filter(Boolean) || [];
        const blindLiningCount = getRelationCount(product, 'linings');
        const blindTrimmingCount = getRelationCount(product, 'trimmings');
        const blindMechCount = getRelationCount(product, 'mechanisations');
        const blindType = product.blind_type?.name ? `Type: ${product.blind_type.name}` : '';
        const blindPricingCount = getRelationCount(product, 'pricing_rules');
        
        const blindFabricText = blindFabricNames.slice(0, 2).join(', ') + 
          (blindFabricNames.length > 2 ? ` and ${blindFabricNames.length - 2} more` : '');
        
        const blindRelations = [
          `Fabrics: ${blindFabricText || 'None'}`,
          `Linings: ${blindLiningCount}`,
          `Trimmings: ${blindTrimmingCount}`,
          `Mechanisations: ${blindMechCount}`,
          blindType,
          `Pricing: ${blindPricingCount}`
        ].filter(Boolean);
        
        return blindRelations.join(', ');
        
      case 'curtains':
        const curtainFabricNames = product.fabrics?.map(f => f?.name).filter(Boolean) || [];
        const curtainLiningCount = getRelationCount(product, 'linings');
        const curtainTrimmingCount = getRelationCount(product, 'trimmings');
        const curtainType = product.curtain_type?.name ? `Type: ${product.curtain_type.name}` : '';
        const curtainPricingCount = getRelationCount(product, 'pricing_rules');
        
        const curtainFabricText = curtainFabricNames.slice(0, 2).join(', ') + 
          (curtainFabricNames.length > 2 ? ` and ${curtainFabricNames.length - 2} more` : '');
        
        const curtainRelations = [
          `Fabrics: ${curtainFabricText || 'None'}`,
          `Linings: ${curtainLiningCount}`,
          `Trimmings: ${curtainTrimmingCount}`,
          curtainType,
          `Pricing: ${curtainPricingCount}`
        ].filter(Boolean);
        
        return curtainRelations.join(', ');
        
      case 'cushions':
        const cushionFabricNames = product.fabrics?.map(f => f?.name).filter(Boolean) || [];
        const cushionType = product.cushion_type?.name ? `Type: ${product.cushion_type.name}` : '';
        const cushionPricingCount = getRelationCount(product, 'pricing_rules');
        
        const cushionFabricText = cushionFabricNames.slice(0, 2).join(', ') + 
          (cushionFabricNames.length > 2 ? ` and ${cushionFabricNames.length - 2} more` : '');
        
        const cushionRelations = [
          `Fabrics: ${cushionFabricText || 'None'}`,
          cushionType,
          `Pricing: ${cushionPricingCount}`
        ].filter(Boolean);
        
        return cushionRelations.join(', ');
        
      case 'linings':
        const liningFabricNames = product.fabrics?.map(f => f?.name).filter(Boolean) || [];
        const liningFabricText = liningFabricNames.length > 0
          ? `Fabrics: ${liningFabricNames.slice(0, 3).join(', ')}${liningFabricNames.length > 3 ? ` and ${liningFabricNames.length - 3} more` : ''}`
          : '';
        return liningFabricText || 'No relations assigned';
        
      case 'trimmings':
        const trimmingFabricNames = product.fabrics?.map(f => f?.name).filter(Boolean) || [];
        const trimmingFabricText = trimmingFabricNames.length > 0
          ? `Fabrics: ${trimmingFabricNames.slice(0, 3).join(', ')}${trimmingFabricNames.length > 3 ? ` and ${trimmingFabricNames.length - 3} more` : ''}`
          : '';
        return trimmingFabricText || 'No relations assigned';
        
      case 'mechanisations':
        const mechBlindNames = product.blinds?.map(b => b?.name).filter(Boolean) || [];
        const mechBlindText = mechBlindNames.length > 0
          ? `Blinds: ${mechBlindNames.slice(0, 3).join(', ')}${mechBlindNames.length > 3 ? ` and ${mechBlindNames.length - 3} more` : ''}`
          : '';
        return mechBlindText || 'No relations assigned';
        
      case 'brands':
        // Debug: Log what we're getting
        if (!product.fabrics || !Array.isArray(product.fabrics)) {
          console.log(`⚠️ Brand "${product.name}" - fabrics field:`, product.fabrics, 'Type:', typeof product.fabrics);
        }
        const brandFabricNames = product.fabrics?.map(f => f?.name).filter(Boolean) || [];
        const brandFabricText = brandFabricNames.length > 0
          ? `Fabrics: ${brandFabricNames.slice(0, 3).join(', ')}${brandFabricNames.length > 3 ? ` and ${brandFabricNames.length - 3} more` : ''}`
          : '';
        return brandFabricText || 'No relations assigned';
        
      case 'pricing_rules':
        const pricingCurtainCount = getRelationCount(product, 'curtains');
        const pricingBlindCount = getRelationCount(product, 'blinds');
        const pricingCushionCount = getRelationCount(product, 'cushions');
        return `Curtains: ${pricingCurtainCount}, Blinds: ${pricingBlindCount}, Cushions: ${pricingCushionCount}`;
        
      case 'care_instructions':
        return `Fabrics: ${getRelationCount(product, 'fabrics')}`;
        
      default:
        return 'No relations';
    }
  };

  const filteredProducts = (products[activeTab] || []).filter(product => {
    const searchLower = searchTerm.toLowerCase();
    return product.name?.toLowerCase().includes(searchLower) ||
           product.description?.toLowerCase().includes(searchLower) ||
           product.productId?.toLowerCase().includes(searchLower) ||
           product.slug?.toLowerCase().includes(searchLower) ||
           product.liningType?.toLowerCase().includes(searchLower) ||
           product.type?.toLowerCase().includes(searchLower) ||
           product.colour?.toLowerCase().includes(searchLower);
  });

  const openCreateModal = () => {
    setEditingProduct(null);
    setFormData({});
    setErrors({});
    setIsModalOpen(true);
  };

  const openEditModal = (product) => {
    setEditingProduct(product);
    
    // Handle images - keep full image objects for display, but extract IDs for form data
    let imageObjects = [];
    let imageIds = [];
    
    if (product.images && Array.isArray(product.images)) {
      imageObjects = product.images.map(img => {
        if (typeof img === 'object' && img.id) {
          imageIds.push(img.id);
          return img; // Keep the full object for display
        }
        imageIds.push(img);
        return img;
      });
    }
    
    // Create form data with proper image handling
    const formData = {
      ...product,
      images: imageIds // Store IDs for form submission
    };
    
    console.log('📝 Setting form data with images:', imageIds, 'from product:', product);
    console.log('🖼️ Image objects for display:', imageObjects);
    setFormData(formData);
    setErrors({});
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingProduct(null);
    setFormData({});
    setErrors({});
  };

  const validateField = (field, value) => {
    const fieldConfig = productTypes[activeTab].fields.find(f => f.key === field);
    if (!fieldConfig) return '';

    // Required field validation
    if (fieldConfig.required && (!value || value.toString().trim() === '')) {
      return `${fieldConfig.label} is required`;
    }

    // Type-specific validation
    if (fieldConfig.type === 'number' && value) {
      if (isNaN(parseFloat(value))) {
        return `${fieldConfig.label} must be a valid number`;
      }
      if (parseFloat(value) < 0) {
        return `${fieldConfig.label} must be a positive number`;
      }
    }

    if (fieldConfig.type === 'email' && value) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(value)) {
        return `${fieldConfig.label} must be a valid email address`;
      }
    }

    // Specific field validations
    if (field === 'price_per_metre' && value && parseFloat(value) <= 0) {
      return 'Price per metre must be greater than 0';
    }

    if (field === 'availability' && value && !['in_stock', 'out_of_stock', 'discontinued'].includes(value)) {
      return 'Availability must be one of: in_stock, out_of_stock, discontinued';
    }

    if (field === 'productId' && value) {
      const productIdRegex = /^[A-Z0-9-]+$/;
      if (!productIdRegex.test(value)) {
        return 'Product ID must contain only uppercase letters, numbers, and hyphens';
      }
    }

    if (field === 'slug' && value) {
      const slugRegex = /^[a-z0-9-]+$/;
      if (!slugRegex.test(value)) {
        return 'Slug must contain only lowercase letters, numbers, and hyphens';
      }
    }

    return '';
  };

  const handleInputChange = (key, value) => {
    setFormData(prev => ({
      ...prev,
      [key]: value
    }));
    
    // Real-time validation
    const error = validateField(key, value);
    setErrors(prev => ({
      ...prev,
      [key]: error
    }));
  };

  const validateForm = () => {
    const newErrors = {};
    const currentType = productTypes[activeTab];
    
    currentType.fields.forEach(field => {
      if (field.required && (!formData[field.key] || formData[field.key] === '')) {
        newErrors[field.key] = `${field.label} is required`;
      }
    });
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const transformFormData = (data) => {
    const transformed = { ...data };
    
    // Convert number fields to proper types
    const numberFields = ['price_per_metre', 'patternRepeat_cm', 'usableWidth_cm', 'martindale', 'price'];
    numberFields.forEach(field => {
      if (transformed[field] !== undefined && transformed[field] !== '') {
        transformed[field] = parseFloat(transformed[field]);
      }
    });
    
    // Convert boolean fields
    if (transformed.is_featured !== undefined) {
      transformed.is_featured = Boolean(transformed.is_featured);
    }
    
    // Handle datetime fields
    if (transformed.featured_until && transformed.featured_until !== '') {
      transformed.featured_until = new Date(transformed.featured_until).toISOString();
    }
    
    // Handle images - ensure they are stored as IDs only
    if (transformed.images && Array.isArray(transformed.images)) {
      transformed.images = transformed.images.map(img => {
        // If it's an object, extract the ID
        if (typeof img === 'object' && img.id) {
          return img.id;
        }
        // If it's already a string/number, use it as is
        return img;
      });
    }
    
    // Handle thumbnail for brands
    if (transformed.thumbnail && typeof transformed.thumbnail === 'object' && transformed.thumbnail.id) {
      transformed.thumbnail = transformed.thumbnail.id;
    }
    
    // Remove relation fields from the data as they should be managed separately
    const relationFields = ['fabrics', 'linings', 'trimmings', 'mechanisations', 'blind_type', 'curtain_type', 'cushion_type', 'fabric_collections'];
    relationFields.forEach(field => {
      if (transformed[field] !== undefined) {
        delete transformed[field];
      }
    });
    
    // Remove empty strings and convert to null for optional fields
    Object.keys(transformed).forEach(key => {
      if (transformed[key] === '') {
        transformed[key] = null;
      }
    });
    
    return transformed;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!validateForm()) {
      return;
    }

    try {
      const url = editingProduct 
        ? `${productTypes[activeTab].apiPath}/${editingProduct.id}`
        : productTypes[activeTab].apiPath;
      
      const method = editingProduct ? 'PUT' : 'POST';
      
      // Transform the form data to match API expectations
      const transformedData = transformFormData(formData);
      
      const response = await fetch(url, {
        method,
        headers: getAuthHeaders(),
        body: JSON.stringify({
          data: transformedData
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error('API Error:', errorData);
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      await fetchProducts();
      closeModal();
      
      console.log(`✅ ${editingProduct ? 'Updated' : 'Created'} ${productTypes[activeTab].name.toLowerCase()} successfully!`);
    } catch (error) {
      console.error('Error saving product:', error);
      alert('Failed to save product. Please try again.');
    }
  };

  const handleDelete = async (productId) => {
    if (!confirm('Are you sure you want to delete this product?')) {
      return;
    }

    try {
      const response = await fetch(`${productTypes[activeTab].apiPath}/${productId}`, {
        method: 'DELETE',
        headers: getAuthHeaders()
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      await fetchProducts();
      console.log('✅ Product deleted successfully!');
    } catch (error) {
      console.error('Error deleting product:', error);
      alert('Failed to delete product. Please try again.');
    }
  };

  const handleBulkUpdate = async () => {
    if (selectedProducts.length === 0) {
      alert('Please select products to update.');
      return;
    }

    const updateField = prompt('Enter field to update (e.g., availability, is_featured):');
    if (!updateField) return;

    const updateValue = prompt(`Enter new value for ${updateField}:`);
    if (updateValue === null) return;

    if (!confirm(`Update ${updateField} to "${updateValue}" for ${selectedProducts.length} products?`)) {
      return;
    }

    try {
      const updatePromises = selectedProducts.map(productId => {
        const updateData = { [updateField]: updateValue };
        
        // Transform the data if needed
        const transformedData = transformFormData(updateData);
        
        return fetch(`${productTypes[activeTab].apiPath}/${productId}`, {
          method: 'PUT',
          headers: getAuthHeaders(),
          body: JSON.stringify({
            data: transformedData
          })
        });
      });

      const results = await Promise.allSettled(updatePromises);
      
      let successCount = 0;
      let failedCount = 0;
      
      results.forEach(result => {
        if (result.status === 'fulfilled' && result.value.ok) {
          successCount++;
        } else {
          failedCount++;
        }
      });

      alert(`Bulk update completed!\n✅ Success: ${successCount}\n❌ Failed: ${failedCount}`);
      
      setSelectedProducts([]);
      await fetchProducts();
      
    } catch (error) {
      console.error('Error during bulk update:', error);
      alert('Failed to update products. Please try again.');
    }
  };

  const handleBulkDelete = async () => {
    if (selectedProducts.length === 0) {
      alert('Please select products to delete.');
      return;
    }

    if (!confirm(`Are you sure you want to delete ${selectedProducts.length} selected products? This action cannot be undone.`)) {
      return;
    }

    try {
      const deletePromises = selectedProducts.map(productId => {
        return fetch(`${productTypes[activeTab].apiPath}/${productId}`, {
          method: 'DELETE',
          headers: getAuthHeaders()
        });
      });

      const results = await Promise.allSettled(deletePromises);
      
      let successCount = 0;
      let failedCount = 0;
      
      results.forEach(result => {
        if (result.status === 'fulfilled' && result.value.ok) {
          successCount++;
        } else {
          failedCount++;
        }
      });

      alert(`Bulk delete completed!\n✅ Success: ${successCount}\n❌ Failed: ${failedCount}`);
      
      setSelectedProducts([]);
      await fetchProducts();
      
    } catch (error) {
      console.error('Error bulk deleting products:', error);
      alert('Failed to bulk delete products. Please try again.');
    }
  };

  const toggleProductSelection = (productId) => {
    setSelectedProducts(prev => 
      prev.includes(productId) 
        ? prev.filter(id => id !== productId)
        : [...prev, productId]
    );
  };

  const selectAllProducts = () => {
    const allProductIds = filteredProducts.map(product => product.id);
    setSelectedProducts(allProductIds);
  };

  const formatPrice = (price) => {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: 'GBP'
    }).format(price);
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-GB', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  };

  const handleExportToExcel = async () => {
    try {
      setLoading(true);
      
      // Fetch ALL product types for export
      const allProductsData = {};
      
      // Define all product types to fetch
      const allProductTypes = ['fabrics', 'curtains', 'blinds', 'cushions', 'linings', 'trimmings', 'mechanisations', 'brands', 'pricing_rules', 'care_instructions'];
      
      console.log('📤 Fetching all product types for export...');
      
      // Fetch data for each product type
      for (const productType of allProductTypes) {
        try {
          const apiPath = productTypes[productType]?.apiPath;
          if (!apiPath) {
            console.log(`⚠️ No API path for ${productType}, skipping...`);
            allProductsData[productType] = [];
            continue;
          }
          
          // Use populate=* for all product types to ensure all relations are loaded
          // For fabrics, also explicitly populate brand to ensure it loads
          const populateParam = 'populate=*';
          let fullUrl = `${apiPath}?${populateParam}`;
          
          if (productType === 'fabrics') {
            // Add explicit brand population for fabrics (Strapi v4+ requires this)
            fullUrl = `${apiPath}?populate[0]=brand&populate[1]=images&populate[2]=curtains&populate[3]=blinds&populate[4]=cushions&populate[5]=care_instructions`;
          } else {
            fullUrl = `${apiPath}?${populateParam}`;
          }
          
          fullUrl += '&publicationState=preview';
          console.log(`🔍 Fetching ${productType} from ${fullUrl}`);
          
          let response = await fetch(fullUrl, {
            headers: getAuthHeaders(),
          });
          
          // If that fails, try without publicationState
          if (!response.ok) {
            const adminUrl = `${apiPath}?populate=*`;
            response = await fetch(adminUrl, {
              headers: getAuthHeaders(),
            });
          }
          
          if (response.ok) {
            const data = await response.json();
            allProductsData[productType] = data.data || [];
            console.log(`✅ Fetched ${allProductsData[productType].length} ${productType}`);
          } else {
            console.log(`❌ Failed to fetch ${productType}: ${response.status}`);
            allProductsData[productType] = [];
          }
        } catch (error) {
          console.error(`❌ Error fetching ${productType}:`, error);
          allProductsData[productType] = [];
        }
      }
      
      // Check if any products exist
      const totalProducts = Object.values(allProductsData).reduce((sum, productList) => sum + (productList?.length || 0), 0);
      if (totalProducts === 0) {
        alert('No products to export.');
        return;
      }
      
      console.log(`📊 Total products to export: ${totalProducts}`);
      console.log('📊 Products by type:', Object.entries(allProductsData).map(([type, data]) => `${type}: ${data.length}`).join(', '));
      
      const filename = `all-products-${new Date().toISOString().split('T')[0]}.xlsx`;
      excelHelper.exportToExcel(allProductsData, filename);
      
    } catch (error) {
      console.error('❌ Error during export:', error);
      alert('Failed to export products. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleExportToCSV = () => {
    // Check if any products exist
    const totalProducts = Object.values(products).reduce((sum, productList) => sum + (productList?.length || 0), 0);
    if (totalProducts === 0) {
      alert('No products to export.');
      return;
    }
    
    const filename = `all-products-${new Date().toISOString().split('T')[0]}.csv`;
    excelHelper.exportToCSV(products, filename);
  };

  const handleExportSelected = () => {
    if (selectedProducts.length === 0) {
      alert('Please select products to export.');
      return;
    }
    
    // Group selected products by type
    const selectedProductsByType = {};
    selectedProductsByType[activeTab] = selectedProducts;
    
    const filename = `selected-${activeTab}-${new Date().toISOString().split('T')[0]}.xlsx`;
    excelHelper.exportSelectedToExcel(selectedProductsByType, products, filename);
  };

  const handleExportSelectedToCSV = () => {
    if (selectedProducts.length === 0) {
      alert('Please select products to export.');
      return;
    }
    
    // Group selected products by type
    const selectedProductsByType = {};
    selectedProductsByType[activeTab] = selectedProducts;
    
    const filename = `selected-${activeTab}-${new Date().toISOString().split('T')[0]}.csv`;
    excelHelper.exportSelectedToCSV(selectedProductsByType, products, filename);
  };

  const handleDownloadTemplate = (comprehensive = false) => {
    excelHelper.createTemplate(productTypes[activeTab].name.toLowerCase(), comprehensive);
  };

  const handleImportFile = async (file) => {
    try {
      setImporting(true);
      
      // Check file type
      const fileName = file.name.toLowerCase();
      const isPDF = fileName.endsWith('.pdf') || file.type === 'application/pdf';
      const isExcel = fileName.endsWith('.xlsx') || fileName.endsWith('.xls') || 
                     file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
                     file.type === 'application/vnd.ms-excel';

      let data;
      if (isPDF) {
        // Parse PDF file (client-side)
        console.log('📄 Parsing PDF file...');
        data = await pdfHelper.parsePDF(file);
        console.log('📄 PDF parsed successfully:', data);
      } else if (isExcel) {
        // Parse Excel file
        console.log('📊 Parsing Excel file...');
        data = await excelHelper.importFromMultiSheetExcel(file);
        console.log('📊 Excel parsed successfully:', data);
      } else {
        throw new Error('Unsupported file type. Please upload a PDF or Excel file.');
      }

      setImportFile(file);
      setImportPreview(data);
      setImporting(false);
    } catch (error) {
      console.error('Error importing file:', error);
      setImporting(false);
      alert(`Failed to import file: ${error.message || 'Please check the file format.'}`);
    }
  };

  const handlePasteJSON = () => {
    try {
      setJsonError(null);
      setImporting(true);

      if (!jsonInput || jsonInput.trim() === '') {
        throw new Error('Please paste JSON data');
      }

      // Parse JSON string
      let data;
      try {
        data = JSON.parse(jsonInput.trim());
      } catch (parseError) {
        throw new Error(`Invalid JSON: ${parseError.message}`);
      }

      // Validate structure - should be an object (multi-sheet format) or array (single-sheet format)
      if (typeof data !== 'object' || data === null) {
        throw new Error('JSON must be an object or array');
      }

      // If it's an array, wrap it in an object with the current tab name
      if (Array.isArray(data)) {
        const wrapped = {};
        wrapped[activeTab] = data;
        data = wrapped;
      }

      // Validate that it has at least one valid sheet
      const validSheets = Object.keys(data).filter(key => Array.isArray(data[key]));
      if (validSheets.length === 0) {
        throw new Error('JSON must contain at least one array of items');
      }

      console.log('📋 JSON parsed successfully:', Object.keys(data).map(key => `${key}: ${data[key].length} items`).join(', '));

      setImportPreview(data);
      setImportFile(null); // Clear file since we're using JSON
      setImporting(false);
    } catch (error) {
      console.error('Error parsing JSON:', error);
      setJsonError(error.message);
      setImporting(false);
    }
  };

  // Fetch relation data directly from existing APIs
  const fetchRelationDataDirectly = async () => {
    const relationData = {};
    
    try {
      // Fetch fabrics
      const fabricsResponse = await fetch('/api/fabrics?populate=*', {
        headers: getAuthHeaders()
      });
      if (fabricsResponse.ok) {
        const fabricsData = await fabricsResponse.json();
        relationData.fabrics = {
          byName: {},
          byId: {}
        };
        fabricsData.data.forEach(fabric => {
          relationData.fabrics.byName[fabric.name] = { id: fabric.id, name: fabric.name };
          relationData.fabrics.byId[fabric.id] = { id: fabric.id, name: fabric.name };
        });
      }
      
      // Fetch brands
      const brandsResponse = await fetch('/api/brands?populate=*', {
        headers: getAuthHeaders()
      });
      if (brandsResponse.ok) {
        const brandsData = await brandsResponse.json();
        relationData.brands = {
          byName: {},
          byId: {}
        };
        brandsData.data.forEach(brand => {
          relationData.brands.byName[brand.name] = { id: brand.id, name: brand.name };
          relationData.brands.byId[brand.id] = { id: brand.id, name: brand.name };
        });
      }
      
      // Fetch linings
      const liningsResponse = await fetch('/api/linings?populate=*', {
        headers: getAuthHeaders()
      });
      if (liningsResponse.ok) {
        const liningsData = await liningsResponse.json();
        relationData.linings = {
          byType: {},
          byId: {}
        };
        liningsData.data.forEach(lining => {
          relationData.linings.byType[lining.liningType] = { id: lining.id, type: lining.liningType };
          relationData.linings.byId[lining.id] = { id: lining.id, type: lining.liningType };
        });
      }
      
      // Fetch trimmings
      const trimmingsResponse = await fetch('/api/trimmings?populate=*', {
        headers: getAuthHeaders()
      });
      if (trimmingsResponse.ok) {
        const trimmingsData = await trimmingsResponse.json();
        relationData.trimmings = {
          byType: {},
          byId: {}
        };
        trimmingsData.data.forEach(trimming => {
          relationData.trimmings.byType[trimming.type] = { id: trimming.id, type: trimming.type };
          relationData.trimmings.byId[trimming.id] = { id: trimming.id, type: trimming.type };
        });
      }
      
      // Fetch mechanisations
      const mechanisationsResponse = await fetch('/api/mechanisations?populate=*', {
        headers: getAuthHeaders()
      });
      if (mechanisationsResponse.ok) {
        const mechanisationsData = await mechanisationsResponse.json();
        relationData.mechanisations = {
          byType: {},
          byId: {}
        };
        mechanisationsData.data.forEach(mechanisation => {
          relationData.mechanisations.byType[mechanisation.type] = { id: mechanisation.id, type: mechanisation.type };
          relationData.mechanisations.byId[mechanisation.id] = { id: mechanisation.id, type: mechanisation.type };
        });
      }
      
      // Fetch curtain types
      const curtainTypesResponse = await fetch('/api/curtain-types?populate=*', {
        headers: getAuthHeaders()
      });
      if (curtainTypesResponse.ok) {
        const curtainTypesData = await curtainTypesResponse.json();
        relationData['curtain-types'] = {
          byName: {},
          byId: {}
        };
        curtainTypesData.data.forEach(curtainType => {
          relationData['curtain-types'].byName[curtainType.name] = { id: curtainType.id, name: curtainType.name };
          relationData['curtain-types'].byId[curtainType.id] = { id: curtainType.id, name: curtainType.name };
        });
      }
      
      // Fetch blind types
      const blindTypesResponse = await fetch('/api/blind-types?populate=*', {
        headers: getAuthHeaders()
      });
      if (blindTypesResponse.ok) {
        const blindTypesData = await blindTypesResponse.json();
        relationData['blind-types'] = {
          byName: {},
          byId: {}
        };
        blindTypesData.data.forEach(blindType => {
          relationData['blind-types'].byName[blindType.name] = { id: blindType.id, name: blindType.name };
          relationData['blind-types'].byId[blindType.id] = { id: blindType.id, name: blindType.name };
        });
      }
      
      // Fetch cushion types
      const cushionTypesResponse = await fetch('/api/cushion-types?populate=*', {
        headers: getAuthHeaders()
      });
      if (cushionTypesResponse.ok) {
        const cushionTypesData = await cushionTypesResponse.json();
        relationData['cushion-types'] = {
          byName: {},
          byId: {}
        };
        cushionTypesData.data.forEach(cushionType => {
          relationData['cushion-types'].byName[cushionType.name] = { id: cushionType.id, name: cushionType.name };
          relationData['cushion-types'].byId[cushionType.id] = { id: cushionType.id, name: cushionType.name };
        });
      }
      
      console.log('📊 Successfully fetched relation data:', Object.keys(relationData));
      return relationData;
      
    } catch (error) {
      console.error('❌ Error fetching relation data:', error);
      throw new Error(`Failed to fetch relation data: ${error.message}`);
    }
  };

  const handleBulkImport = async () => {
    if (!importPreview) return;
    
    setImporting(true);
    try {
      // Check if this is multi-sheet data (object) or single-sheet data (array)
      const isMultiSheet = typeof importPreview === 'object' && !Array.isArray(importPreview);
      
      if (isMultiSheet) {
        // Multi-sheet import - fetch relation data directly from existing APIs
        console.log('📊 Fetching relation data for validation...');
        
        // Fetch all relation data directly from existing APIs
        const relationData = await fetchRelationDataDirectly();
        console.log('📊 Relation data fetched:', Object.keys(relationData));
        
        // Validate with real data
        const validation = await excelHelper.validateImportDataMulti(importPreview, relationData);
        
        // Store validation results and show preview modal
        setImportValidation(validation);
        setImportPreviewModal(true);
      } else {
        // Single-sheet import (legacy)
        const validation = excelHelper.validateImportData(importPreview, activeTab);
        setImportValidation(validation);
        setImportPreviewModal(true);
      }
      
    } catch (error) {
      console.error('Error during import validation:', error);
      alert(`Failed to validate import: ${error.message}`);
    } finally {
      setImporting(false);
    }
  };

  const confirmImport = async () => {
    if (!importPreview || !importValidation) return;
    
    setImporting(true);
    try {
      // Check if this is multi-sheet data (object) or single-sheet data (array)
      const isMultiSheet = typeof importPreview === 'object' && !Array.isArray(importPreview);
      
      let results;
      
      if (isMultiSheet) {
        // Multi-sheet import - fetch relation data directly from existing APIs
        const relationData = await fetchRelationDataDirectly();
        
        // Transform with real data
        const transformedData = excelHelper.transformImportDataMulti(importPreview, relationData);
        results = await excelHelper.bulkImportMultiSheet(transformedData, getAuthHeaders);
      } else {
        // Single-sheet import (legacy)
        const transformedData = excelHelper.transformImportData(importPreview);
        results = await excelHelper.bulkImport(transformedData, productTypes[activeTab].apiPath, getAuthHeaders);
      }
      
      let errorDetails = '';
      if (results.errors && results.errors.length > 0) {
        console.log('Import errors:', results.errors);
        // Show first 5 errors in the alert
        const firstErrors = results.errors.slice(0, 5);
        errorDetails = '\n\nFirst errors:\n' + firstErrors.map(e => 
          `${e.sheet ? `${e.sheet} ` : ''}Row ${e.row}: ${e.error}`
        ).join('\n');
        if (results.errors.length > 5) {
          errorDetails += `\n... and ${results.errors.length - 5} more errors (see console for details)`;
        }
      }
      
      // Handle new result structure with created/updated/skipped/failed
      let resultMessage = 'Import completed!\n';
      if (results.created !== undefined) {
        resultMessage += `✅ Created: ${results.created}\n`;
        resultMessage += `🔄 Updated: ${results.updated}\n`;
        resultMessage += `⏭️ Skipped: ${results.skipped} (unchanged)\n`;
        resultMessage += `❌ Failed: ${results.failed}`;
      } else {
        // Fallback for old structure
        resultMessage += `✅ Success: ${results.success || 0}\n`;
        resultMessage += `❌ Failed: ${results.failed || 0}`;
      }
      
      alert(resultMessage + errorDetails);
      
      // Refresh products
      await fetchProducts();
      
      // Close modals
      setIsImportModalOpen(false);
      setImportPreviewModal(false);
      setImportFile(null);
      setImportPreview(null);
      setImportValidation(null);
      setImportMode('file');
      setJsonInput('');
      setJsonError(null);
      
    } catch (error) {
      console.error('Error during bulk import:', error);
      alert(`Failed to import products: ${error.message}`);
    } finally {
      setImporting(false);
    }
  };

  const closeImportModal = () => {
    setIsImportModalOpen(false);
    setImportFile(null);
    setImportPreview(null);
    setImportMode('file');
    setJsonInput('');
    setJsonError(null);
  };

  return (
    <>
      <style>{spinnerStyle}</style>
      <div style={{
      padding: '32px',
      background: '#ffffff',
      minHeight: '100vh',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    }}>
      {/* Header */}
      <div style={{
        background: '#ffffff',
        borderRadius: '16px',
        padding: '32px',
        marginBottom: '32px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
        border: '1px solid #f1f5f9'
      }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '24px'
        }}>
          <div>
            <h1 style={{
              fontSize: '32px',
              fontWeight: '800',
              color: '#059669',
              margin: '0 0 8px 0',
              letterSpacing: '-0.5px',
              display: 'flex',
              alignItems: 'center',
              gap: '12px'
            }}>
              <PackageSearch size={32} />
              Product Management
            </h1>
            <p style={{
              fontSize: '16px',
              color: '#6b7280',
              margin: '0',
              fontWeight: '500'
            }}>
              Manage all your products, fabrics, and accessories
            </p>
          </div>
          
          {/* Quick Workflow Guide */}
          <div style={{
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: '12px',
            padding: '20px',
            marginTop: '16px',
            gridColumn: '1 / -1'
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              marginBottom: '12px'
            }}>
              <FileSpreadsheet size={20} style={{ color: '#3b82f6' }} />
              <h3 style={{
                margin: 0,
                fontSize: '16px',
                fontWeight: '600',
                color: '#1e293b'
              }}>
                Bulk Import/Export Workflow
              </h3>
            </div>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: '16px',
              fontSize: '14px',
              color: '#475569'
            }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}>
                <div style={{
                  background: '#3b82f6',
                  color: 'white',
                  borderRadius: '50%',
                  width: '24px',
                  height: '24px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '12px',
                  fontWeight: '600'
                }}>1</div>
                <span><strong>Download Template</strong> - Get Excel/CSV format</span>
              </div>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}>
                <div style={{
                  background: '#3b82f6',
                  color: 'white',
                  borderRadius: '50%',
                  width: '24px',
                  height: '24px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '12px',
                  fontWeight: '600'
                }}>2</div>
                <span><strong>Fill Data</strong> - Add products & relations</span>
              </div>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}>
                <div style={{
                  background: '#3b82f6',
                  color: 'white',
                  borderRadius: '50%',
                  width: '24px',
                  height: '24px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '12px',
                  fontWeight: '600'
                }}>3</div>
                <span><strong>Upload & Import</strong> - Bulk add to database</span>
              </div>
            </div>
            <div style={{
              background: '#dbeafe',
              border: '1px solid #93c5fd',
              borderRadius: '8px',
              padding: '12px',
              marginTop: '12px',
              fontSize: '13px',
              color: '#1e40af'
            }}>
              <strong>💡 Pro Tip:</strong> Export existing products first to see the exact format, then modify and re-import for bulk updates!
            </div>
          </div>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <button
              onClick={openCreateModal}
              style={{
                background: '#059669',
                color: 'white',
                border: 'none',
                borderRadius: '12px',
                padding: '12px 24px',
                fontSize: '14px',
                fontWeight: '600',
                cursor: 'pointer',
                transition: 'all 0.3s ease',
                boxShadow: '0 4px 15px rgba(5, 150, 105, 0.4)',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}
            >
              <Plus size={16} />
              Add New Product
            </button>
            
            <button
              onClick={handleExportToExcel}
              style={{
                background: '#000000',
                color: 'white',
                border: 'none',
                borderRadius: '12px',
                padding: '12px 24px',
                fontSize: '14px',
                fontWeight: '600',
                cursor: 'pointer',
                transition: 'all 0.3s ease',
                boxShadow: '0 4px 15px rgba(0, 0, 0, 0.4)',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}
            >
              <Download size={16} />
              Export to Excel
            </button>
            
            <button
              onClick={handleExportToCSV}
              style={{
                background: '#059669',
                color: 'white',
                border: 'none',
                borderRadius: '12px',
                padding: '12px 24px',
                fontSize: '14px',
                fontWeight: '600',
                cursor: 'pointer',
                transition: 'all 0.3s ease',
                boxShadow: '0 4px 15px rgba(5, 150, 105, 0.4)',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}
            >
              <Download size={16} />
              Export to CSV
            </button>
            
            {selectedProducts.length > 0 && (
              <>
                <button
                  onClick={handleExportSelected}
                  style={{
                    background: '#7c3aed',
                    color: 'white',
                    border: 'none',
                    borderRadius: '12px',
                    padding: '12px 24px',
                    fontSize: '14px',
                    fontWeight: '600',
                    cursor: 'pointer',
                    transition: 'all 0.3s ease',
                    boxShadow: '0 4px 15px rgba(124, 58, 237, 0.4)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                  }}
                >
                  <Download size={16} />
                  Export Selected ({selectedProducts.length})
                </button>
                
                <button
                  onClick={handleExportSelectedToCSV}
                  style={{
                    background: '#dc2626',
                    color: 'white',
                    border: 'none',
                    borderRadius: '12px',
                    padding: '12px 24px',
                    fontSize: '14px',
                    fontWeight: '600',
                    cursor: 'pointer',
                    transition: 'all 0.3s ease',
                    boxShadow: '0 4px 15px rgba(220, 38, 38, 0.4)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                  }}
                >
                  <Download size={16} />
                  Export Selected CSV ({selectedProducts.length})
                </button>
              </>
            )}
            
            <button
              onClick={() => setIsImportModalOpen(true)}
              style={{
                background: '#059669',
                color: 'white',
                border: 'none',
                borderRadius: '12px',
                padding: '12px 24px',
                fontSize: '14px',
                fontWeight: '600',
                cursor: 'pointer',
                transition: 'all 0.3s ease',
                boxShadow: '0 4px 15px rgba(5, 150, 105, 0.4)',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}
            >
              <Upload size={16} />
              Import Products
            </button>
            
            <div style={{ position: 'relative', display: 'inline-block' }} data-template-dropdown>
              <button
                onClick={() => setShowTemplateDropdown(!showTemplateDropdown)}
                style={{
                  background: '#000000',
                  color: 'white',
                  border: 'none',
                  borderRadius: '12px',
                  padding: '12px 24px',
                  fontSize: '14px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  transition: 'all 0.3s ease',
                  boxShadow: '0 4px 15px rgba(0, 0, 0, 0.4)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}
              >
                <FileText size={16} />
                Download Template
                <span style={{ fontSize: '12px', marginLeft: '4px' }}>▼</span>
              </button>
              
              {showTemplateDropdown && (
                <div style={{
                  position: 'absolute',
                  top: '100%',
                  left: '0',
                  background: 'white',
                  border: '1px solid #e5e7eb',
                  borderRadius: '8px',
                  boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
                  zIndex: 1000,
                  minWidth: '200px',
                  marginTop: '4px'
                }}>
                  <button
                    onClick={() => {
                      handleDownloadTemplate(false);
                      setShowTemplateDropdown(false);
                    }}
                    style={{
                      width: '100%',
                      padding: '12px 16px',
                      border: 'none',
                      background: 'transparent',
                      textAlign: 'left',
                      cursor: 'pointer',
                      fontSize: '14px',
                      color: '#374151',
                      borderBottom: '1px solid #f3f4f6'
                    }}
                    onMouseEnter={(e) => e.target.style.background = '#f9fafb'}
                    onMouseLeave={(e) => e.target.style.background = 'transparent'}
                  >
                    Current Tab Only ({productTypes[activeTab].name})
                  </button>
                  <button
                    onClick={() => {
                      handleDownloadTemplate(true);
                      setShowTemplateDropdown(false);
                    }}
                    style={{
                      width: '100%',
                      padding: '12px 16px',
                      border: 'none',
                      background: 'transparent',
                      textAlign: 'left',
                      cursor: 'pointer',
                      fontSize: '14px',
                      color: '#374151'
                    }}
                    onMouseEnter={(e) => e.target.style.background = '#f9fafb'}
                    onMouseLeave={(e) => e.target.style.background = 'transparent'}
                  >
                    Comprehensive (All Sheets)
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Product Type Tabs */}
        <div style={{
          display: 'flex',
          gap: '8px',
          marginBottom: '24px',
          flexWrap: 'wrap'
        }}>
          {Object.entries(productTypes).map(([key, type]) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              style={{
                background: activeTab === key 
                  ? '#059669' 
                  : '#ffffff',
                color: activeTab === key ? 'white' : '#000000',
                border: activeTab === key ? 'none' : '2px solid #059669',
                borderRadius: '12px',
                padding: '12px 20px',
                fontSize: '14px',
                fontWeight: '600',
                cursor: 'pointer',
                transition: 'all 0.3s ease',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                boxShadow: activeTab === key ? '0 4px 15px rgba(5, 150, 105, 0.4)' : 'none'
              }}
            >
              <span style={{ fontSize: '16px' }}>{type.icon}</span>
              {type.name}
            </button>
          ))}
        </div>

        {/* Search and Actions */}
        <div style={{
          display: 'flex',
          gap: '16px',
          alignItems: 'center',
          flexWrap: 'wrap'
        }}>
          <div style={{ flex: 1, minWidth: '300px' }}>
            <input
              type="text"
              placeholder={`Search ${productTypes[activeTab].name.toLowerCase()}...`}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{
                width: '100%',
                padding: '12px 16px',
                border: '2px solid #e5e7eb',
                borderRadius: '12px',
                fontSize: '14px',
                transition: 'all 0.3s ease',
                background: 'white',
                outline: 'none'
              }}
            />
          </div>
          
          {selectedProducts.length > 0 && (
            <div style={{ display: 'flex', gap: '12px' }}>
              <button
                onClick={handleBulkUpdate}
                style={{
                  background: '#059669',
                  color: 'white',
                  border: 'none',
                  borderRadius: '12px',
                  padding: '12px 20px',
                  fontSize: '14px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  transition: 'all 0.3s ease',
                  boxShadow: '0 4px 15px rgba(5, 150, 105, 0.4)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}
              >
                <Edit size={16} />
                Update Selected ({selectedProducts.length})
              </button>
              
              <button
                onClick={handleBulkDelete}
                style={{
                  background: '#000000',
                  color: 'white',
                  border: 'none',
                  borderRadius: '12px',
                  padding: '12px 20px',
                  fontSize: '14px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  transition: 'all 0.3s ease',
                  boxShadow: '0 4px 15px rgba(0, 0, 0, 0.4)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}
              >
                <Trash2 size={16} />
                Delete Selected ({selectedProducts.length})
              </button>
            </div>
          )}
          
          <button
            onClick={selectAllProducts}
            style={{
              background: '#059669',
              color: 'white',
              border: 'none',
              borderRadius: '12px',
              padding: '12px 20px',
              fontSize: '14px',
              fontWeight: '600',
              cursor: 'pointer',
              transition: 'all 0.3s ease',
              boxShadow: '0 4px 15px rgba(5, 150, 105, 0.4)',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}
          >
            <CheckSquare size={16} />
            Select All
          </button>
        </div>
      </div>

      {/* Products Table */}
      <div style={{
        background: '#ffffff',
        borderRadius: '16px',
        padding: '0',
        boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
        border: '1px solid #f1f5f9',
        overflow: 'hidden'
      }}>
        {loading ? (
          <div style={{
            padding: '60px',
            textAlign: 'center',
            color: '#6b7280'
          }}>
            <div style={{
              fontSize: '48px',
              marginBottom: '16px',
              display: 'flex',
              justifyContent: 'center'
            }}>
              <Loader2 size={48} className="animate-spin" />
            </div>
            <div style={{
              fontSize: '18px',
              fontWeight: '600'
            }}>Loading products...</div>
          </div>
        ) : filteredProducts.length === 0 ? (
          <div style={{
            padding: '60px',
            textAlign: 'center',
            color: '#6b7280'
          }}>
            <div style={{
              fontSize: '48px',
              marginBottom: '16px',
              display: 'flex',
              justifyContent: 'center'
            }}>
              <PackageX size={48} />
            </div>
            <div style={{
              fontSize: '18px',
              fontWeight: '600',
              color: '#374151'
            }}>No products found</div>
          </div>
        ) : (
          <div style={{ overflow: 'auto' }}>
            <table style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: '14px'
            }}>
              <thead>
                <tr style={{
                  background: '#f8fafc',
                  borderBottom: '1px solid #e2e8f0'
                }}>
                  <th style={{
                    padding: '20px 16px',
                    textAlign: 'left',
                    fontWeight: '700',
                    color: '#374151',
                    fontSize: '12px',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    width: '50px'
                  }}>
                    <input
                      type="checkbox"
                      checked={selectedProducts.length === filteredProducts.length && filteredProducts.length > 0}
                      onChange={(e) => {
                        if (e.target.checked) {
                          selectAllProducts();
                        } else {
                          setSelectedProducts([]);
                        }
                      }}
                      style={{
                        width: '16px',
                        height: '16px',
                        cursor: 'pointer'
                      }}
                    />
                  </th>
                  <th style={{
                    padding: '20px 16px',
                    textAlign: 'left',
                    fontWeight: '700',
                    color: '#374151',
                    fontSize: '12px',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px'
                  }}>Name</th>
                  <th style={{
                    padding: '20px 16px',
                    textAlign: 'left',
                    fontWeight: '700',
                    color: '#374151',
                    fontSize: '12px',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px'
                  }}>ID/Slug</th>
                  <th style={{
                    padding: '20px 16px',
                    textAlign: 'left',
                    fontWeight: '700',
                    color: '#374151',
                    fontSize: '12px',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px'
                  }}>Price</th>
                  <th style={{
                    padding: '20px 16px',
                    textAlign: 'left',
                    fontWeight: '700',
                    color: '#374151',
                    fontSize: '12px',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px'
                  }}>Status</th>
                  <th style={{
                    padding: '20px 16px',
                    textAlign: 'left',
                    fontWeight: '700',
                    color: '#374151',
                    fontSize: '12px',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px'
                  }}>Relations</th>
                  {(activeTab === 'curtains' || activeTab === 'blinds' || activeTab === 'cushions') && (
                    <th style={{
                      padding: '20px 16px',
                      textAlign: 'left',
                      fontWeight: '700',
                      color: '#374151',
                      fontSize: '12px',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px'
                    }}>Pricing Rules</th>
                  )}
                  <th style={{
                    padding: '20px 16px',
                    textAlign: 'left',
                    fontWeight: '700',
                    color: '#374151',
                    fontSize: '12px',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px'
                  }}>Created</th>
                  <th style={{
                    padding: '20px 16px',
                    textAlign: 'center',
                    fontWeight: '700',
                    color: '#374151',
                    fontSize: '12px',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px'
                  }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredProducts.map((product, index) => (
                  <tr
                    key={product.id}
                    style={{
                      borderBottom: '1px solid #f1f5f9',
                      transition: 'all 0.2s ease',
                      background: index % 2 === 0 ? 'rgba(255, 255, 255, 0.5)' : 'rgba(248, 250, 252, 0.5)'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'rgba(5, 150, 105, 0.05)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = index % 2 === 0 ? 'rgba(255, 255, 255, 0.5)' : 'rgba(248, 250, 252, 0.5)';
                    }}
                  >
                    <td style={{ padding: '20px 16px' }}>
                      <input
                        type="checkbox"
                        checked={selectedProducts.includes(product.id)}
                        onChange={() => toggleProductSelection(product.id)}
                        style={{
                          width: '16px',
                          height: '16px',
                          cursor: 'pointer'
                        }}
                      />
                    </td>
                    <td style={{
                      padding: '20px 16px',
                      fontWeight: '600',
                      color: '#1f2937'
                    }}>
                      {product.name}
                    </td>
                    <td style={{
                      padding: '20px 16px',
                      color: '#6b7280',
                      fontFamily: 'monospace',
                      fontSize: '13px'
                    }}>
                      {getProductFieldValue(product, 'productId') || getProductFieldValue(product, 'slug') || 
                       getProductFieldValue(product, 'liningType') || getProductFieldValue(product, 'type') || 
                       getProductFieldValue(product, 'product_type') || 'N/A'}
                    </td>
                    <td style={{
                      padding: '20px 16px',
                      fontWeight: '700',
                      color: '#059669',
                      fontSize: '16px'
                    }}>
                      {getProductFieldValue(product, 'price_per_metre') ? formatPrice(getProductFieldValue(product, 'price_per_metre')) : 
                       getProductFieldValue(product, 'price') ? formatPrice(getProductFieldValue(product, 'price')) : 
                       getProductFieldValue(product, 'formula') ? 'Formula Set' : 'N/A'}
                    </td>
                    <td style={{ padding: '20px 16px' }}>
                      <span style={{
                        display: 'inline-block',
                        padding: '6px 12px',
                        borderRadius: '20px',
                        fontSize: '12px',
                        fontWeight: '600',
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px',
                        background: getProductStatus(product) === 'in_stock' ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)' :
                                   getProductStatus(product) === 'out_of_stock' ? 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)' :
                                   getProductStatus(product) === 'available' ? 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)' :
                                   'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
                        color: 'white',
                        boxShadow: '0 2px 8px rgba(0,0,0,0.15)'
                      }}>
                        {getStatusDisplayText(product)}
                      </span>
                    </td>
                    <td style={{
                      padding: '20px 16px',
                      color: '#6b7280',
                      fontSize: '12px',
                      maxWidth: '200px'
                    }}>
                      <div style={{
                        background: '#f8fafc',
                        padding: '8px 12px',
                        borderRadius: '8px',
                        border: '1px solid #e2e8f0',
                        fontSize: '11px',
                        lineHeight: '1.4'
                      }}>
                        {getMainRelationInfo(product)}
                      </div>
                    </td>
                    {(activeTab === 'curtains' || activeTab === 'blinds' || activeTab === 'cushions') && (
                      <td style={{
                        padding: '20px 16px',
                        color: '#6b7280',
                        fontSize: '12px',
                        maxWidth: '200px'
                      }}>
                        <div style={{
                          background: '#f0f9ff',
                          padding: '8px 12px',
                          borderRadius: '8px',
                          border: '1px solid #bae6fd',
                          fontSize: '11px',
                          lineHeight: '1.4'
                        }}>
                          {product.pricing_rules && product.pricing_rules.length > 0 
                            ? product.pricing_rules.map(rule => rule.name).join(', ')
                            : 'No pricing rules'
                          }
                        </div>
                      </td>
                    )}
                    <td style={{
                      padding: '20px 16px',
                      color: '#6b7280',
                      fontSize: '13px'
                    }}>
                      {formatDate(product.createdAt)}
                    </td>
                    <td style={{
                      padding: '20px 16px',
                      textAlign: 'center'
                    }}>
                      <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                        <button
                          onClick={() => openEditModal(product)}
                          style={{
                            background: '#059669',
                            color: 'white',
                            border: 'none',
                            borderRadius: '8px',
                            padding: '8px 12px',
                            fontSize: '12px',
                            fontWeight: '600',
                            cursor: 'pointer',
                            transition: 'all 0.3s ease',
                            boxShadow: '0 2px 8px rgba(5, 150, 105, 0.3)',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px'
                          }}
                        >
                          <Edit size={12} />
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(product.id)}
                          style={{
                            background: '#000000',
                            color: 'white',
                            border: 'none',
                            borderRadius: '8px',
                            padding: '8px 12px',
                            fontSize: '12px',
                            fontWeight: '600',
                            cursor: 'pointer',
                            transition: 'all 0.3s ease',
                            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px'
                          }}
                        >
                          <Trash2 size={12} />
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Product Form Modal */}
      {isModalOpen && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.8)',
          backdropFilter: 'blur(8px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: '20px'
        }}>
          <div style={{
            background: 'white',
            borderRadius: '24px',
            padding: '0',
            maxWidth: '800px',
            width: '95%',
            maxHeight: '90%',
            overflow: 'hidden',
            boxShadow: '0 25px 50px rgba(0,0,0,0.25)',
            border: '1px solid rgba(255, 255, 255, 0.2)'
          }}>
            {/* Header */}
            <div style={{
              background: '#1f2937',
              padding: '32px',
              color: 'white',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              borderBottom: '1px solid #374151'
            }}>
              <div>
                <h2 style={{
                  fontSize: '28px',
                  fontWeight: '800',
                  margin: '0 0 8px 0',
                  letterSpacing: '-0.5px'
                }}>
                  {editingProduct ? 'Edit' : 'Add New'} {productTypes[activeTab].name}
                </h2>
                <p style={{
                  fontSize: '16px',
                  margin: '0',
                  opacity: '0.9'
                }}>
                  {editingProduct ? 'Update product information' : 'Fill in the product details'}
                </p>
              </div>
              <button
                onClick={closeModal}
                style={{
                  background: 'rgba(255, 255, 255, 0.2)',
                  border: 'none',
                  borderRadius: '12px',
                  padding: '12px',
                  color: 'white',
                  cursor: 'pointer',
                  transition: 'all 0.3s ease',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                <X size={20} />
              </button>
            </div>

            {/* Form */}
            <div style={{ padding: '32px', maxHeight: '70vh', overflow: 'auto' }}>
              <form onSubmit={handleSubmit}>
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
                  gap: '24px',
                  marginBottom: '32px'
                }}>
                  {productTypes[activeTab].fields.map(field => (
                    <div key={field.key}>
                      <label style={{
                        display: 'block',
                        marginBottom: '8px',
                        fontSize: '14px',
                        fontWeight: '600',
                        color: '#374151'
                      }}>
                        {field.label}
                        {field.required && <span style={{ color: '#ef4444', marginLeft: '4px' }}>*</span>}
                      </label>
                      
                      {field.type === 'textarea' ? (
                        <textarea
                          value={formData[field.key] || ''}
                          onChange={(e) => handleInputChange(field.key, e.target.value)}
                          style={{
                            width: '100%',
                            padding: '12px 16px',
                            border: `2px solid ${errors[field.key] ? '#ef4444' : '#e5e7eb'}`,
                            borderRadius: '12px',
                            fontSize: '14px',
                            transition: 'all 0.3s ease',
                            background: 'white',
                            outline: 'none',
                            minHeight: '100px',
                            resize: 'vertical'
                          }}
                          placeholder={`Enter ${field.label.toLowerCase()}...`}
                        />
                      ) : field.type === 'select' ? (
                        <select
                          value={formData[field.key] || ''}
                          onChange={(e) => handleInputChange(field.key, e.target.value)}
                          style={{
                            width: '100%',
                            padding: '12px 16px',
                            border: `2px solid ${errors[field.key] ? '#ef4444' : '#e5e7eb'}`,
                            borderRadius: '12px',
                            fontSize: '14px',
                            background: 'white',
                            cursor: 'pointer',
                            transition: 'all 0.3s ease',
                            outline: 'none'
                          }}
                        >
                          <option value="">Select {field.label}</option>
                          {field.options?.map(option => (
                            <option key={option} value={option}>
                              {option.replace('_', ' ').toUpperCase()}
                            </option>
                          ))}
                        </select>
                      ) : field.type === 'checkbox' ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <input
                            type="checkbox"
                            checked={formData[field.key] || false}
                            onChange={(e) => handleInputChange(field.key, e.target.checked)}
                            style={{
                              width: '20px',
                              height: '20px',
                              cursor: 'pointer'
                            }}
                          />
                          <span style={{ fontSize: '14px', color: '#374151' }}>
                            {field.label}
                          </span>
                        </div>
                      ) : field.type === 'relation' ? (
                        <div style={{
                          background: '#f8fafc',
                          padding: '12px',
                          borderRadius: '8px',
                          border: '1px solid #e2e8f0'
                        }}>
                          <div style={{
                            fontSize: '12px',
                            color: '#6b7280',
                            marginBottom: '8px'
                          }}>
                            Relations to {field.target} will be managed through the main Strapi interface.
                          </div>
                          <div style={{
                            fontSize: '11px',
                            color: '#9ca3af'
                          }}>
                            Current: {getRelationCount(editingProduct || {}, field.key)} {field.target}
                          </div>
                        </div>
                      ) : (
                        <input
                          type={field.type}
                          value={formData[field.key] || ''}
                          onChange={(e) => handleInputChange(field.key, e.target.value)}
                          style={{
                            width: '100%',
                            padding: '12px 16px',
                            border: `2px solid ${errors[field.key] ? '#ef4444' : '#e5e7eb'}`,
                            borderRadius: '12px',
                            fontSize: '14px',
                            transition: 'all 0.3s ease',
                            background: 'white',
                            outline: 'none'
                          }}
                          placeholder={`Enter ${field.label.toLowerCase()}...`}
                        />
                      )}
                      
                      {errors[field.key] && (
                        <p style={{
                          color: '#ef4444',
                          fontSize: '12px',
                          marginTop: '4px',
                          marginBottom: '0'
                        }}>
                          {errors[field.key]}
                        </p>
                      )}
                    </div>
                  ))}

                  {/* Image Uploader for fabrics */}
                  {activeTab === 'fabrics' && (
                    <div style={{ gridColumn: '1 / -1' }}>
                      {console.log('🖼️ Rendering ImageUploader with images:', editingProduct?.images)}
                      <ImageUploader
                        images={editingProduct?.images || []}
                        onImagesChange={(imageObjects) => {
                          // Extract IDs from image objects for form submission
                          const imageIds = imageObjects.map(img => {
                            if (typeof img === 'object' && img.id) {
                              return img.id;
                            }
                            return img;
                          });
                          handleInputChange('images', imageIds);
                        }}
                        maxImages={10}
                      />
                    </div>
                  )}
                </div>

                {/* Form Actions */}
                <div style={{
                  display: 'flex',
                  gap: '16px',
                  justifyContent: 'flex-end',
                  paddingTop: '24px',
                  borderTop: '1px solid #e5e7eb'
                }}>
                  <button
                    type="button"
                    onClick={closeModal}
                    style={{
                      background: '#6b7280',
                      color: 'white',
                      border: 'none',
                      borderRadius: '12px',
                      padding: '12px 24px',
                      fontSize: '14px',
                      fontWeight: '600',
                      cursor: 'pointer',
                      transition: 'all 0.3s ease'
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    style={{
                      background: '#059669',
                      color: 'white',
                      border: 'none',
                      borderRadius: '12px',
                      padding: '12px 24px',
                      fontSize: '14px',
                      fontWeight: '600',
                      cursor: 'pointer',
                      transition: 'all 0.3s ease',
                      boxShadow: '0 4px 15px rgba(5, 150, 105, 0.4)'
                    }}
                  >
                    {editingProduct ? 'Update Product' : 'Create Product'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Import Modal */}
      {isImportModalOpen && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000
        }}>
          <div style={{
            background: 'white',
            borderRadius: '20px',
            padding: '32px',
            maxWidth: '800px',
            width: '90%',
            maxHeight: '90vh',
            overflow: 'auto',
            boxShadow: '0 25px 50px rgba(0, 0, 0, 0.25)'
          }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '24px'
            }}>
              <h3 style={{
                fontSize: '24px',
                fontWeight: '800',
                color: '#1f2937',
                margin: 0,
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}>
                <Upload size={24} />
                Import Products
              </h3>
                <button
                  onClick={closeImportModal}
                  style={{
                    background: 'none',
                    border: 'none',
                    fontSize: '24px',
                    cursor: 'pointer',
                    color: '#6b7280',
                    padding: '4px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  <X size={24} />
                </button>
            </div>

            {/* Import Mode Tabs */}
            <div style={{
              display: 'flex',
              gap: '0',
              marginBottom: '24px',
              borderBottom: '2px solid #e5e7eb',
              background: '#f9fafb',
              borderRadius: '8px 8px 0 0',
              padding: '4px'
            }}>
              <button
                onClick={() => {
                  setImportMode('file');
                  setJsonInput('');
                  setJsonError(null);
                  setImportPreview(null);
                }}
                style={{
                  background: importMode === 'file' ? 'white' : 'transparent',
                  border: 'none',
                  borderRadius: '6px',
                  padding: '12px 24px',
                  fontSize: '14px',
                  fontWeight: '600',
                  color: importMode === 'file' ? '#8b5cf6' : '#6b7280',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  boxShadow: importMode === 'file' ? '0 2px 4px rgba(0,0,0,0.1)' : 'none',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}
              >
                <Upload size={16} />
                Upload File
              </button>
              <button
                onClick={() => {
                  setImportMode('json');
                  setImportFile(null);
                  setImportPreview(null);
                }}
                style={{
                  background: importMode === 'json' ? 'white' : 'transparent',
                  border: 'none',
                  borderRadius: '6px',
                  padding: '12px 24px',
                  fontSize: '14px',
                  fontWeight: '600',
                  color: importMode === 'json' ? '#8b5cf6' : '#6b7280',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  boxShadow: importMode === 'json' ? '0 2px 4px rgba(0,0,0,0.1)' : 'none',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}
              >
                <FileText size={16} />
                Paste JSON
              </button>
            </div>

            {/* Import Instructions */}
            <div style={{
              background: '#f0f9ff',
              border: '1px solid #0ea5e9',
              borderRadius: '8px',
              padding: '16px',
              marginBottom: '16px'
            }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                marginBottom: '12px'
              }}>
                <Lightbulb size={16} style={{ color: '#0ea5e9' }} />
                <h4 style={{
                  margin: 0,
                  fontSize: '14px',
                  fontWeight: '600',
                  color: '#0c4a6e'
                }}>
                  {importMode === 'file' ? 'How to Import Products' : 'How to Paste JSON'}
                </h4>
              </div>
              <div style={{ fontSize: '13px', color: '#0c4a6e', lineHeight: '1.5' }}>
                {importMode === 'file' ? (
                  <>
                    <div style={{ marginBottom: '8px' }}>
                      <strong>Step 1:</strong> Download a template using the "Download Template" button above
                    </div>
                    <div style={{ marginBottom: '8px' }}>
                      <strong>Step 2:</strong> Fill the template with your product data (brand names, fabric names, etc.)
                    </div>
                    <div style={{ marginBottom: '8px' }}>
                      <strong>Step 3:</strong> Upload your filled template here
                    </div>
                    <div style={{ 
                      background: '#dbeafe', 
                      padding: '8px', 
                      borderRadius: '4px',
                      fontSize: '12px',
                      marginTop: '8px'
                    }}>
                      💡 <strong>Tip:</strong> You can export existing products first to see the exact format, then modify and re-import
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{ marginBottom: '8px' }}>
                      <strong>Step 1:</strong> Convert your PDF to JSON using the script: <code>node scripts/pdf-to-json.js</code>
                    </div>
                    <div style={{ marginBottom: '8px' }}>
                      <strong>Step 2:</strong> Copy the JSON output from the script
                    </div>
                    <div style={{ marginBottom: '8px' }}>
                      <strong>Step 3:</strong> Paste the JSON data below and click "Parse JSON"
                    </div>
                    <div style={{ 
                      background: '#dbeafe', 
                      padding: '8px', 
                      borderRadius: '4px',
                      fontSize: '12px',
                      marginTop: '8px'
                    }}>
                      💡 <strong>Tip:</strong> JSON format should match Excel import format: <code>{'{"fabrics": [...], "care_instructions": [...]}'}</code>
                    </div>
                  </>
                )}
              </div>
            </div>

            {!importPreview ? (
              importMode === 'json' ? (
                <div>
                  <div style={{
                    border: '2px dashed #d1d5db',
                    borderRadius: '12px',
                    padding: '24px',
                    background: '#f9fafb',
                    marginBottom: '16px'
                  }}>
                    <label style={{
                      display: 'block',
                      fontSize: '14px',
                      fontWeight: '600',
                      color: '#374151',
                      marginBottom: '8px'
                    }}>
                      Paste JSON Data
                    </label>
                    <textarea
                      value={jsonInput}
                      onChange={(e) => {
                        setJsonInput(e.target.value);
                        setJsonError(null);
                      }}
                      placeholder='Paste your JSON data here...'
                      style={{
                        width: '100%',
                        minHeight: '300px',
                        padding: '12px',
                        border: jsonError ? '2px solid #ef4444' : '1px solid #d1d5db',
                        borderRadius: '8px',
                        fontSize: '13px',
                        fontFamily: 'monospace',
                        resize: 'vertical',
                        background: '#ffffff'
                      }}
                    />
                    {jsonError && (
                      <div style={{
                        marginTop: '8px',
                        padding: '8px',
                        background: '#fee2e2',
                        border: '1px solid #ef4444',
                        borderRadius: '4px',
                        color: '#991b1b',
                        fontSize: '12px'
                      }}>
                        ❌ {jsonError}
                      </div>
                    )}
                  </div>
                  <div style={{
                    display: 'flex',
                    gap: '12px',
                    justifyContent: 'flex-end'
                  }}>
                    <button
                      onClick={closeImportModal}
                      style={{
                        background: '#6b7280',
                        color: 'white',
                        border: 'none',
                        borderRadius: '12px',
                        padding: '12px 24px',
                        fontSize: '14px',
                        fontWeight: '600',
                        cursor: 'pointer'
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handlePasteJSON}
                      disabled={importing || !jsonInput.trim()}
                      style={{
                        background: importing || !jsonInput.trim() ? '#9ca3af' : '#059669',
                        color: 'white',
                        border: 'none',
                        borderRadius: '12px',
                        padding: '12px 24px',
                        fontSize: '14px',
                        fontWeight: '600',
                        cursor: importing || !jsonInput.trim() ? 'not-allowed' : 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px'
                      }}
                    >
                      {importing ? (
                        <>
                          <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
                          Parsing...
                        </>
                      ) : (
                        <>
                          <CheckCircle size={16} />
                          Parse JSON
                        </>
                      )}
                    </button>
                  </div>
                </div>
              ) : (
              <div>
                <div style={{
                  border: '2px dashed #d1d5db',
                  borderRadius: '12px',
                  padding: '32px',
                  textAlign: 'center',
                  background: '#f9fafb',
                  marginBottom: '24px'
                }}>
                  <div style={{ fontSize: '32px', marginBottom: '12px', display: 'flex', justifyContent: 'center' }}>
                    <FileSpreadsheet size={32} />
                  </div>
                  <div style={{ fontSize: '16px', fontWeight: '600', color: '#374151', marginBottom: '4px' }}>
                    Select file to import
                  </div>
                  <div style={{ fontSize: '14px', color: '#6b7280', marginBottom: '16px' }}>
                    Supports .xlsx, .xls, and .pdf files with product data
                  </div>
                  <input
                    type="file"
                    accept=".xlsx,.xls,.pdf"
                    onChange={(e) => {
                      if (e.target.files[0]) {
                        handleImportFile(e.target.files[0]);
                      }
                    }}
                    disabled={importing}
                    style={{ display: 'none' }}
                    id="file-import"
                  />
                  <label
                    htmlFor="file-import"
                    style={{
                      background: importing ? '#9ca3af' : 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)',
                      color: 'white',
                      border: 'none',
                      borderRadius: '12px',
                      padding: '12px 24px',
                      fontSize: '14px',
                      fontWeight: '600',
                      cursor: importing ? 'not-allowed' : 'pointer',
                      display: 'inline-block',
                      opacity: importing ? 0.6 : 1
                    }}
                  >
                    {importing ? (
                      <>
                        <Loader2 size={16} style={{ display: 'inline', marginRight: '8px', animation: 'spin 1s linear infinite' }} />
                        Parsing...
                      </>
                    ) : (
                      <>
                        <File size={16} style={{ display: 'inline', marginRight: '8px' }} />
                        Choose File (Excel or PDF)
                      </>
                    )}
                  </label>
                </div>

                <div style={{
                  background: 'linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)',
                  padding: '16px',
                  borderRadius: '12px',
                  border: '1px solid #f59e0b'
                }}>
                  <div style={{ fontSize: '14px', color: '#92400e', fontWeight: '600', marginBottom: '8px' }}>
                    <Lightbulb size={16} style={{ display: 'inline', marginRight: '8px' }} />
                    Import Tips:
                  </div>
                  <ul style={{ fontSize: '12px', color: '#92400e', margin: '0', paddingLeft: '16px' }}>
                    <li><strong>For Excel:</strong> Download the template first to see the correct format</li>
                    <li><strong>For PDF:</strong> Ensure the PDF contains structured tables with product data</li>
                    <li>Ensure all required fields are filled (name, productId, price, etc.)</li>
                    <li>Use proper data types (numbers for prices, etc.)</li>
                    <li>Check availability values: in_stock, out_of_stock, discontinued</li>
                    <li>PDF parsing will attempt to extract data from tables automatically</li>
                  </ul>
                </div>
              </div>
              )
            ) : (
              <div>
                <div style={{
                  background: 'linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%)',
                  padding: '16px',
                  borderRadius: '12px',
                  border: '1px solid #059669',
                  marginBottom: '24px'
                }}>
                  <div style={{ fontSize: '14px', color: '#047857', fontWeight: '600', marginBottom: '4px' }}>
                    <CheckCircle size={16} style={{ display: 'inline', marginRight: '8px' }} />
                    File loaded successfully!
                  </div>
                  <div style={{ fontSize: '12px', color: '#047857' }}>
                    {typeof importPreview === 'object' && !Array.isArray(importPreview) 
                      ? `Found multi-sheet data: ${Object.entries(importPreview).map(([sheet, data]) => `${sheet}: ${data.length} rows`).join(', ')}. Click "Import Products" to populate the database.`
                      : `Found ${importPreview.length} rows to import. Click "Import Products" to populate the database.`
                    }
                  </div>
                </div>

                {/* Preview Table */}
                <div style={{
                  maxHeight: '300px',
                  overflow: 'auto',
                  border: '1px solid #e5e7eb',
                  borderRadius: '8px',
                  marginBottom: '24px'
                }}>
                  {typeof importPreview === 'object' && !Array.isArray(importPreview) ? (
                    // Multi-sheet preview
                    Object.entries(importPreview).map(([sheetName, data]) => (
                      <div key={sheetName} style={{ marginBottom: '16px' }}>
                        <div style={{ 
                          background: '#f3f4f6', 
                          padding: '8px 12px', 
                          fontWeight: '600', 
                          color: '#374151',
                          borderBottom: '1px solid #e5e7eb'
                        }}>
                          {sheetName.charAt(0).toUpperCase() + sheetName.slice(1)} ({data.length} rows)
                        </div>
                        <table style={{ width: '100%', fontSize: '12px' }}>
                          <thead style={{ background: '#f9fafb' }}>
                            <tr>
                              {Object.keys(data[0] || {}).slice(0, 6).map(key => (
                                <th key={key} style={{ padding: '8px', textAlign: 'left', fontWeight: '600', color: '#374151' }}>
                                  {key}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {data.slice(0, 3).map((row, index) => (
                              <tr key={index} style={{ borderBottom: '1px solid #e5e7eb' }}>
                                {Object.values(row).slice(0, 6).map((value, i) => (
                                  <td key={i} style={{ padding: '8px', color: '#374151' }}>
                                    {String(value).substring(0, 20)}
                                    {String(value).length > 20 ? '...' : ''}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {data.length > 3 && (
                          <div style={{ padding: '8px', textAlign: 'center', fontSize: '12px', color: '#6b7280' }}>
                            ... and {data.length - 3} more rows
                          </div>
                        )}
                      </div>
                    ))
                  ) : (
                    // Single-sheet preview (legacy)
                    <table style={{ width: '100%', fontSize: '12px' }}>
                      <thead style={{ background: '#f9fafb', position: 'sticky', top: 0 }}>
                        <tr>
                          {Object.keys(importPreview[0] || {}).slice(0, 8).map(key => (
                            <th key={key} style={{ padding: '8px', textAlign: 'left', fontWeight: '600', color: '#374151' }}>
                              {key}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {importPreview.slice(0, 10).map((row, index) => (
                          <tr key={index} style={{ borderBottom: '1px solid #e5e7eb' }}>
                            {Object.values(row).slice(0, 8).map((value, i) => (
                              <td key={i} style={{ padding: '8px', color: '#374151' }}>
                                {String(value).substring(0, 20)}
                                {String(value).length > 20 ? '...' : ''}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  {typeof importPreview === 'object' && !Array.isArray(importPreview) ? null : (
                    importPreview.length > 10 && (
                      <div style={{ padding: '8px', textAlign: 'center', fontSize: '12px', color: '#6b7280' }}>
                        ... and {importPreview.length - 10} more rows
                      </div>
                    )
                  )}
                </div>

                <div style={{
                  display: 'flex',
                  gap: '12px',
                  justifyContent: 'flex-end'
                }}>
                  <button
                    onClick={closeImportModal}
                    style={{
                      background: '#6b7280',
                      color: 'white',
                      border: 'none',
                      borderRadius: '12px',
                      padding: '12px 24px',
                      fontSize: '14px',
                      fontWeight: '600',
                      cursor: 'pointer'
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleBulkImport}
                    disabled={importing}
                    style={{
                      background: importing ? '#9ca3af' : '#059669',
                      color: 'white',
                      border: 'none',
                      borderRadius: '12px',
                      padding: '12px 24px',
                      fontSize: '14px',
                      fontWeight: '600',
                      cursor: importing ? 'not-allowed' : 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px'
                    }}
                  >
                    {importing ? (
                      <>
                        <Loader2 size={16} className="animate-spin" />
                        Importing...
                      </>
                    ) : (
                      <>
                        <Upload size={16} />
                        Import Products
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Import Preview Modal */}
      {importPreviewModal && importValidation && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000
        }}>
          <div style={{
            background: 'white',
            borderRadius: '16px',
            padding: '32px',
            maxWidth: '800px',
            width: '90%',
            maxHeight: '80vh',
            overflow: 'auto',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)'
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '24px'
            }}>
              <h2 style={{
                margin: 0,
                fontSize: '24px',
                fontWeight: '700',
                color: '#111827'
              }}>
                Import Preview
              </h2>
              <button
                onClick={() => setImportPreviewModal(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '24px',
                  cursor: 'pointer',
                  color: '#6b7280'
                }}
              >
                <X size={24} />
              </button>
            </div>

            {/* Validation Summary */}
            <div style={{ marginBottom: '24px' }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                marginBottom: '16px'
              }}>
                {importValidation.isValid ? (
                  <CheckCircle size={24} style={{ color: '#059669' }} />
                ) : (
                  <X size={24} style={{ color: '#dc2626' }} />
                )}
                <h3 style={{
                  margin: 0,
                  fontSize: '18px',
                  fontWeight: '600',
                  color: importValidation.isValid ? '#059669' : '#dc2626'
                }}>
                  {importValidation.isValid ? 'Ready to Import' : 'Validation Errors Found'}
                </h3>
              </div>

              {/* Errors */}
              {importValidation.errors && importValidation.errors.length > 0 && (
                <div style={{
                  background: '#fef2f2',
                  border: '1px solid #fecaca',
                  borderRadius: '8px',
                  padding: '16px',
                  marginBottom: '16px'
                }}>
                  <h4 style={{
                    margin: '0 0 12px 0',
                    fontSize: '16px',
                    fontWeight: '600',
                    color: '#dc2626'
                  }}>
                    Errors ({importValidation.errors.length})
                  </h4>
                  <div style={{ maxHeight: '200px', overflow: 'auto' }}>
                    {importValidation.errors.slice(0, 10).map((error, index) => (
                      <div key={index} style={{
                        padding: '8px 0',
                        borderBottom: index < importValidation.errors.slice(0, 10).length - 1 ? '1px solid #fecaca' : 'none',
                        fontSize: '14px',
                        color: '#991b1b'
                      }}>
                        <strong>{error.sheet} Row {error.row}:</strong> {error.errors.join(', ')}
                      </div>
                    ))}
                    {importValidation.errors.length > 10 && (
                      <div style={{
                        padding: '8px 0',
                        fontSize: '14px',
                        color: '#991b1b',
                        fontStyle: 'italic'
                      }}>
                        ... and {importValidation.errors.length - 10} more errors
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Warnings */}
              {importValidation.warnings && importValidation.warnings.length > 0 && (
                <div style={{
                  background: '#fffbeb',
                  border: '1px solid #fed7aa',
                  borderRadius: '8px',
                  padding: '16px',
                  marginBottom: '16px'
                }}>
                  <h4 style={{
                    margin: '0 0 12px 0',
                    fontSize: '16px',
                    fontWeight: '600',
                    color: '#d97706'
                  }}>
                    Warnings ({importValidation.warnings.length})
                  </h4>
                  <div style={{ maxHeight: '200px', overflow: 'auto' }}>
                    {importValidation.warnings.slice(0, 10).map((warning, index) => (
                      <div key={index} style={{
                        padding: '8px 0',
                        borderBottom: index < importValidation.warnings.slice(0, 10).length - 1 ? '1px solid #fed7aa' : 'none',
                        fontSize: '14px',
                        color: '#92400e'
                      }}>
                        <strong>{warning.sheet} Row {warning.row}:</strong> {warning.warnings.join(', ')}
                      </div>
                    ))}
                    {importValidation.warnings.length > 10 && (
                      <div style={{
                        padding: '8px 0',
                        fontSize: '14px',
                        color: '#92400e',
                        fontStyle: 'italic'
                      }}>
                        ... and {importValidation.warnings.length - 10} more warnings
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Info - Auto-created items */}
              {importValidation.info && importValidation.info.length > 0 && (
                <div style={{
                  background: '#eff6ff',
                  border: '1px solid #93c5fd',
                  borderRadius: '8px',
                  padding: '16px',
                  marginBottom: '16px'
                }}>
                  <h4 style={{
                    margin: '0 0 12px 0',
                    fontSize: '16px',
                    fontWeight: '600',
                    color: '#1d4ed8'
                  }}>
                    Auto-Created Items ({importValidation.info.length})
                  </h4>
                  <div style={{ maxHeight: '200px', overflow: 'auto' }}>
                    {importValidation.info.map((info, index) => (
                      <div key={index} style={{
                        padding: '8px 0',
                        borderBottom: index < importValidation.info.length - 1 ? '1px solid #93c5fd' : 'none',
                        fontSize: '14px',
                        color: '#1e40af'
                      }}>
                        <strong>ℹ️ {info.message}</strong>
                        {info.items && info.items.length > 0 && (
                          <div style={{ marginTop: '4px', fontSize: '12px', color: '#1e40af' }}>
                            Items: {info.items.join(', ')}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Data Preview */}
              <div style={{
                background: '#f9fafb',
                border: '1px solid #e5e7eb',
                borderRadius: '8px',
                padding: '16px'
              }}>
                <h4 style={{
                  margin: '0 0 12px 0',
                  fontSize: '16px',
                  fontWeight: '600',
                  color: '#374151'
                }}>
                  Data Preview
                </h4>
                <div style={{ fontSize: '14px', color: '#6b7280' }}>
                  {typeof importPreview === 'object' && !Array.isArray(importPreview) ? (
                    <div>
                      {Object.entries(importPreview).map(([sheetName, data]) => (
                        <div key={sheetName} style={{ marginBottom: '8px' }}>
                          <strong>{sheetName}:</strong> {data.length} rows
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div>
                      <strong>{activeTab}:</strong> {importPreview.length} rows
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div style={{
              display: 'flex',
              gap: '12px',
              justifyContent: 'flex-end'
            }}>
              <button
                onClick={() => setImportPreviewModal(false)}
                style={{
                  background: '#6b7280',
                  color: 'white',
                  border: 'none',
                  borderRadius: '12px',
                  padding: '12px 24px',
                  fontSize: '14px',
                  fontWeight: '600',
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>
              <button
                onClick={confirmImport}
                disabled={!importValidation.isValid || importing}
                style={{
                  background: !importValidation.isValid || importing ? '#9ca3af' : '#059669',
                  color: 'white',
                  border: 'none',
                  borderRadius: '12px',
                  padding: '12px 24px',
                  fontSize: '14px',
                  fontWeight: '600',
                  cursor: !importValidation.isValid || importing ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}
              >
                {importing ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Importing...
                  </>
                ) : (
                  <>
                    <Upload size={16} />
                    Confirm Import
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    </>
  );
}
