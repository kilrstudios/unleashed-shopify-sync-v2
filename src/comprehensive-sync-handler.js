/**
 * Comprehensive Sync Handler
 * Handles complete sync workflow for locations, customers, and products in optimal sequence
 */

import { pullAllData } from './data_pull.js';
import { getDefaultWarehouseCode } from './helpers.js';
import { mapLocations } from './location-mapping.js';
import { mapCustomers } from './customer-mapping.js';
import { mapProducts } from './product-mapping.js';
import { mutateLocationsViaQueue } from './location-mutations.js';
import { mutateCustomersViaQueue } from './customer-mutations.js';
import { mutateProductsViaQueue } from './product-mutations.js';

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
 * Complete sync workflow: Locations first, then Customers, then Products
 * This approach ensures warehouses/locations are set up before customer and product operations
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

    console.log(`🚀 Starting comprehensive sync workflow for domain: ${domain}`);

    // Get authentication data from KV store
    const authData = await getAuthData(env, domain);
    
    if (!authData || !authData.unleashed || !authData.shopify) {
      throw new Error('Invalid authentication data structure');
    }

    const results = {
      success: true,
      domain,
      workflow: 'comprehensive_sync',
      startTime: new Date(startTime).toISOString(),
      steps: {},
      summary: {
        totalOperations: 0,
        successfulOperations: 0,
        failedOperations: 0,
        duration: null
      },
      timestamp: new Date().toISOString()
    };

    // ========================================
    // STEP 1: DATA FETCHING
    // ========================================
    console.log('📊 Step 1: Fetching data from Unleashed and Shopify...');
    const stepStart = Date.now();
    
    try {
      const data = await pullAllData(domain, env);
      
      results.steps.dataFetch = {
        success: true,
        duration: `${((Date.now() - stepStart) / 1000).toFixed(2)}s`,
        data: {
          unleashed: {
            warehouses: data.unleashed.warehouses.length,
            customers: data.unleashed.customers.length,
            contacts: data.unleashed.contacts.length,
            products: data.unleashed.products.length
          },
          shopify: {
            locations: data.shopify.locations.length,
            customers: data.shopify.customers.length,
            products: data.shopify.products.length
          }
        },
        // Include raw datasets for debugging/inspection (can be omitted in production)
        raw: {
          unleashed: data.unleashed,
          shopify: data.shopify
        }
      };
      
      console.log('✅ Data fetch completed:', results.steps.dataFetch.data);
      
      // ========================================
      // STEP 2: LOCATION SYNC (Warehouses → Locations)
      // ========================================
      console.log('\n🏢 Step 2: Location Sync (Warehouses → Locations)...');
      const locationStepStart = Date.now();
      
      try {
        // Map locations
        console.log('🗺️ Step 2a: Mapping locations...');
        const locationMappingResults = await mapLocations(data.unleashed.warehouses, data.shopify.locations);
        
        // Execute location mutations
        console.log('🔄 Step 2b: Executing location mutations...');
        const locationMutationResults = await mutateLocationsViaQueue(env, authData.shopify.shopDomain, locationMappingResults, domain);

        results.steps.locationSync = {
          success: true,
          duration: `${((Date.now() - locationStepStart) / 1000).toFixed(2)}s`,
          mapping: {
            toCreate: locationMappingResults.toCreate.length,
            toUpdate: locationMappingResults.toUpdate.length,
            errors: locationMappingResults.errors.length,
            processed: locationMappingResults.processed
          },
          mutations: {
            method: locationMutationResults.method,
            queued: locationMutationResults.queued,
            summary: locationMutationResults.summary
          }
        };
        
        console.log('✅ Location sync completed:', results.steps.locationSync.mutations.summary);
        results.summary.successfulOperations++;
        
      } catch (error) {
        console.error('❌ Location sync failed:', error);
        results.steps.locationSync = {
          success: false,
          duration: `${((Date.now() - locationStepStart) / 1000).toFixed(2)}s`,
          error: error.message
        };
        results.summary.failedOperations++;
      }

      // ========================================
      // STEP 3: CUSTOMER SYNC
      // ========================================
      console.log('\n👥 Step 3: Customer Sync...');
      const customerStepStart = Date.now();
      
      try {
        // Map customers
        console.log('🗺️ Step 3a: Mapping customers...');
        const customerMappingResults = await mapCustomers(data.unleashed.contacts, data.unleashed.customers, data.shopify.customers);
        
        // Execute customer mutations
        console.log('🔄 Step 3b: Executing customer mutations...');
        const customerMutationResults = await mutateCustomersViaQueue(env, authData.shopify.shopDomain, customerMappingResults, domain);

        results.steps.customerSync = {
          success: true,
          duration: `${((Date.now() - customerStepStart) / 1000).toFixed(2)}s`,
          mapping: {
            toCreate: customerMappingResults.toCreate.length,
            toUpdate: customerMappingResults.toUpdate.length,
            errors: customerMappingResults.errors.length,
            processed: customerMappingResults.processed
          },
          mutations: {
            method: customerMutationResults.method,
            queued: customerMutationResults.queued,
            summary: customerMutationResults.summary
          }
        };
        
        console.log('✅ Customer sync completed:', results.steps.customerSync.mutations.summary);
        results.summary.successfulOperations++;
        
      } catch (error) {
        console.error('❌ Customer sync failed:', error);
        results.steps.customerSync = {
          success: false,
          duration: `${((Date.now() - customerStepStart) / 1000).toFixed(2)}s`,
          error: error.message
        };
        results.summary.failedOperations++;
      }

      // ========================================
      // STEP 4: PRODUCT SYNC
      // ========================================
      console.log('\n📦 Step 4: Product Sync...');
      const productStepStart = Date.now();
      let productMappingResults = null; // Declare at higher scope
      
      try {
        // Map products
        console.log('🗺️ Step 4a: Mapping products...');
        const defaultWarehouseCode = getDefaultWarehouseCode(data.unleashed.warehouses);
        productMappingResults = await mapProducts(
          data.unleashed.products,
          data.shopify.products,
          data.shopify.locations,
          defaultWarehouseCode
        );
        
        // Execute product mutations (using queue-based approach)
        console.log('🔄 Step 4b: Executing product mutations via queue...');
        const productMutationResults = await mutateProductsViaQueue(env, authData.shopify, productMappingResults, domain);

        results.steps.productSync = {
          success: true,
          duration: `${((Date.now() - productStepStart) / 1000).toFixed(2)}s`,
          mapping: {
            toCreate: productMappingResults.toCreate.length,
            toUpdate: productMappingResults.toUpdate.length,
            toArchive: productMappingResults.toArchive.length,
            skipped: productMappingResults.skipped?.length || 0,
            errors: productMappingResults.errors.length,
            processed: productMappingResults.processed
          },
          mutations: {
            method: productMutationResults.method,
            queued: productMutationResults.queued,
            summary: productMutationResults.summary
          }
        };
        
        console.log('✅ Product sync completed:', results.steps.productSync.mutations.summary);
        results.summary.successfulOperations++;
        
      } catch (error) {
        console.error('❌ Product sync failed:', error);
        results.steps.productSync = {
          success: false,
          duration: `${((Date.now() - productStepStart) / 1000).toFixed(2)}s`,
          error: error.message
        };
        results.summary.failedOperations++;
      }

      // ========================================
      // STEP 5: POST-SYNC OPERATIONS (Inventory & Images)
      // ========================================
      if (results.steps.productSync?.success) {
        console.log('\n🔄 Step 5: Post-sync operations (inventory & images)...');
        const postSyncStepStart = Date.now();
        
        try {
          // Import post-sync handler
          const { handlePostSyncOperations } = await import('./post-sync-handler.js');
          
          // Create shopify client helper
          const { accessToken, shopDomain } = authData.shopify;
          const baseUrl = `https://${shopDomain}/admin/api/2025-04`;
          const headers = {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': accessToken
          };
          
          const shopifyClient = {
            request: async (query, variables = {}) => {
              const response = await fetch(`${baseUrl}/graphql.json`, {
                method: 'POST',
                headers,
                body: JSON.stringify({ query, variables })
              });
              const data = await response.json();
              if (data.errors) {
                throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
              }
              return data.data;
            }
          };
          
          // Run post-sync operations for all products that have inventory or image needs
          const productsNeedingPostSync = data.unleashed.products.filter(product => {
            // Include products with stock on hand or attachments
            return (product.StockOnHand && product.StockOnHand.length > 0) || 
                   (product.Attachments && product.Attachments.length > 0);
          });
          
          console.log(`📦 Running post-sync operations for ${productsNeedingPostSync.length} products...`);
          
          const postSyncResults = await handlePostSyncOperations(
            shopifyClient,
            productsNeedingPostSync,
            data.shopify.products,
            data.shopify.locations
          );
          
          results.steps.postSync = {
            success: true,
            duration: `${((Date.now() - postSyncStepStart) / 1000).toFixed(2)}s`,
            images: {
              successful: postSyncResults.images.successful.length,
              failed: postSyncResults.images.failed.length
            }
          };
          
          console.log('✅ Post-sync operations completed:', {
            images: `${postSyncResults.images.successful.length} successful, ${postSyncResults.images.failed.length} failed`
          });
          results.summary.successfulOperations++;
          
        } catch (error) {
          console.error('❌ Post-sync operations failed:', error);
          results.steps.postSync = {
            success: false,
            duration: `${((Date.now() - postSyncStepStart) / 1000).toFixed(2)}s`,
            error: error.message
          };
          results.summary.failedOperations++;
        }
      }

      // ========================================
      // FINAL SUMMARY
      // ========================================
      const totalDuration = Date.now() - startTime;
      results.summary.duration = `${(totalDuration / 1000).toFixed(2)}s`;
      results.summary.totalOperations = results.summary.successfulOperations + results.summary.failedOperations;
      
      console.log('\n🎯 === COMPREHENSIVE SYNC COMPLETE ===');
      console.log(`⏱️ Total Duration: ${results.summary.duration}`);
      console.log(`✅ Successful Operations: ${results.summary.successfulOperations}/${results.summary.totalOperations}`);
      console.log(`❌ Failed Operations: ${results.summary.failedOperations}/${results.summary.totalOperations}`);
      
      if (results.steps.locationSync?.success) {
        const locSummary = results.steps.locationSync.mutations.summary;
        console.log(`📍 Locations: ${locSummary.totalCreated} created, ${locSummary.totalUpdated} updated, ${locSummary.totalFailed} failed`);
      }
      
      if (results.steps.customerSync?.success) {
        const custSummary = results.steps.customerSync.mutations.summary;
        console.log(`👥 Customers: ${custSummary.totalCreated} created, ${custSummary.totalUpdated} updated, ${custSummary.totalFailed} failed`);
      }
      
      if (results.steps.productSync?.success) {
        const productMutations = results.steps.productSync.mutations;
        if (productMutations.method === 'queue_based') {
          console.log(`📦 Products: Queued ${productMutations.queued.creates} creates, ${productMutations.queued.updates} updates, ${productMutations.queued.archives} archives (${productMutations.syncId})`);
        } else {
          console.log(`📦 Products: ${productMutations.method} - ${productMutations.created?.successful || 0} created, ${productMutations.updated?.successful || 0} updated, ${productMutations.archived?.successful || 0} archived`);
        }
      }
      
      if (results.steps.postSync?.success) {
        const postSync = results.steps.postSync;
        console.log(`🔄 Post-Sync: ${postSync.images.successful} image updates`);
      }

      return jsonResponse({
        success: true,
        domain,
        data,
        mappingResults: productMappingResults ? {
          toCreate: productMappingResults.toCreate.length,
          toUpdate: productMappingResults.toUpdate.length,
          toArchive: productMappingResults.toArchive.length,
          skipped: productMappingResults.skipped?.length || 0,
          errors: productMappingResults.errors.length,
          processed: productMappingResults.processed,
          details: productMappingResults.details || null
        } : {
          toCreate: 0,
          toUpdate: 0,
          toArchive: 0,
          skipped: 0,
          errors: 0,
          processed: 0,
          details: null
        },
        mappingResultsFull: productMappingResults, // full object for in-browser debugging
        detailedMappingLog: productMappingResults?.mappingLog || [], // NEW: SKU-based mapping decisions with full reasoning
        timestamp: new Date().toISOString()
      });
      
    } catch (dataError) {
      console.error('❌ Data fetch failed:', dataError);
      results.steps.dataFetch = {
        success: false,
        duration: `${((Date.now() - stepStart) / 1000).toFixed(2)}s`,
        error: dataError.message
      };
      results.success = false;
      results.summary.failedOperations++;
      results.summary.totalOperations = 1;
      results.summary.duration = `${((Date.now() - startTime) / 1000).toFixed(2)}s`;
      
      return jsonResponse(results, 500);
    }

  } catch (error) {
    console.error('🚨 Comprehensive sync workflow error:', error);
    return jsonResponse({ 
      success: false,
      error: error.message || 'Internal server error',
      details: error.stack,
      duration: `${((Date.now() - startTime) / 1000).toFixed(2)}s`
    }, 500);
  }
}

/**
 * Optimized sync that runs location and customer mapping in parallel, then mutations sequentially
 * This approach maximizes efficiency while respecting rate limits
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

    console.log(`🚀 Starting optimized sync workflow for domain: ${domain}`);

    // Get authentication data from KV store
    const authData = await getAuthData(env, domain);
    
    if (!authData || !authData.unleashed || !authData.shopify) {
      throw new Error('Invalid authentication data structure');
    }

    // Step 1: Fetch data
    console.log('📊 Step 1: Fetching data...');
    const data = await pullAllData(domain, env);
    
    // Step 2: Run mapping operations in parallel (no mutations yet)
    console.log('🗺️ Step 2: Running mapping operations in parallel...');
    const [locationMappingResults, customerMappingResults] = await Promise.all([
      mapLocations(data.unleashed.warehouses, data.shopify.locations),
      mapCustomers(data.unleashed.contacts, data.unleashed.customers, data.shopify.customers)
    ]);
    
    console.log('✅ Mapping completed. Starting sequential mutations...');
    
    // Step 3: Run mutations sequentially to avoid rate limits
    console.log('🔄 Step 3a: Executing location mutations...');
    const locationMutationResults = await mutateLocationsViaQueue(env, authData.shopify.shopDomain, locationMappingResults, domain);
    
    console.log('🔄 Step 3b: Executing customer mutations...');
    const customerMutationResults = await mutateCustomersViaQueue(env, authData.shopify.shopDomain, customerMappingResults, domain);
    
    const totalDuration = Date.now() - startTime;
    
    return jsonResponse({
      success: true,
      domain,
      workflow: 'optimized_sync',
      duration: `${(totalDuration / 1000).toFixed(2)}s`,
      results: {
        locations: {
          mapping: {
            toCreate: locationMappingResults.toCreate.length,
            toUpdate: locationMappingResults.toUpdate.length,
            errors: locationMappingResults.errors.length
          },
          mutations: locationMutationResults.summary
        },
        customers: {
          mapping: {
            toCreate: customerMappingResults.toCreate.length,
            toUpdate: customerMappingResults.toUpdate.length,
            errors: customerMappingResults.errors.length
          },
          mutations: customerMutationResults.summary
        }
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('🚨 Optimized sync workflow error:', error);
    return jsonResponse({ 
      success: false,
      error: error.message || 'Internal server error',
      details: error.stack,
      duration: `${((Date.now() - startTime) / 1000).toFixed(2)}s`
    }, 500);
  }
} 