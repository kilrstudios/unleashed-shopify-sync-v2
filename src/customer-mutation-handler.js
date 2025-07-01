/**
 * Customer Mutation Handler
 * Handles the complete customer mutation workflow including data fetching, mapping, and mutations
 */

import { pullAllData } from './data_pull.js';
import { mapCustomers } from './customer-mapping.js';
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
 * Handler for customer mutations only (existing endpoint)
 */
export async function handleCustomerMutations(request, env) {
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

    console.log(`🚀 Starting customer mutations for domain: ${domain}`);

    // Get authentication data from KV store
    const authData = await getAuthData(env, domain);
    
    if (!authData || !authData.unleashed || !authData.shopify) {
      throw new Error('Invalid authentication data structure');
    }

    // Pull data from both systems
    const data = await pullAllData(domain, env);
    
    console.log('Data pulled successfully for mutations:', {
      unleashed: {
        customers: data.unleashed.customers.length
      },
      shopify: {
        customers: data.shopify.customers.length
      }
    });

    // Perform customer mapping
    console.log('🗺️ Starting customer mapping for mutations...');
    const customerMappingResults = await mapCustomers(data.unleashed.customers, data.shopify.customers);
    
    // Execute customer mutations
    console.log('🔄 Starting customer mutations...');
    const mutationResults = await mutateCustomers(authData.shopify, customerMappingResults);

    console.log('✅ Customer mutations completed successfully');

    return jsonResponse({
      success: true,
      domain,
      mappingResults: {
        toCreate: customerMappingResults.toCreate.length,
        toUpdate: customerMappingResults.toUpdate.length,
        errors: customerMappingResults.errors.length,
        processed: customerMappingResults.processed
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
    console.error('🚨 Customer mutation handler error:', error);
    return jsonResponse({ 
      error: error.message || 'Internal server error',
      details: error.stack 
    }, 500);
  }
}

/**
 * Complete customer sync workflow: Map + Mutate in one call
 */
export async function handleCustomerSync(request, env) {
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

    console.log(`🔄 Starting complete customer sync workflow for domain: ${domain}`);

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
        customers: data.unleashed.customers.length
      },
      shopify: {
        customers: data.shopify.customers.length
      }
    });

    // Step 2: Map customers from Unleashed to Shopify format
    console.log('🗺️ Step 2: Mapping customers from Unleashed to Shopify format...');
    const customerMappingResults = await mapCustomers(data.unleashed.customers, data.shopify.customers);
    
    console.log('Customer mapping completed:', {
      toCreate: customerMappingResults.toCreate.length,
      toUpdate: customerMappingResults.toUpdate.length,
      errors: customerMappingResults.errors.length,
      processed: customerMappingResults.processed
    });

    // Step 3: Execute mutations on Shopify
    console.log('🔄 Step 3: Executing customer mutations on Shopify...');
    const mutationResults = await mutateCustomers(authData.shopify, customerMappingResults);

    console.log('✅ Complete customer sync workflow completed successfully');

    return jsonResponse({
      success: true,
      domain,
      workflow: 'complete_sync',
      steps: {
        dataFetch: {
          unleashed: {
            customers: data.unleashed.customers.length
          },
          shopify: {
            customers: data.shopify.customers.length
          }
        },
        mapping: {
          toCreate: customerMappingResults.toCreate.length,
          toUpdate: customerMappingResults.toUpdate.length,
          errors: customerMappingResults.errors.length,
          processed: customerMappingResults.processed
        },
        mutations: {
          created: {
            successful: mutationResults.created.successful.length,
            failed: mutationResults.created.failed.length
          },
          updated: {
            successful: mutationResults.updated.successful.length,
            failed: mutationResults.updated.failed.length
          },
          summary: mutationResults.summary
        }
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('🚨 Customer sync workflow error:', error);
    return jsonResponse({ 
      error: error.message || 'Internal server error',
      details: error.stack 
    }, 500);
  }
} 