/**
 * Comprehensive Sync Handler
 * Handles complete sync workflow for both locations and customers in optimal sequence
 */

import { pullAllData } from './data_pull.js';
import { mapLocations } from './location-mapping.js';
import { mapCustomers } from './customer-mapping.js';
import { mutateLocations } from './location-mutations.js';
import { mutateCustomers } from './customer-mutations.js';

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
 * Complete sync workflow: Locations first, then Customers
 * This approach ensures warehouses/locations are set up before customer operations
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
        const locationMutationResults = await mutateLocations(authData.shopify, locationMappingResults);

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
            created: {
              successful: locationMutationResults.created.successful.length,
              failed: locationMutationResults.created.failed.length
            },
            updated: {
              successful: locationMutationResults.updated.successful.length,
              failed: locationMutationResults.updated.failed.length
            },
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
        const customerMutationResults = await mutateCustomers(authData.shopify, customerMappingResults);

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
            created: {
              successful: customerMutationResults.created.successful.length,
              failed: customerMutationResults.created.failed.length
            },
            updated: {
              successful: customerMutationResults.updated.successful.length,
              failed: customerMutationResults.updated.failed.length
            },
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

      return jsonResponse(results);
      
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
    const locationMutationResults = await mutateLocations(authData.shopify, locationMappingResults);
    
    console.log('🔄 Step 3b: Executing customer mutations...');
    const customerMutationResults = await mutateCustomers(authData.shopify, customerMappingResults);
    
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