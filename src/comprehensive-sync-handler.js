/**
 * Comprehensive Sync Handler
 * Handles complete sync workflow for locations, customers, and products in optimal sequence
 */

import { getDefaultWarehouseCode } from './helpers.js';

// Helper function to get auth data from KV store
async function getAuthData(env, domain) {
  if (!env.AUTH_STORE) {
    throw new Error('KV binding AUTH_STORE not found');
  }
  
  try {
    const authString = await env.AUTH_STORE.get(domain);
    if (!authString) {
      throw new Error(`No authentication data found for domain: ${domain}`);
    }
    return JSON.parse(authString);
  } catch (error) {
    console.error('Error getting auth data:', error);
    throw new Error(`Failed to get authentication data: ${error.message}`);
  }
}

// Helper function to create JSON responses
function jsonResponse(data, status = 200) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept, Accept-Encoding, Accept-Language, Content-Length, Origin, Referer, User-Agent, X-Forwarded-Proto',
    'Access-Control-Max-Age': '86400', // 24 hours cache for preflight
  };

  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}

/**
 * Streamlined Comprehensive Sync: Queue-First Approach
 * This approach queues the sync work immediately and returns a response
 * without waiting for completion to avoid Worker timeout issues
 */
export async function handleComprehensiveSync(request, env) {
  const startTime = Date.now();
  
  try {
    // Get domain from request
    let domain = null;
    
    try {
      const rawBody = await request.text();
      if (!rawBody) {
        return jsonResponse({ 
          error: 'Empty request body',
          details: 'Request body is required and must contain a domain.'
        }, 400);
      }
      
      const requestBody = JSON.parse(rawBody);
      domain = requestBody.domain;
      
      if (!domain) {
        return jsonResponse({ 
          error: 'Domain is required',
          details: 'The request body must contain a domain field.'
        }, 400);
      }
    } catch (error) {
      return jsonResponse({ 
        error: 'Invalid request body',
        details: error.message
      }, 400);
    }

    // Clean the domain (remove protocol and path)
    domain = domain.replace(/^https?:\/\//, '').split('/')[0];

    console.log(`🚀 Starting streamlined comprehensive sync for domain: ${domain}`);

    // Validate authentication data exists
    const authData = await getAuthData(env, domain);
    if (!authData || !authData.unleashed || !authData.shopify) {
      throw new Error('Invalid authentication data structure');
    }

    // Generate a unique sync ID for tracking
    const syncId = `sync_${domain}_${Date.now()}`;

    // Queue the comprehensive sync work
    const queueMessage = {
      type: 'comprehensive_sync',
      syncId,
      domain,
      timestamp: new Date().toISOString(),
      priority: 'high'
    };

    console.log(`📋 Queuing comprehensive sync work with ID: ${syncId}`);
    
    // Add to queue for background processing
    await env.SYNC_QUEUE.send(queueMessage);

    // Return immediate response
    const response = {
      success: true,
      syncId,
      domain,
      status: 'queued',
      message: 'Comprehensive sync has been queued for background processing',
      workflow: 'comprehensive_sync_queued',
      timestamp: new Date().toISOString(),
      estimatedDuration: '3-5 minutes',
      queuePosition: 'Processing will begin shortly',
      steps: {
        dataFetch: { status: 'queued', description: 'Fetch data from Unleashed and Shopify' },
        locationSync: { status: 'queued', description: 'Sync warehouses to Shopify locations' },
        customerSync: { status: 'queued', description: 'Sync contacts to Shopify customers' },
        productSync: { status: 'queued', description: 'Sync products with bulk operations' },
        postSync: { status: 'queued', description: 'Update inventory and process images' }
      },
      monitoring: {
        checkStatus: `Monitor queue processing in Worker logs`,
        expectedCompletion: new Date(Date.now() + 5 * 60 * 1000).toISOString()
      }
    };

    console.log(`✅ Comprehensive sync queued successfully: ${syncId}`);
    return jsonResponse(response);

  } catch (error) {
    console.error('❌ Error queuing comprehensive sync:', error);
    
    return jsonResponse({
      success: false,
      error: 'Failed to queue comprehensive sync',
      details: error.message,
      timestamp: new Date().toISOString()
    }, 500);
  }
}

/**
 * Optimized Sync Handler (alternative approach)
 * This performs minimal essential operations quickly
 */
export async function handleOptimizedSync(request, env) {
  const startTime = Date.now();
  
  try {
    // Get domain from request
    let domain = null;
    
    try {
      const rawBody = await request.text();
      if (!rawBody) {
        return jsonResponse({ 
          error: 'Empty request body',
          details: 'Request body is required and must contain a domain.'
        }, 400);
      }
      
      const requestBody = JSON.parse(rawBody);
      domain = requestBody.domain;
      
      if (!domain) {
        return jsonResponse({ 
          error: 'Domain is required',
          details: 'The request body must contain a domain field.'
        }, 400);
      }
    } catch (error) {
      return jsonResponse({ 
        error: 'Invalid request body',
        details: error.message
      }, 400);
    }

    // Clean the domain (remove protocol and path)
    domain = domain.replace(/^https?:\/\//, '').split('/')[0];

    console.log(`⚡ Starting optimized sync workflow for domain: ${domain}`);

    // Get authentication data from KV store
    const authData = await getAuthData(env, domain);
    
    if (!authData || !authData.unleashed || !authData.shopify) {
      throw new Error('Invalid authentication data structure');
    }

    // Quick data sample (first 10 products only for validation)
    console.log('📊 Fetching data sample for validation...');
    const { pullAllData } = await import('./data_pull.js');
    const sampleData = await pullAllData(domain, env);

    const results = {
      success: true,
      domain,
      workflow: 'optimized_sync',
      message: 'Sample data fetched successfully. Use comprehensive sync for full processing.',
      startTime: new Date(startTime).toISOString(),
      dataSample: {
        unleashed: {
          warehouses: sampleData.unleashed.warehouses.length,
          customers: sampleData.unleashed.customers.length,
          products: sampleData.unleashed.products.length
        },
        shopify: {
          locations: sampleData.shopify.locations.length,
          customers: sampleData.shopify.customers.length,
          products: sampleData.shopify.products.length
        }
      },
      recommendation: {
        message: 'Use comprehensive sync for full processing of all records',
        endpoint: '/api/v2/comprehensive-sync',
        expectedDuration: '3-5 minutes via queue processing'
      },
      duration: `${((Date.now() - startTime) / 1000).toFixed(2)}s`,
      timestamp: new Date().toISOString()
    };

    console.log('✅ Optimized sync completed successfully');
    return jsonResponse(results);

  } catch (error) {
    console.error('❌ Optimized sync failed:', error);
    
    return jsonResponse({
      success: false,
      error: 'Optimized sync failed',
      details: error.message,
      timestamp: new Date().toISOString()
    }, 500);
  }
} 