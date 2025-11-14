import React, { useState, useEffect } from 'react';
import { 
  ShoppingCart, RefreshCw, Search, CreditCard, Package, Clock, Settings, 
  CheckCircle, Inbox, Loader2, Eye, User, Truck, Scissors, Ruler, 
  Palette, FileText, X, BarChart3 
} from 'lucide-react';
// All Strapi components replaced with pure HTML/CSS for better performance and styling

export default function OrderPage() {
  console.log('🔄 OrderPage component loaded - address formatting should work now!');
  
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [paymentStatusFilter, setPaymentStatusFilter] = useState('all');
  const [orderStatusFilter, setOrderStatusFilter] = useState('all');
  const [updatingStatus, setUpdatingStatus] = useState(false);
  
  useEffect(() => {
    fetchOrders();
  }, []);

  const fetchOrders = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/orders?populate=*', {
        headers: {
          'Content-Type': 'application/json',
        },
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      console.log('📦 Orders fetched:', data);
      setOrders(data.data || []);
    } catch (error) {
      console.error('Error fetching orders:', error);
      setOrders([]);
    } finally {
      setLoading(false);
    }
  };

  const filteredOrders = orders.filter(order => {
    const matchesSearch = order.orderNumber?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         order.customerName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         order.customerEmail?.toLowerCase().includes(searchTerm.toLowerCase());
    
    // Handle payment status filtering - check both paymentStatus and fallback to payment_status
    const orderPaymentStatus = order.paymentStatus || order.payment_status || 'unknown';
    const matchesPaymentStatus = paymentStatusFilter === 'all' || orderPaymentStatus === paymentStatusFilter;
    
    // Handle order status filtering - check both statusOrder and fallback to order_status
    const orderStatus = order.statusOrder || order.order_status || order.status || 'pending';
    const matchesOrderStatus = orderStatusFilter === 'all' || orderStatus === orderStatusFilter;
    
    return matchesSearch && matchesPaymentStatus && matchesOrderStatus;
  });

  const getPaymentStatusColor = (status) => {
    const normalizedStatus = (status || '').toLowerCase();
    switch (normalizedStatus) {
      case 'paid': return 'success';
      case 'pending': return 'warning';
      case 'failed': return 'danger';
      case 'cancelled': return 'secondary';
      default: return 'secondary';
    }
  };

  const getOrderStatusColor = (status) => {
    const normalizedStatus = (status || '').toLowerCase();
    switch (normalizedStatus) {
      case 'delivered': return 'success';
      case 'shipped': return 'primary';
      case 'processing': return 'warning';
      case 'pending': return 'secondary';
      default: return 'secondary';
    }
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-GB', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatPrice = (price) => {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: 'GBP'
    }).format(price);
  };

  const formatMeasurement = (value, unit) => {
    if (!value) return '';
    
    // Convert to string for processing
    const valueStr = value.toString().trim();
    
    // Handle invalid or placeholder values
    if (valueStr === '0' || valueStr === '00' || valueStr === '0.0' || valueStr === '') {
      return 'Not specified';
    }
    
    // If the value already contains a unit, return it as is
    if (/\d+\s*(cm|mm|m|inches?|in|ft|feet?)\s*$/i.test(valueStr)) {
      return valueStr;
    }
    
    // If no unit in value, add the provided unit or default to cm
    const defaultUnit = unit || 'cm';
    return `${valueStr} ${defaultUnit}`;
  };

  const parseAddress = (addressData) => {
    if (!addressData) return null;
    
    // If it's already a string, try to parse it as JSON
    if (typeof addressData === 'string') {
      try {
        const parsed = JSON.parse(addressData);
        return parsed;
      } catch (e) {
        // If parsing fails, return the string as is
        return addressData;
      }
    }
    
    // If it's already an object, return it
    return addressData;
  };

  const formatAddress = (addressData) => {
    console.log('🚨 FORMAT ADDRESS CALLED WITH:', addressData);
    console.log('🚨 FORMAT ADDRESS TYPE:', typeof addressData);
    
    // Handle null/undefined
    if (!addressData) return 'No address provided';
    
    // If it's already a formatted string, return it
    if (typeof addressData === 'string') {
      // Check if it's a JSON string that needs parsing (handle both quoted and unquoted JSON)
      if ((addressData.startsWith('{') && addressData.endsWith('}')) || 
          (addressData.startsWith('"') && addressData.endsWith('"') && addressData.includes('{'))) {
        try {
          // Use JSON.parse directly - it handles escaped quotes automatically
          const parsed = JSON.parse(addressData);
          console.log('🚨 PARSED JSON:', parsed);
          console.log('🚨 PARSED JSON TYPE:', typeof parsed);
          
          // Ensure we have an object, not a string
          if (typeof parsed === 'string') {
            console.log('🚨 PARSED JSON IS STRING, parsing again...');
            const doubleParsed = JSON.parse(parsed);
            console.log('🚨 DOUBLE PARSED JSON:', doubleParsed);
            console.log('🚨 DOUBLE PARSED JSON TYPE:', typeof doubleParsed);
            const result = formatAddressObject(doubleParsed);
            console.log('🚨 FORMATTED RESULT:', result);
            return result;
          } else {
            const result = formatAddressObject(parsed);
            console.log('🚨 FORMATTED RESULT:', result);
            return result;
          }
        } catch (e) {
          console.log('🚨 JSON PARSE ERROR:', e);
          return addressData; // Return as-is if parsing fails
        }
      }
      return addressData;
    }
    
    // If it's an object, format it
    if (typeof addressData === 'object') {
      return formatAddressObject(addressData);
    }
    
    return 'Invalid address format';
  };

  const formatAddressObject = (obj) => {
    console.log('🔍 formatAddressObject called with:', obj);
    console.log('🔍 Object type:', typeof obj);
    console.log('🔍 Object keys:', Object.keys(obj));
    console.log('🔍 Object values:', Object.values(obj));
    console.log('🔍 Object entries:', Object.entries(obj));
    
    const parts = [];
    
    // Extract address components in order
    if (obj.line1) parts.push(obj.line1);
    if (obj.line2) parts.push(obj.line2);
    if (obj.address1) parts.push(obj.address1);
    if (obj.address2) parts.push(obj.address2);
    if (obj.city) parts.push(obj.city);
    if (obj.state) parts.push(obj.state);
    if (obj.province) parts.push(obj.province);
    if (obj.postcode) parts.push(obj.postcode);
    if (obj.postalCode) parts.push(obj.postalCode);
    if (obj.country) parts.push(obj.country);
    
    console.log('🔍 Checking individual fields:');
    console.log('🔍 obj.line1:', obj.line1);
    console.log('🔍 obj.line2:', obj.line2);
    console.log('🔍 obj.city:', obj.city);
    console.log('🔍 obj.postalCode:', obj.postalCode);
    console.log('🔍 obj.country:', obj.country);
    
    console.log('🔍 Address parts extracted:', parts);
    
    // If no parts found, try to get all string values
    if (parts.length === 0) {
      const values = Object.values(obj).filter(val => val && typeof val === 'string');
      if (values.length === 0) {
        console.log('🔍 Fallback result: Invalid address format');
        return 'Invalid address format';
      }
      // Return JSX with line breaks for fallback values
      const result = values.map((value, index) => (
        <React.Fragment key={index}>
          {value}
          {index < values.length - 1 && <br />}
        </React.Fragment>
      ));
      console.log('🔍 Fallback JSX result:', result);
      return result;
    }
    
    // Return JSX with line breaks between each address component
    const result = parts.map((part, index) => (
      <React.Fragment key={index}>
        {part}
        {index < parts.length - 1 && <br />}
      </React.Fragment>
    ));
    console.log('🔍 Final formatted JSX result:', result);
    return result;
  };

  const openOrderModal = (order) => {
    console.log('🚨 OPENING ORDER MODAL:', order);
    console.log('🚨 ORDER SHIPPING ADDRESS:', order.shippingAddress);
    console.log('🚨 ORDER DELIVERY ADDRESS:', order.deliveryAddress);
    console.log('🚨 ORDER BILLING ADDRESS:', order.billingAddress);
    setSelectedOrder(order);
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setSelectedOrder(null);
    setIsModalOpen(false);
  };

  const updateOrderStatus = async (orderId, newStatus) => {
    try {
      setUpdatingStatus(true);
      const response = await fetch(`/api/orders/${orderId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          data: {
            statusOrder: newStatus
          }
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      // Update the order in the local state
      setOrders(prevOrders => 
        prevOrders.map(order => 
          order.id === orderId 
            ? { ...order, statusOrder: newStatus }
            : order
        )
      );

      // Update the selected order if it's the same one
      if (selectedOrder && selectedOrder.id === orderId) {
        setSelectedOrder(prev => ({ ...prev, statusOrder: newStatus }));
      }

      console.log('✅ Order status updated successfully!');
    } catch (error) {
      console.error('Error updating order status:', error);
      alert('Failed to update order status. Please try again.');
    } finally {
      setUpdatingStatus(false);
    }
  };

  return (
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
              <ShoppingCart size={32} />
              Order Management
            </h1>
            <p style={{
              fontSize: '16px',
              color: '#6b7280',
              margin: '0',
              fontWeight: '500'
            }}>
              Manage and view all customer orders
            </p>
          </div>
          <button
            onClick={fetchOrders}
            disabled={loading}
            style={{
              background: loading ? '#9ca3af' : '#059669',
              color: 'white',
              border: 'none',
              borderRadius: '12px',
              padding: '12px 24px',
              fontSize: '14px',
              fontWeight: '600',
              cursor: loading ? 'not-allowed' : 'pointer',
              transition: 'all 0.3s ease',
              boxShadow: '0 4px 15px rgba(5, 150, 105, 0.4)',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            {loading ? 'Loading...' : 'Refresh Orders'}
          </button>
        </div>

        {/* Filters */}
        <div style={{
          background: '#f8fafc',
          borderRadius: '12px',
          padding: '24px',
          border: '1px solid #e2e8f0'
        }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
            gap: '20px',
            alignItems: 'end'
          }}>
            <div>
              <label style={{
                display: 'flex',
                marginBottom: '8px',
                fontSize: '14px',
                fontWeight: '600',
                color: '#374151',
                alignItems: 'center',
                gap: '8px'
              }}>
                <Search size={16} />
                Search Orders
              </label>
              <input
                type="text"
                placeholder="Search by order number or customer name..."
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
                onFocus={(e) => {
                  e.target.style.borderColor = '#667eea';
                  e.target.style.boxShadow = '0 0 0 3px rgba(102, 126, 234, 0.1)';
                }}
                onBlur={(e) => {
                  e.target.style.borderColor = '#e5e7eb';
                  e.target.style.boxShadow = 'none';
                }}
              />
            </div>
            
            <div>
              <label style={{
                display: 'flex',
                marginBottom: '8px',
                fontSize: '14px',
                fontWeight: '600',
                color: '#374151',
                alignItems: 'center',
                gap: '8px'
              }}>
                <CreditCard size={16} />
                Payment Status
              </label>
              <select
                value={paymentStatusFilter}
                onChange={(e) => setPaymentStatusFilter(e.target.value)}
                style={{
                  width: '100%',
                  padding: '12px 16px',
                  border: '2px solid #e5e7eb',
                  borderRadius: '12px',
                  fontSize: '14px',
                  background: 'white',
                  cursor: 'pointer',
                  transition: 'all 0.3s ease',
                  outline: 'none'
                }}
              >
                <option value="all">All Payment Statuses</option>
                <option value="pending">Pending</option>
                <option value="paid">Paid</option>
                <option value="failed">Failed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
            
            <div>
              <label style={{
                display: 'flex',
                marginBottom: '8px',
                fontSize: '14px',
                fontWeight: '600',
                color: '#374151',
                alignItems: 'center',
                gap: '8px'
              }}>
                <Package size={16} />
                Order Status
              </label>
              <select
                value={orderStatusFilter}
                onChange={(e) => setOrderStatusFilter(e.target.value)}
                style={{
                  width: '100%',
                  padding: '12px 16px',
                  border: '2px solid #e5e7eb',
                  borderRadius: '12px',
                  fontSize: '14px',
                  background: 'white',
                  cursor: 'pointer',
                  transition: 'all 0.3s ease',
                  outline: 'none'
                }}
              >
                <option value="all">All Order Statuses</option>
                <option value="pending">Pending</option>
                <option value="processing">Processing</option>
                <option value="shipped">Shipped</option>
                <option value="delivered">Delivered</option>
              </select>
            </div>
            
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
              color: 'white',
              padding: '12px 20px',
              borderRadius: '12px',
              fontWeight: '600',
              fontSize: '14px',
              boxShadow: '0 4px 15px rgba(16, 185, 129, 0.3)'
            }}>
              <BarChart3 size={16} /> {filteredOrders.length} orders found
            </div>
          </div>
        </div>
      </div>

      {/* Status Summary Boxes */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
        gap: '24px',
        marginBottom: '32px'
      }}>
        {/* Pending Orders */}
        <div style={{
          background: '#ffffff',
          borderRadius: '16px',
          padding: '24px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
          border: '1px solid #f1f5f9',
          textAlign: 'center',
          transition: 'all 0.3s ease'
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = 'translateY(-2px)';
          e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.12)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = 'translateY(0)';
          e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)';
        }}>
          <div style={{
            fontSize: '48px',
            marginBottom: '12px',
            display: 'flex',
            justifyContent: 'center'
          }}>
            <Clock size={48} />
          </div>
          <h3 style={{
            fontSize: '18px',
            fontWeight: '700',
            color: '#374151',
            margin: '0 0 8px 0',
            textTransform: 'uppercase',
            letterSpacing: '0.5px'
          }}>Pending Orders</h3>
          <div style={{
            fontSize: '32px',
            fontWeight: '800',
            color: '#f59e0b',
            marginBottom: '4px'
          }}>
            {orders.filter(order => (order.statusOrder || order.order_status || order.status || 'pending') === 'pending').length}
          </div>
          <p style={{
            fontSize: '14px',
            color: '#6b7280',
            margin: '0'
          }}>Awaiting processing</p>
        </div>

        {/* Processing Orders */}
        <div style={{
          background: '#ffffff',
          borderRadius: '16px',
          padding: '24px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
          border: '1px solid #f1f5f9',
          textAlign: 'center',
          transition: 'all 0.3s ease'
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = 'translateY(-2px)';
          e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.12)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = 'translateY(0)';
          e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)';
        }}>
          <div style={{
            fontSize: '48px',
            marginBottom: '12px',
            display: 'flex',
            justifyContent: 'center'
          }}>
            <Settings size={48} />
          </div>
          <h3 style={{
            fontSize: '18px',
            fontWeight: '700',
            color: '#374151',
            margin: '0 0 8px 0',
            textTransform: 'uppercase',
            letterSpacing: '0.5px'
          }}>Processing Orders</h3>
          <div style={{
            fontSize: '32px',
            fontWeight: '800',
            color: '#3b82f6',
            marginBottom: '4px'
          }}>
            {orders.filter(order => (order.statusOrder || order.order_status || order.status || 'pending') === 'processing').length}
          </div>
          <p style={{
            fontSize: '14px',
            color: '#6b7280',
            margin: '0'
          }}>Being prepared</p>
        </div>

        {/* Delivered Orders */}
        <div style={{
          background: '#ffffff',
          borderRadius: '16px',
          padding: '24px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
          border: '1px solid #f1f5f9',
          textAlign: 'center',
          transition: 'all 0.3s ease'
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = 'translateY(-2px)';
          e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.12)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = 'translateY(0)';
          e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)';
        }}>
          <div style={{
            fontSize: '48px',
            marginBottom: '12px',
            display: 'flex',
            justifyContent: 'center'
          }}>
            <CheckCircle size={48} />
          </div>
          <h3 style={{
            fontSize: '18px',
            fontWeight: '700',
            color: '#374151',
            margin: '0 0 8px 0',
            textTransform: 'uppercase',
            letterSpacing: '0.5px'
          }}>Delivered Orders</h3>
          <div style={{
            fontSize: '32px',
            fontWeight: '800',
            color: '#10b981',
            marginBottom: '4px'
          }}>
            {orders.filter(order => (order.statusOrder || order.order_status || order.status || 'pending') === 'delivered').length}
          </div>
          <p style={{
            fontSize: '14px',
            color: '#6b7280',
            margin: '0'
          }}>Successfully completed</p>
        </div>
      </div>

      {/* Orders Table */}
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
            }}>Loading orders...</div>
          </div>
        ) : filteredOrders.length === 0 ? (
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
              <Inbox size={48} />
            </div>
            <div style={{
              fontSize: '18px',
              fontWeight: '600'
            }}>No orders found</div>
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
                    letterSpacing: '0.5px'
                  }}>Order Number</th>
                  <th style={{
                    padding: '20px 16px',
                    textAlign: 'left',
                    fontWeight: '700',
                    color: '#374151',
                    fontSize: '12px',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px'
                  }}>Customer</th>
                  <th style={{
                    padding: '20px 16px',
                    textAlign: 'left',
                    fontWeight: '700',
                    color: '#374151',
                    fontSize: '12px',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px'
                  }}>Payment Status</th>
                  <th style={{
                    padding: '20px 16px',
                    textAlign: 'left',
                    fontWeight: '700',
                    color: '#374151',
                    fontSize: '12px',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px'
                  }}>Order Status</th>
                  <th style={{
                    padding: '20px 16px',
                    textAlign: 'left',
                    fontWeight: '700',
                    color: '#374151',
                    fontSize: '12px',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px'
                  }}>Total</th>
                  <th style={{
                    padding: '20px 16px',
                    textAlign: 'left',
                    fontWeight: '700',
                    color: '#374151',
                    fontSize: '12px',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px'
                  }}>Date</th>
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
                {filteredOrders.map((order, index) => (
                  <tr
                    key={order.id}
                    style={{
                      borderBottom: '1px solid #f1f5f9',
                      transition: 'all 0.2s ease',
                      cursor: 'pointer',
                      background: index % 2 === 0 ? 'rgba(255, 255, 255, 0.5)' : 'rgba(248, 250, 252, 0.5)'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'rgba(5, 150, 105, 0.05)';
                      e.currentTarget.style.transform = 'translateX(4px)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = index % 2 === 0 ? 'rgba(255, 255, 255, 0.5)' : 'rgba(248, 250, 252, 0.5)';
                      e.currentTarget.style.transform = 'translateX(0)';
                    }}
                  >
                    <td style={{
                      padding: '20px 16px',
                      fontWeight: '600',
                      color: '#1f2937'
                    }}>
                      #{order.orderNumber || order.id}
                    </td>
                    <td style={{
                      padding: '20px 16px',
                      color: '#374151'
                    }}>
                      {order.customerName || 'Unknown Customer'}
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
                        background: getPaymentStatusColor(order.paymentStatus || order.payment_status) === 'success' ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)' :
                                   getPaymentStatusColor(order.paymentStatus || order.payment_status) === 'warning' ? 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)' :
                                   getPaymentStatusColor(order.paymentStatus || order.payment_status) === 'danger' ? 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)' :
                                   'linear-gradient(135deg, #6b7280 0%, #4b5563 100%)',
                        color: 'white',
                        boxShadow: '0 2px 8px rgba(0,0,0,0.15)'
                      }}>
                        {(order.paymentStatus || order.payment_status || 'UNKNOWN').toUpperCase()}
                      </span>
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
                        background: getOrderStatusColor(order.statusOrder || order.order_status || order.status) === 'success' ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)' :
                                   getOrderStatusColor(order.statusOrder || order.order_status || order.status) === 'primary' ? 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)' :
                                   getOrderStatusColor(order.statusOrder || order.order_status || order.status) === 'warning' ? 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)' :
                                   'linear-gradient(135deg, #6b7280 0%, #4b5563 100%)',
                        color: 'white',
                        boxShadow: '0 2px 8px rgba(0,0,0,0.15)'
                      }}>
                        {(order.statusOrder || order.order_status || order.status || 'PENDING').toUpperCase()}
                      </span>
                    </td>
                    <td style={{
                      padding: '20px 16px',
                      fontWeight: '700',
                      color: '#059669',
                      fontSize: '16px'
                    }}>
                      {formatPrice(order.total || 0)}
                    </td>
                    <td style={{
                      padding: '20px 16px',
                      color: '#6b7280',
                      fontSize: '13px'
                    }}>
                      {formatDate(order.createdAt)}
                    </td>
                    <td style={{
                      padding: '20px 16px',
                      textAlign: 'center'
                    }}>
                      <button
                        onClick={() => openOrderModal(order)}
                        style={{
                          background: '#059669',
                          color: 'white',
                          border: 'none',
                          borderRadius: '8px',
                          padding: '8px 16px',
                          fontSize: '12px',
                          fontWeight: '600',
                          cursor: 'pointer',
                          transition: 'all 0.3s ease',
                          boxShadow: '0 2px 8px rgba(5, 150, 105, 0.3)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px'
                        }}
                        onMouseEnter={(e) => {
                          e.target.style.transform = 'translateY(-2px)';
                          e.target.style.boxShadow = '0 4px 15px rgba(5, 150, 105, 0.4)';
                        }}
                        onMouseLeave={(e) => {
                          e.target.style.transform = 'translateY(0)';
                          e.target.style.boxShadow = '0 2px 8px rgba(5, 150, 105, 0.3)';
                        }}
                      >
                        <Eye size={12} />
                        View Details
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Order Details Modal */}
      {isModalOpen && selectedOrder && (
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
            maxWidth: '1200px',
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
                  Order #{selectedOrder.orderNumber || selectedOrder.id}
                </h2>
                <p style={{
                  fontSize: '16px',
                  margin: '0',
                  opacity: '0.9'
                }}>
                  Created on {formatDate(selectedOrder.createdAt)}
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
                onMouseEnter={(e) => {
                  e.target.style.background = 'rgba(255, 255, 255, 0.3)';
                  e.target.style.transform = 'scale(1.1)';
                }}
                onMouseLeave={(e) => {
                  e.target.style.background = 'rgba(255, 255, 255, 0.2)';
                  e.target.style.transform = 'scale(1)';
                }}
              >
                <X size={20} />
              </button>
            </div>

            <div style={{ padding: '32px', maxHeight: '70vh', overflow: 'auto' }}>
              
              {/* Main Content Grid */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
                gap: '24px',
                marginBottom: '32px'
              }}>
                {/* Customer Information */}
                <div style={{ 
                  background: 'linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%)', 
                  padding: '24px', 
                  borderRadius: '16px',
                  border: '1px solid #e2e8f0',
                  boxShadow: '0 4px 15px rgba(0,0,0,0.05)'
                }}>
                  <h3 style={{ 
                    fontSize: '16px', 
                    marginBottom: '20px',
                    color: '#374151',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    fontWeight: '700',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                  }}>
                    <User size={16} />
                    Customer Information
                  </h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <div>
                      <label style={{ color: '#6b7280', fontSize: '12px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.5px' }}>NAME</label>
                      <div style={{ fontSize: '16px', fontWeight: '600', color: '#1f2937', marginTop: '4px' }}>
                        {selectedOrder.customerName || 'N/A'}
                      </div>
                    </div>
                    <div>
                      <label style={{ color: '#6b7280', fontSize: '12px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.5px' }}>EMAIL</label>
                      <div style={{ fontSize: '16px', fontWeight: '500', color: '#1f2937', marginTop: '4px' }}>
                        {selectedOrder.customerEmail || selectedOrder.user?.email || 'N/A'}
                      </div>
                    </div>
                    {selectedOrder.customerPhone && (
                      <div>
                        <label style={{ color: '#6b7280', fontSize: '12px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.5px' }}>PHONE</label>
                        <div style={{ fontSize: '16px', fontWeight: '500', color: '#1f2937', marginTop: '4px' }}>
                          {selectedOrder.customerPhone}
                        </div>
                      </div>
                    )}
                    {selectedOrder.user?.id && (
                      <div>
                        <label style={{ color: '#6b7280', fontSize: '12px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.5px' }}>USER ID</label>
                        <div style={{ fontSize: '14px', fontFamily: 'monospace', color: '#6b7280', marginTop: '4px' }}>
                          {selectedOrder.user.id}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Order Information */}
                <div style={{ 
                  background: 'linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%)', 
                  padding: '24px', 
                  borderRadius: '16px',
                  border: '1px solid #bae6fd',
                  boxShadow: '0 4px 15px rgba(0,0,0,0.05)'
                }}>
                  <h3 style={{ 
                    fontSize: '16px', 
                    marginBottom: '20px',
                    color: '#374151',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    fontWeight: '700',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                  }}>
                    <ShoppingCart size={16} />
                    Order Information
                  </h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <div>
                      <label style={{ color: '#6b7280', fontSize: '12px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.5px' }}>PAYMENT STATUS</label>
                      <div style={{ marginTop: '6px' }}>
                        <span style={{
                          display: 'inline-block',
                          padding: '6px 12px',
                          borderRadius: '20px',
                          fontSize: '12px',
                          fontWeight: '600',
                          textTransform: 'uppercase',
                          letterSpacing: '0.5px',
                          background: getPaymentStatusColor(selectedOrder.paymentStatus || selectedOrder.payment_status) === 'success' ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)' :
                                     getPaymentStatusColor(selectedOrder.paymentStatus || selectedOrder.payment_status) === 'warning' ? 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)' :
                                     getPaymentStatusColor(selectedOrder.paymentStatus || selectedOrder.payment_status) === 'danger' ? 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)' :
                                     'linear-gradient(135deg, #6b7280 0%, #4b5563 100%)',
                          color: 'white',
                          boxShadow: '0 2px 8px rgba(0,0,0,0.15)'
                        }}>
                          {(selectedOrder.paymentStatus || selectedOrder.payment_status || 'UNKNOWN').toUpperCase()}
                        </span>
                      </div>
                    </div>
                    <div>
                      <label style={{ color: '#6b7280', fontSize: '12px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.5px' }}>ORDER STATUS</label>
                      <div style={{ marginTop: '6px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <span style={{
                          display: 'inline-block',
                          padding: '6px 12px',
                          borderRadius: '20px',
                          fontSize: '12px',
                          fontWeight: '600',
                          textTransform: 'uppercase',
                          letterSpacing: '0.5px',
                          background: getOrderStatusColor(selectedOrder.statusOrder || selectedOrder.order_status || selectedOrder.status) === 'success' ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)' :
                                     getOrderStatusColor(selectedOrder.statusOrder || selectedOrder.order_status || selectedOrder.status) === 'primary' ? 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)' :
                                     getOrderStatusColor(selectedOrder.statusOrder || selectedOrder.order_status || selectedOrder.status) === 'warning' ? 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)' :
                                     'linear-gradient(135deg, #6b7280 0%, #4b5563 100%)',
                          color: 'white',
                          boxShadow: '0 2px 8px rgba(0,0,0,0.15)'
                        }}>
                          {(selectedOrder.statusOrder || selectedOrder.order_status || selectedOrder.status || 'PENDING').toUpperCase()}
                        </span>
                        <select
                          value={selectedOrder.statusOrder || selectedOrder.order_status || selectedOrder.status || 'pending'}
                          onChange={(e) => updateOrderStatus(selectedOrder.id, e.target.value)}
                          disabled={updatingStatus}
                          style={{
                            padding: '6px 12px',
                            borderRadius: '8px',
                            border: '2px solid #e5e7eb',
                            fontSize: '12px',
                            fontWeight: '600',
                            background: 'white',
                            cursor: updatingStatus ? 'not-allowed' : 'pointer',
                            opacity: updatingStatus ? 0.6 : 1
                          }}
                        >
                          <option value="pending">Pending</option>
                          <option value="processing">Processing</option>
                          <option value="shipped">Shipped</option>
                          <option value="delivered">Delivered</option>
                        </select>
                        {updatingStatus && <span style={{ fontSize: '12px', color: '#6b7280' }}>Updating...</span>}
                      </div>
                    </div>
                    <div>
                      <label style={{ color: '#6b7280', fontSize: '12px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.5px' }}>TOTAL AMOUNT</label>
                      <div style={{ fontSize: '24px', fontWeight: '800', color: '#059669', marginTop: '4px' }}>
                        {formatPrice(selectedOrder.total || 0)}
                      </div>
                    </div>
                    <div>
                      <label style={{ color: '#6b7280', fontSize: '12px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.5px' }}>ORDER DATE</label>
                      <div style={{ fontSize: '16px', fontWeight: '500', color: '#1f2937', marginTop: '4px' }}>
                        {formatDate(selectedOrder.createdAt)}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Payment & Delivery Details */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
                gap: '24px',
                marginBottom: '32px'
              }}>
                {/* Payment Details */}
                <div style={{ 
                  background: 'linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%)', 
                  padding: '24px', 
                  borderRadius: '16px',
                  border: '1px solid #a7f3d0',
                  boxShadow: '0 4px 15px rgba(0,0,0,0.05)'
                }}>
                  <h3 style={{ 
                    fontSize: '16px', 
                    marginBottom: '20px',
                    color: '#065f46',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    fontWeight: '700',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                  }}>
                    <CreditCard size={16} />
                    Payment Details
                  </h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    {selectedOrder.stripeCustomerId && (
                      <div>
                        <label style={{ color: '#065f46', fontSize: '12px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.5px' }}>STRIPE CUSTOMER ID</label>
                        <div style={{ fontSize: '14px', fontFamily: 'monospace', color: '#065f46', wordBreak: 'break-all', marginTop: '4px', background: 'rgba(255,255,255,0.5)', padding: '8px', borderRadius: '8px' }}>
                          {selectedOrder.stripeCustomerId}
                        </div>
                      </div>
                    )}
                    {selectedOrder.stripeSessionId && (
                      <div>
                        <label style={{ color: '#065f46', fontSize: '12px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.5px' }}>STRIPE SESSION ID</label>
                        <div style={{ fontSize: '14px', fontFamily: 'monospace', color: '#065f46', wordBreak: 'break-all', marginTop: '4px', background: 'rgba(255,255,255,0.5)', padding: '8px', borderRadius: '8px' }}>
                          {selectedOrder.stripeSessionId}
                        </div>
                      </div>
                    )}
                    {selectedOrder.paidAt && (
                      <div>
                        <label style={{ color: '#065f46', fontSize: '12px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.5px' }}>PAID AT</label>
                        <div style={{ fontSize: '16px', fontWeight: '600', color: '#065f46', marginTop: '4px' }}>
                          {formatDate(selectedOrder.paidAt)}
                        </div>
                      </div>
                    )}
                    {!selectedOrder.stripeCustomerId && !selectedOrder.stripeSessionId && !selectedOrder.paidAt && (
                      <div style={{ color: '#6b7280', fontStyle: 'italic', textAlign: 'center', padding: '20px' }}>
                        No payment details available
                      </div>
                    )}
                  </div>
                </div>

                {/* Delivery Details */}
                <div style={{ 
                  background: 'linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%)', 
                  padding: '24px', 
                  borderRadius: '16px',
                  border: '1px solid #fde68a',
                  boxShadow: '0 4px 15px rgba(0,0,0,0.05)'
                }}>
                  <h3 style={{ 
                    fontSize: '16px', 
                    marginBottom: '20px',
                    color: '#92400e',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    fontWeight: '700',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                  }}>
                    <Truck size={16} />
                    Delivery Details
                  </h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    {(selectedOrder.shippingAddress || selectedOrder.deliveryAddress) ? (
                      <div>
                        <label style={{ color: '#92400e', fontSize: '12px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.5px' }}>SHIPPING ADDRESS</label>
                        <div style={{ fontSize: '14px', color: '#92400e', whiteSpace: 'pre-line', marginTop: '4px', background: 'rgba(255,255,255,0.5)', padding: '12px', borderRadius: '8px' }}>
                          {(() => {
                            const addressData = selectedOrder.shippingAddress || selectedOrder.deliveryAddress;
                            console.log('🚨 SHIPPING ADDRESS DEBUG:', addressData);
                            console.log('🚨 SHIPPING ADDRESS TYPE:', typeof addressData);
                            const result = formatAddress(addressData);
                            console.log('🚨 SHIPPING ADDRESS RESULT:', result);
                            return result;
                          })()}
                        </div>
                      </div>
                    ) : (
                      <div style={{ color: '#6b7280', fontStyle: 'italic', textAlign: 'center', padding: '20px' }}>
                        No delivery address provided
                      </div>
                    )}
                    {selectedOrder.postcode && (
                      <div>
                        <label style={{ color: '#92400e', fontSize: '12px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.5px' }}>POSTCODE</label>
                        <div style={{ fontSize: '14px', fontWeight: '600', color: '#92400e', marginTop: '4px', background: 'rgba(255,255,255,0.5)', padding: '8px', borderRadius: '8px' }}>
                          {selectedOrder.postcode}
                        </div>
                      </div>
                    )}
                    {selectedOrder.deliveryNotes && (
                      <div>
                        <label style={{ color: '#92400e', fontSize: '12px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.5px' }}>DELIVERY NOTES</label>
                        <div style={{ fontSize: '14px', color: '#92400e', marginTop: '4px', background: 'rgba(255,255,255,0.5)', padding: '12px', borderRadius: '8px' }}>
                          {selectedOrder.deliveryNotes}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Billing Address */}
              {selectedOrder.billingAddress && (
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
                  gap: '24px',
                  marginBottom: '32px'
                }}>
                  <div style={{ 
                    background: 'linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%)', 
                    padding: '24px', 
                    borderRadius: '16px',
                    border: '1px solid #0ea5e9',
                    boxShadow: '0 4px 15px rgba(0,0,0,0.05)'
                  }}>
                    <h3 style={{ 
                      fontSize: '16px', 
                      marginBottom: '20px',
                      color: '#0c4a6e',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      fontWeight: '700',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px'
                    }}>
                      <CreditCard size={16} />
                      Billing Address
                    </h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                      <div>
                        <label style={{ color: '#0c4a6e', fontSize: '12px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.5px' }}>BILLING ADDRESS</label>
                        <div style={{ fontSize: '14px', color: '#0c4a6e', whiteSpace: 'pre-line', marginTop: '4px', background: 'rgba(255,255,255,0.5)', padding: '12px', borderRadius: '8px' }}>
                          {(() => {
                            console.log('🚨 BILLING ADDRESS DEBUG:', selectedOrder.billingAddress);
                            console.log('🚨 BILLING ADDRESS TYPE:', typeof selectedOrder.billingAddress);
                            const result = formatAddress(selectedOrder.billingAddress);
                            console.log('🚨 BILLING ADDRESS RESULT:', result);
                            return result;
                          })()}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Order Items */}
              {selectedOrder.orderItems && (
                <div style={{ 
                  background: 'linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%)', 
                  padding: '24px', 
                  borderRadius: '16px',
                  border: '1px solid #e2e8f0',
                  boxShadow: '0 4px 15px rgba(0,0,0,0.05)'
                }}>
                  <h3 style={{ 
                    fontSize: '16px', 
                    marginBottom: '20px',
                    color: '#374151',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    fontWeight: '700',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                  }}>
                    <Package size={16} />
                    Order Items
                  </h3>
                  
                  {(() => {
                    // Parse orderItems if it's a string
                    let orderItems = selectedOrder.orderItems;
                    if (typeof orderItems === 'string') {
                      try {
                        orderItems = JSON.parse(orderItems);
                      } catch (e) {
                        console.error('Error parsing orderItems JSON:', e);
                        orderItems = [];
                      }
                    }
                    
                    return Array.isArray(orderItems) ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                      {orderItems.map((item, index) => (
                        <div key={index} style={{
                          background: 'white',
                          padding: '24px',
                          borderRadius: '16px',
                          border: '1px solid #e5e7eb',
                          boxShadow: '0 4px 15px rgba(0,0,0,0.08)',
                          transition: 'all 0.3s ease'
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.transform = 'translateY(-4px)';
                          e.currentTarget.style.boxShadow = '0 8px 25px rgba(0,0,0,0.15)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.transform = 'translateY(0)';
                          e.currentTarget.style.boxShadow = '0 4px 15px rgba(0,0,0,0.08)';
                        }}>
                          {/* Item Header with Image */}
                          <div style={{ 
                            display: 'flex', 
                            gap: '20px',
                            marginBottom: '24px',
                            paddingBottom: '16px',
                            borderBottom: '2px solid #f1f5f9'
                          }}>
                            {/* Product Image */}
                            {(item.image || item.fabric?.image) && (
                              <div style={{
                                width: '120px',
                                height: '120px',
                                borderRadius: '12px',
                                overflow: 'hidden',
                                flexShrink: 0,
                                background: '#f8fafc',
                                border: '2px solid #e5e7eb'
                              }}>
                                <img 
                                  src={(() => {
                                    const imageUrl = item.image || item.fabric?.image;
                                    // Convert external URLs to local URLs to avoid CSP issues
                                    if (imageUrl && imageUrl.includes('celebrated-feast-8b6e91b21c.media.strapiapp.com')) {
                                      // Extract filename from external URL and convert to local path
                                      const filename = imageUrl.split('/').pop();
                                      return `/uploads/${filename}`;
                                    }
                                    return imageUrl;
                                  })()} 
                                  alt={item.name || 'Product'}
                                  style={{
                                    width: '100%',
                                    height: '100%',
                                    objectFit: 'cover'
                                  }}
                                  onError={(e) => {
                                    e.target.style.display = 'none';
                                    e.target.parentElement.innerHTML = '<div style="display: flex; align-items: center; justify-content: center; height: 100%; color: #6b7280; font-size: 12px;">No Image</div>';
                                  }}
                                />
                              </div>
                            )}
                            
                            {/* Product Info */}
                            <div style={{ flex: 1 }}>
                              <h4 style={{ 
                                fontSize: '20px', 
                                fontWeight: '800', 
                                marginBottom: '8px', 
                                color: '#1f2937',
                                background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                                WebkitBackgroundClip: 'text',
                                WebkitTextFillColor: 'transparent'
                              }}>
                                {item.name || `Item ${index + 1}`}
                              </h4>
                              
                              {/* Product Type & Category */}
                              <div style={{ display: 'flex', gap: '12px', marginBottom: '8px' }}>
                                {item.category && (
                                  <span style={{
                                    display: 'inline-block',
                                    padding: '4px 8px',
                                    borderRadius: '12px',
                                    fontSize: '11px',
                                    fontWeight: '600',
                                    textTransform: 'uppercase',
                                    letterSpacing: '0.5px',
                                    background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
                                    color: 'white'
                                  }}>
                                    {item.category}
                                  </span>
                                )}
                                {item.productType && (
                                  <span style={{
                                    display: 'inline-block',
                                    padding: '4px 8px',
                                    borderRadius: '12px',
                                    fontSize: '11px',
                                    fontWeight: '600',
                                    textTransform: 'uppercase',
                                    letterSpacing: '0.5px',
                                    background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                                    color: 'white'
                                  }}>
                                    {item.productType}
                                  </span>
                                )}
                                {item.isMadeToMeasure && (
                                  <span style={{
                                    display: 'inline-block',
                                    padding: '4px 8px',
                                    borderRadius: '12px',
                                    fontSize: '11px',
                                    fontWeight: '600',
                                    textTransform: 'uppercase',
                                    letterSpacing: '0.5px',
                                    background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                                    color: 'white'
                                  }}>
                                    Made to Measure
                                  </span>
                                )}
                              </div>
                              
                              {/* Price */}
                              <div style={{ 
                                fontSize: '24px', 
                                fontWeight: '800', 
                                color: '#059669',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px'
                              }}>
                                {formatPrice(item.totalPrice || 0)}
                                {item.quantity && item.pricePerUnit && (
                                  <span style={{ 
                                    fontSize: '14px', 
                                    fontWeight: '500', 
                                    color: '#6b7280' 
                                  }}>
                                    ({item.quantity} × {formatPrice(item.pricePerUnit)})
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Main Content Grid */}
                          <div style={{ 
                            display: 'grid', 
                            gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', 
                            gap: '20px',
                            marginBottom: '20px'
                          }}>
                            {/* Fabric Information */}
                            {item.fabric && (
                              <div style={{ 
                                background: 'linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)',
                                padding: '16px',
                                borderRadius: '12px',
                                border: '1px solid #f59e0b'
                              }}>
                                <h5 style={{ 
                                  fontSize: '14px', 
                                  fontWeight: '700', 
                                  color: '#92400e', 
                                  marginBottom: '12px',
                                  textTransform: 'uppercase',
                                  letterSpacing: '0.5px',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '6px'
                                }}>
                                  <Scissors size={14} />
                                  Fabric Details
                                </h5>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                  {item.fabric.brand && (
                                    <div>
                                      <label style={{ color: '#92400e', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Brand</label>
                                      <div style={{ fontSize: '14px', fontWeight: '600', color: '#92400e' }}>{item.fabric.brand}</div>
                                    </div>
                                  )}
                                  {item.fabric.color && (
                                    <div>
                                      <label style={{ color: '#92400e', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Color</label>
                                      <div style={{ fontSize: '14px', fontWeight: '600', color: '#92400e' }}>{item.fabric.color}</div>
                                    </div>
                                  )}
                                  {item.fabric.pattern && (
                                    <div>
                                      <label style={{ color: '#92400e', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Pattern</label>
                                      <div style={{ fontSize: '14px', fontWeight: '600', color: '#92400e' }}>{item.fabric.pattern}</div>
                                    </div>
                                  )}
                                  {item.fabric.collection && (
                                    <div>
                                      <label style={{ color: '#92400e', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Collection</label>
                                      <div style={{ fontSize: '14px', fontWeight: '600', color: '#92400e' }}>{item.fabric.collection}</div>
                                    </div>
                                  )}
                                  {item.fabric.composition && (
                                    <div>
                                      <label style={{ color: '#92400e', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Composition</label>
                                      <div style={{ fontSize: '14px', fontWeight: '600', color: '#92400e' }}>{item.fabric.composition}</div>
                                    </div>
                                  )}
                                  {item.fabric.pricePerMetre && (
                                    <div>
                                      <label style={{ color: '#92400e', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Price per Metre</label>
                                      <div style={{ fontSize: '14px', fontWeight: '600', color: '#92400e' }}>{formatPrice(item.fabric.pricePerMetre)}</div>
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}

                            {/* Measurements */}
                            {item.measurements && (
                              (() => {
                                console.log(`🔍 Measurements for item ${index}:`, item.measurements);
                                console.log(`🔍 Is made to measure:`, item.isMadeToMeasure);
                                return null;
                              })()
                            )}
                            {item.measurements && (
                              <div style={{ 
                                background: 'linear-gradient(135deg, #dbeafe 0%, #bfdbfe 100%)',
                                padding: '16px',
                                borderRadius: '12px',
                                border: '1px solid #3b82f6'
                              }}>
                                <h5 style={{ 
                                  fontSize: '14px', 
                                  fontWeight: '700', 
                                  color: '#1e40af', 
                                  marginBottom: '12px',
                                  textTransform: 'uppercase',
                                  letterSpacing: '0.5px',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '6px'
                                }}>
                                  <Ruler size={14} />
                                  Measurements {item.isMadeToMeasure && <span style={{ fontSize: '10px', color: '#dc2626', fontWeight: '600' }}>(Made to Measure)</span>}
                                </h5>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                  {item.measurements.width && (
                                    <div>
                                      <label style={{ color: '#1e40af', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Width</label>
                                      <div style={{ fontSize: '14px', fontWeight: '600', color: '#1e40af' }}>
                                        {formatMeasurement(item.measurements.width, item.measurements.widthUnit)}
                                      </div>
                                    </div>
                                  )}
                                  {item.measurements.height && (
                                    <div>
                                      <label style={{ color: '#1e40af', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Height</label>
                                      <div style={{ fontSize: '14px', fontWeight: '600', color: '#1e40af' }}>
                                        {formatMeasurement(item.measurements.height, item.measurements.heightUnit)}
                                      </div>
                                    </div>
                                  )}
                                  {item.measurements.length && (
                                    <div>
                                      <label style={{ color: '#1e40af', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Length</label>
                                      <div style={{ fontSize: '14px', fontWeight: '600', color: '#1e40af' }}>
                                        {formatMeasurement(item.measurements.length, item.measurements.lengthUnit)}
                                      </div>
                                    </div>
                                  )}
                                  {item.measurements.totalFabric && (
                                    <div>
                                      <label style={{ color: '#1e40af', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Total Fabric</label>
                                      <div style={{ fontSize: '14px', fontWeight: '600', color: '#1e40af' }}>
                                        {formatMeasurement(item.measurements.totalFabric, item.measurements.totalFabricUnit || 'metres')}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}

                            {/* Product Configuration */}
                            {(item.curtainOption || item.curtainType || item.blindType || item.cushionType) && (
                              <div style={{ 
                                background: 'linear-gradient(135deg, #f3e8ff 0%, #e9d5ff 100%)',
                                padding: '16px',
                                borderRadius: '12px',
                                border: '1px solid #7c3aed'
                              }}>
                                <h5 style={{ 
                                  fontSize: '14px', 
                                  fontWeight: '700', 
                                  color: '#7c3aed', 
                                  marginBottom: '12px',
                                  textTransform: 'uppercase',
                                  letterSpacing: '0.5px',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '6px'
                                }}>
                                  <Settings size={14} />
                                  Configuration
                                </h5>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                  {item.curtainOption && (
                                    <div>
                                      <label style={{ color: '#7c3aed', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Curtain Option</label>
                                      <div style={{ fontSize: '14px', fontWeight: '600', color: '#7c3aed' }}>{item.curtainOption}</div>
                                    </div>
                                  )}
                                  {item.curtainType && (
                                    <div>
                                      <label style={{ color: '#7c3aed', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Curtain Type</label>
                                      <div style={{ fontSize: '14px', fontWeight: '600', color: '#7c3aed' }}>{item.curtainType}</div>
                                    </div>
                                  )}
                                  {item.blindType && (
                                    <div>
                                      <label style={{ color: '#7c3aed', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Blind Type</label>
                                      <div style={{ fontSize: '14px', fontWeight: '600', color: '#7c3aed' }}>{item.blindType}</div>
                                    </div>
                                  )}
                                  {item.cushionType && (
                                    <div>
                                      <label style={{ color: '#7c3aed', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Cushion Type</label>
                                      <div style={{ fontSize: '14px', fontWeight: '600', color: '#7c3aed' }}>{item.cushionType}</div>
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>

                          {/* Accessories */}
                          {item.accessories && (item.accessories.linings?.length > 0 || item.accessories.trimmings?.length > 0 || item.accessories.mechanisations?.length > 0) && (
                            <div style={{ 
                              background: 'linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%)',
                              padding: '16px',
                              borderRadius: '12px',
                              border: '1px solid #10b981',
                              marginBottom: '20px'
                            }}>
                              <h5 style={{ 
                                fontSize: '14px', 
                                fontWeight: '700', 
                                color: '#065f46', 
                                marginBottom: '12px',
                                textTransform: 'uppercase',
                                letterSpacing: '0.5px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px'
                              }}>
                                <Palette size={14} />
                                Accessories
                              </h5>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                {item.accessories.linings?.length > 0 && (
                                  <div>
                                    <label style={{ color: '#065f46', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Linings</label>
                                    <div style={{ fontSize: '14px', fontWeight: '500', color: '#065f46' }}>
                                      {item.accessories.linings.map((lining, idx) => (
                                        <span key={idx} style={{
                                          display: 'inline-block',
                                          background: 'rgba(255,255,255,0.7)',
                                          padding: '4px 8px',
                                          borderRadius: '6px',
                                          margin: '2px',
                                          fontSize: '12px'
                                        }}>
                                          {typeof lining === 'object' ? lining.name || JSON.stringify(lining) : lining}
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                )}
                                {item.accessories.trimmings?.length > 0 && (
                                  <div>
                                    <label style={{ color: '#065f46', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Trimmings</label>
                                    <div style={{ fontSize: '14px', fontWeight: '500', color: '#065f46' }}>
                                      {item.accessories.trimmings.map((trimming, idx) => (
                                        <span key={idx} style={{
                                          display: 'inline-block',
                                          background: 'rgba(255,255,255,0.7)',
                                          padding: '4px 8px',
                                          borderRadius: '6px',
                                          margin: '2px',
                                          fontSize: '12px'
                                        }}>
                                          {typeof trimming === 'object' ? trimming.name || JSON.stringify(trimming) : trimming}
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                )}
                                {item.accessories.mechanisations?.length > 0 && (
                                  <div>
                                    <label style={{ color: '#065f46', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Mechanisations</label>
                                    <div style={{ fontSize: '14px', fontWeight: '500', color: '#065f46' }}>
                                      {item.accessories.mechanisations.map((mechanisation, idx) => (
                                        <span key={idx} style={{
                                          display: 'inline-block',
                                          background: 'rgba(255,255,255,0.7)',
                                          padding: '4px 8px',
                                          borderRadius: '6px',
                                          margin: '2px',
                                          fontSize: '12px'
                                        }}>
                                          {typeof mechanisation === 'object' ? mechanisation.name || JSON.stringify(mechanisation) : mechanisation}
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}

                          {/* Notes and Instructions */}
                          {(item.orderNotes || item.specialInstructions || item.notes) && (
                            <div style={{ 
                              background: 'linear-gradient(135deg, #fef2f2 0%, #fecaca 100%)',
                              padding: '16px',
                              borderRadius: '12px',
                              border: '1px solid #ef4444'
                            }}>
                              <h5 style={{ 
                                fontSize: '14px', 
                                fontWeight: '700', 
                                color: '#dc2626', 
                                marginBottom: '12px',
                                textTransform: 'uppercase',
                                letterSpacing: '0.5px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px'
                              }}>
                                <FileText size={14} />
                                Notes & Instructions
                              </h5>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                {item.orderNotes && (
                                  <div>
                                    <label style={{ color: '#dc2626', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Order Notes</label>
                                    <div style={{ fontSize: '14px', fontWeight: '500', color: '#dc2626', whiteSpace: 'pre-wrap' }}>{item.orderNotes}</div>
                                  </div>
                                )}
                                {item.specialInstructions && (
                                  <div>
                                    <label style={{ color: '#dc2626', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Special Instructions</label>
                                    <div style={{ fontSize: '14px', fontWeight: '500', color: '#dc2626', whiteSpace: 'pre-wrap' }}>{item.specialInstructions}</div>
                                  </div>
                                )}
                                {item.notes && (
                                  <div>
                                    <label style={{ color: '#dc2626', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>General Notes</label>
                                    <div style={{ fontSize: '14px', fontWeight: '500', color: '#dc2626', whiteSpace: 'pre-wrap' }}>{item.notes}</div>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{
                      background: 'white',
                      padding: '24px',
                      borderRadius: '12px',
                      border: '1px solid #e5e7eb',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
                      textAlign: 'center'
                    }}>
                      <div style={{ fontSize: '48px', marginBottom: '16px', display: 'flex', justifyContent: 'center' }}>
                        <Package size={48} />
                      </div>
                      <h4 style={{ fontSize: '16px', color: '#6b7280', marginBottom: '8px', fontWeight: '600' }}>
                        No Order Items Found
                      </h4>
                      <p style={{ fontSize: '14px', color: '#9ca3af' }}>
                        This order doesn't contain any items or the data format is invalid.
                      </p>
                    </div>
                  );
                  })()}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}