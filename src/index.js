/**
 * Unleashed-Shopify Sync Worker V2
 * Handles initial data fetching and processing
 */

import { pullAllData } from './data_pull.js';
import { mapCustomers } from './customer-mapping.js';
import { mapLocations } from './location-mapping.js';
import { mapProducts } from './product-mapping.js';
import { handleLocationMutations, handleLocationSync } from './location-mutation-handler.js';

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

async function handleDataFetch(request, env) {
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

    console.log(`Starting data sync for domain: ${domain}`);

    // Pull data from both systems using data_pull.js
    const data = await pullAllData(domain, env);
    
    console.log('Data pulled successfully:', {
      unleashed: {
        products: data.unleashed.products.length,
        customers: data.unleashed.customers.length,
        warehouses: data.unleashed.warehouses.length
      },
      shopify: {
        products: data.shopify.products.length,
        customers: data.shopify.customers.length,
        locations: data.shopify.locations.length
      }
    });

    // Perform mapping operations
    console.log('Starting mapping operations...');
    
    const mappingResults = {};
    
    try {
      // Map customers
      console.log('Mapping customers...');
      mappingResults.customers = await mapCustomers(data.unleashed.customers, data.shopify.customers);
      console.log('Customer mapping complete:', {
        toCreate: mappingResults.customers.toCreate.length,
        toUpdate: mappingResults.customers.toUpdate.length,
        errors: mappingResults.customers.errors.length,
        processed: mappingResults.customers.processed
      });
    } catch (error) {
      console.error('Customer mapping failed:', error);
      mappingResults.customers = { error: error.message };
    }

    try {
      // Map locations
      console.log('Mapping locations...');
      mappingResults.locations = await mapLocations(data.unleashed.warehouses, data.shopify.locations);
      console.log('Location mapping complete:', {
        toCreate: mappingResults.locations.toCreate.length,
        toUpdate: mappingResults.locations.toUpdate.length,
        errors: mappingResults.locations.errors.length,
        processed: mappingResults.locations.processed
      });
    } catch (error) {
      console.error('Location mapping failed:', error);
      mappingResults.locations = { error: error.message };
    }

    try {
      // Map products
      console.log('Mapping products...');
      mappingResults.products = await mapProducts(data.unleashed.products, data.shopify.products);
      console.log('Product mapping complete:', {
        toCreate: mappingResults.products.toCreate.length,
        toUpdate: mappingResults.products.toUpdate.length,
        toArchive: mappingResults.products.toArchive.length,
        errors: mappingResults.products.errors.length,
        processed: mappingResults.products.processed
      });
    } catch (error) {
      console.error('Product mapping failed:', error);
      mappingResults.products = { error: error.message };
    }

    console.log('All mapping operations complete');

    return jsonResponse({
      success: true,
      domain,
      data,
      mappingResults,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Worker error:', error);
    return jsonResponse({ 
      error: error.message || 'Internal server error',
      details: error.stack 
    }, 500);
  }
}

export default {
  async fetch(request, env, ctx) {
    // Handle CORS preflight requests
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders
      });
    }

    const url = new URL(request.url);
    
    // Route requests
    if (url.pathname === '/api/v2/data-fetch' && request.method === 'POST') {
      return handleDataFetch(request, env);
    }
    
    if (url.pathname === '/api/v2/mutate-locations' && request.method === 'POST') {
      return handleLocationMutations(request, env);
    }
    
    if (url.pathname === '/api/v2/sync-locations' && request.method === 'POST') {
      return handleLocationSync(request, env);
    }

    return new Response('Not Found', { status: 404 });
  },
}; 