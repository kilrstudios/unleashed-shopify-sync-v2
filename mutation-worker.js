/**
 * Mutation Worker - Dedicated worker for processing queue messages
 * This worker handles one mutation per request to avoid subrequest limits
 */

import { handleProductQueueMessage, handleInventoryUpdate, handleImageUpdate } from './src/product-mutations.js';
import { handleLocationQueueMessage } from './src/location-mutations.js';
import { handleCustomerQueueMessage } from './src/customer-mutations.js';
import { pullAllData } from './src/data_pull.js';
import { mapLocations } from './src/location-mapping.js';
import { mapCustomers } from './src/customer-mapping.js';
import { mapProducts } from './src/product-mapping.js';
import { mutateLocationsViaQueue } from './src/location-mutations.js';
import { mutateCustomersViaQueue } from './src/customer-mutations.js';
import { mutateProductsViaQueue } from './src/product-mutations.js';
import { getDefaultWarehouseCode } from './src/helpers.js';

// CORS headers for all responses
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept, Accept-Encoding, Accept-Language, Content-Length, Origin, Referer, User-Agent, X-Forwarded-Proto',
  'Access-Control-Max-Age': '86400', // 24 hours cache for preflight
};

// Helper function to create JSON responses
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}

// Log verbosity helper
function applyLogVerbosity(env) {
  const logLevel = env.LOG_LEVEL || 'info';
  if (logLevel === 'debug') {
    console.log('[MUTATION-WORKER] Debug logging enabled');
  } else if (logLevel === 'minimal') {
    // Override console.log for minimal logging
    console.log = () => {};
  }
}

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

/**
 * Handle comprehensive sync queue message
 * This performs the full sync workflow in the background
 */
async function handleComprehensiveSyncQueueMessage(messageBody, env) {
  const { syncId, domain } = messageBody;
  const startTime = Date.now();
  
  try {
    console.log(`🚀 [QUEUE] Starting comprehensive sync workflow for ${domain} (ID: ${syncId})`);

    // Get authentication data
    const authData = await getAuthData(env, domain);
    if (!authData || !authData.unleashed || !authData.shopify) {
      throw new Error('Invalid authentication data structure');
    }

    // STEP 1: Data Fetching
    console.log('📊 [QUEUE] Step 1: Fetching data from Unleashed and Shopify...');
    const dataFetchStart = Date.now();
    const data = await pullAllData(domain, env);
    const dataFetchDuration = ((Date.now() - dataFetchStart) / 1000).toFixed(2);
    console.log(`✅ [QUEUE] Data fetch completed in ${dataFetchDuration}s:`, {
      unleashed: {
        warehouses: data.unleashed.warehouses.length,
        customers: data.unleashed.customers.length,
        products: data.unleashed.products.length
      },
      shopify: {
        locations: data.shopify.locations.length,
        customers: data.shopify.customers.length,
        products: data.shopify.products.length
      }
    });

    // STEP 2: Location Sync
    console.log('🏢 [QUEUE] Step 2: Location Sync...');
    const locationStart = Date.now();
    const locationMappingResults = await mapLocations(data.unleashed.warehouses, data.shopify.locations);
    const locationMutationResults = await mutateLocationsViaQueue(env, authData.shopify.shopDomain, locationMappingResults, domain);
    const locationDuration = ((Date.now() - locationStart) / 1000).toFixed(2);
    console.log(`✅ [QUEUE] Location sync completed in ${locationDuration}s:`, locationMutationResults.summary);

    // STEP 3: Customer Sync
    console.log('👥 [QUEUE] Step 3: Customer Sync...');
    const customerStart = Date.now();
    const customerMappingResults = await mapCustomers(data.unleashed.contacts, data.unleashed.customers, data.shopify.customers);
    const customerMutationResults = await mutateCustomersViaQueue(env, authData.shopify.shopDomain, customerMappingResults, domain);
    const customerDuration = ((Date.now() - customerStart) / 1000).toFixed(2);
    console.log(`✅ [QUEUE] Customer sync completed in ${customerDuration}s:`, customerMutationResults.summary);

    // STEP 4: Product Sync
    console.log('📦 [QUEUE] Step 4: Product Sync...');
    const productStart = Date.now();
    const defaultWarehouseCode = getDefaultWarehouseCode(data.unleashed.warehouses);
    const productMappingResults = await mapProducts(
      data.unleashed.products,
      data.shopify.products,
      data.shopify.locations,
      defaultWarehouseCode
    );
    const productMutationResults = await mutateProductsViaQueue(env, authData.shopify, productMappingResults, domain);
    const productDuration = ((Date.now() - productStart) / 1000).toFixed(2);
    console.log(`✅ [QUEUE] Product sync completed in ${productDuration}s:`, productMutationResults.summary);

    // STEP 5: Post-sync operations (images, inventory) will be handled by individual queue messages

    const totalDuration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`🎉 [QUEUE] Comprehensive sync completed successfully in ${totalDuration}s for ${domain} (ID: ${syncId})`);
    
    return {
      success: true,
      syncId,
      domain,
      totalDuration: `${totalDuration}s`,
      steps: {
        dataFetch: { duration: `${dataFetchDuration}s`, status: 'completed' },
        locationSync: { duration: `${locationDuration}s`, status: 'completed', ...locationMutationResults.summary },
        customerSync: { duration: `${customerDuration}s`, status: 'completed', ...customerMutationResults.summary },
        productSync: { duration: `${productDuration}s`, status: 'completed', ...productMutationResults.summary }
      }
    };

  } catch (error) {
    const totalDuration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.error(`❌ [QUEUE] Comprehensive sync failed after ${totalDuration}s for ${domain} (ID: ${syncId}):`, error);
    
    return {
      success: false,
      syncId,
      domain,
      error: error.message,
      totalDuration: `${totalDuration}s`
    };
  }
}

export default {
  async fetch(request, env, ctx) {
    // Apply log verbosity setting for this request
    applyLogVerbosity(env);

    // Handle CORS preflight requests
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders
      });
    }

    const url = new URL(request.url);
    
    // Health check endpoint
    if (url.pathname === '/health' && request.method === 'GET') {
      return jsonResponse({ 
        status: 'healthy',
        worker: 'mutation-worker',
        timestamp: new Date().toISOString()
      });
    }

    // All other requests should be handled by queue processing
    return jsonResponse({ 
      error: 'This worker only processes queue messages',
      details: 'Use the queue system to send mutations to this worker'
    }, 400);
  },

  /**
   * Queue consumer for processing mutations
   */
  async queue(batch, env) {
    console.log(`🔄 [MUTATION-WORKER] Processing batch of ${batch.messages.length} queue messages`);
    
    const results = {
      processed: 0,
      successful: 0,
      failed: 0,
      errors: []
    };

    // Process each message in the batch
    for (const message of batch.messages) {
      try {
        console.log(`📨 [MUTATION-WORKER] Processing message: ${message.body.type}`);
        
        let result;
        
        // Route message to appropriate handler based on type
        switch (message.body.type) {
          case 'comprehensive_sync':
            result = await handleComprehensiveSyncQueueMessage(message.body, env);
            break;
            
          case 'CREATE_PRODUCT':
          case 'UPDATE_PRODUCT':
          case 'ARCHIVE_PRODUCT':
            result = await handleProductQueueMessage(message.body, env);
            break;
            
          case 'UPDATE_INVENTORY':
            result = await handleInventoryUpdate(message.body, env);
            break;
            
          case 'UPDATE_IMAGE':
            result = await handleImageUpdate(message.body, env);
            break;
            
          case 'CREATE_LOCATION':
          case 'UPDATE_LOCATION':
            result = await handleLocationQueueMessage(message.body, env);
            break;
            
          case 'CREATE_CUSTOMER':
          case 'UPDATE_CUSTOMER':
            result = await handleCustomerQueueMessage(message.body, env);
            break;
            
          default:
            throw new Error(`Unknown message type: ${message.body.type}`);
        }
        
        if (result.success) {
          results.successful++;
          console.log(`✅ [MUTATION-WORKER] Successfully processed ${message.body.type}`);
        } else {
          results.failed++;
          results.errors.push({
            messageType: message.body.type,
            error: result.error
          });
          console.error(`❌ [MUTATION-WORKER] Failed to process ${message.body.type}: ${result.error}`);
        }
        
        // Acknowledge the message
        message.ack();
        
      } catch (error) {
        console.error(`🚨 [MUTATION-WORKER] Error processing message:`, error);
        results.failed++;
        results.errors.push({
          messageType: message.body?.type || 'unknown',
          error: error.message
        });
        
        // Retry the message (don't ack it)
        message.retry();
      }
      
      results.processed++;
    }
    
    console.log(`📊 [MUTATION-WORKER] Batch processing complete:`, {
      processed: results.processed,
      successful: results.successful,
      failed: results.failed,
      errorCount: results.errors.length
    });
    
    return results;
  }
}; 