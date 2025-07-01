/**
 * Location Mutation Handler
 * Handles the complete location mutation workflow including data fetching, mapping, and mutations
 */

import { pullAllData } from './data_pull.js';
import { mapLocations } from './location-mapping.js';
import { mutateLocations } from './location-mutations.js';

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
 * Handler for location mutations only (existing endpoint)
 */
export async function handleLocationMutations(request, env) {
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

    console.log(`🚀 Starting location mutations for domain: ${domain}`);

    // Get authentication data from KV store
    const authData = await getAuthData(env, domain);
    
    if (!authData || !authData.unleashed || !authData.shopify) {
      throw new Error('Invalid authentication data structure');
    }

    // Pull data from both systems
    const data = await pullAllData(domain, env);
    
    console.log('Data pulled successfully for mutations:', {
      unleashed: {
        warehouses: data.unleashed.warehouses.length
      },
      shopify: {
        locations: data.shopify.locations.length
      }
    });

    // Perform location mapping
    console.log('🗺️ Starting location mapping for mutations...');
    const locationMappingResults = await mapLocations(data.unleashed.warehouses, data.shopify.locations);
    
    // Execute location mutations
    console.log('🔄 Starting location mutations...');
    const mutationResults = await mutateLocations(authData.shopify, locationMappingResults);

    console.log('✅ Location mutations completed successfully');

    return jsonResponse({
      success: true,
      domain,
      mappingResults: {
        toCreate: locationMappingResults.toCreate.length,
        toUpdate: locationMappingResults.toUpdate.length,
        errors: locationMappingResults.errors.length,
        processed: locationMappingResults.processed
      },
      mutationResults: {
        created: {
          successful: mutationResults.created.successful.length,
          failed: mutationResults.created.failed.length
        },
        updated: {
          successful: mutationResults.updated.successful.length,
          failed: mutationResults.updated.failed.length
        },
        summary: mutationResults.summary
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('🚨 Location mutation handler error:', error);
    return jsonResponse({ 
      error: error.message || 'Internal server error',
      details: error.stack 
    }, 500);
  }
}

/**
 * Complete location sync workflow: Map + Mutate in one call
 */
export async function handleLocationSync(request, env) {
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

    console.log(`🔄 Starting complete location sync workflow for domain: ${domain}`);

    // Get authentication data from KV store
    const authData = await getAuthData(env, domain);
    
    if (!authData || !authData.unleashed || !authData.shopify) {
      throw new Error('Invalid authentication data structure');
    }

    // Step 1: Pull data from both systems
    console.log('📊 Step 1: Fetching data from Unleashed and Shopify...');
    const data = await pullAllData(domain, env);
    
    console.log('Data pulled successfully:', {
      unleashed: {
        warehouses: data.unleashed.warehouses.length
      },
      shopify: {
        locations: data.shopify.locations.length
      }
    });

    // Step 2: Perform location mapping
    console.log('🗺️ Step 2: Mapping locations...');
    const locationMappingResults = await mapLocations(data.unleashed.warehouses, data.shopify.locations);
    
    console.log('Mapping completed:', {
      toCreate: locationMappingResults.toCreate.length,
      toUpdate: locationMappingResults.toUpdate.length,
      errors: locationMappingResults.errors.length
    });

    // Step 3: Execute mutations if there are changes to make
    let mutationResults = null;
    if (locationMappingResults.toCreate.length > 0 || locationMappingResults.toUpdate.length > 0) {
      console.log('🚀 Step 3: Executing location mutations...');
      mutationResults = await mutateLocations(authData.shopify, locationMappingResults);
      console.log('✅ Location mutations completed successfully');
    } else {
      console.log('⏭️ Step 3: No mutations needed - all locations are up to date');
      mutationResults = {
        created: { successful: [], failed: [], totalProcessed: 0 },
        updated: { successful: [], failed: [], totalProcessed: 0 },
        summary: {
          totalLocationsProcessed: 0,
          totalSuccessful: 0,
          totalFailed: 0,
          createdCount: 0,
          updatedCount: 0,
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString(),
          duration: '0.00s'
        }
      };
    }

    console.log('🎯 Complete location sync workflow finished successfully');

    return jsonResponse({
      success: true,
      domain,
      workflow: 'complete-sync',
      mappingResults: {
        toCreate: locationMappingResults.toCreate.length,
        toUpdate: locationMappingResults.toUpdate.length,
        errors: locationMappingResults.errors.length,
        processed: locationMappingResults.processed,
        details: locationMappingResults.mappingDetails
      },
      mutationResults: {
        created: {
          successful: mutationResults.created.successful.length,
          failed: mutationResults.created.failed.length
        },
        updated: {
          successful: mutationResults.updated.successful.length,
          failed: mutationResults.updated.failed.length
        },
        summary: mutationResults.summary
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('🚨 Location sync workflow error:', error);
    return jsonResponse({ 
      error: error.message || 'Internal server error',
      details: error.stack 
    }, 500);
  }
} 