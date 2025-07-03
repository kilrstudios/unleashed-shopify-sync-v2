/**
 * Unleashed-Shopify Sync Worker V2
 * Handles initial data fetching and processing
 */

import { pullAllData } from './data_pull.js';
import { mapCustomers } from './customer-mapping.js';
import { mapLocations } from './location-mapping.js';
import { mapProducts } from './product-mapping.js';
import { handleLocationMutations, handleLocationSync } from './location-mutation-handler.js';
import { handleCustomerMutations, handleCustomerSync } from './customer-mutation-handler.js';
import { handleProductMutations, handleProductSync } from './product-mutation-handler.js';
import { handleComprehensiveSync, handleOptimizedSync } from './comprehensive-sync-handler.js';
import { handleProductQueueMessage, handleInventoryUpdate, handleImageUpdate } from './product-mutations.js';

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

// Serve the updated client script
function serveClientScript() {
  const clientScript = `!function(e,t){"use strict";
    // Configuration object
    const config = {
        workerUrl: "https://unleashed-shopify-sync-v2.adrian-b0e.workers.dev/api/v2/data-fetch",
        mutationUrl: "https://unleashed-shopify-sync-v2.adrian-b0e.workers.dev/api/v2/mutate-locations",
        syncUrl: "https://unleashed-shopify-sync-v2.adrian-b0e.workers.dev/api/v2/comprehensive-sync",
        buttonAttribute: "kilr-unleashed-sync",
        mutateButtonAttribute: "kilr-unleashed-mutate-locations",
        syncButtonAttribute: "kilr-unleashed-sync-locations",
        loadingClass: "kilr-sync-loading",
        successClass: "kilr-sync-success",
        errorClass: "kilr-sync-error"
    };

    // Create and append styles
    const styleElement = t.createElement("style");
    styleElement.textContent = \`
        .\${config.loadingClass} {
            opacity: 0.7;
            cursor: not-allowed;
            position: relative;
        }
        .\${config.loadingClass}::after {
            content: '';
            position: absolute;
            width: 16px;
            height: 16px;
            top: 50%;
            right: 10px;
            transform: translateY(-50%);
            border: 2px solid #fff;
            border-radius: 50%;
            border-top-color: transparent;
            animation: kilr-spin 1s linear infinite;
        }
        .\${config.successClass} {
            background-color: #4CAF50 !important;
            border-color: #45a049 !important;
        }
        .\${config.errorClass} {
            background-color: #f44336 !important;
            border-color: #da190b !important;
        }
        @keyframes kilr-spin {
            to { transform: translateY(-50%) rotate(360deg); }
        }
        @keyframes kilr-notification {
            from { opacity: 0; transform: translateX(100%); }
            to { opacity: 1; transform: translateX(0); }
        }
        @keyframes kilr-notification-out {
            from { opacity: 1; transform: translateX(0); }
            to { opacity: 0; transform: translateX(100%); }
        }
    \`;
    t.head.appendChild(styleElement);

    // Show notification
    function showNotification(message, type) {
        console.log('Showing notification:', message, type);
        
        if (e.shopify && e.shopify.toast) {
            e.shopify.toast.show(message);
            return;
        }

        const notification = t.createElement("div");
        notification.style.cssText = \`
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 16px 24px;
            background: \${type === "error" ? "#f44336" : type === "success" ? "#4CAF50" : "#2196F3"};
            color: white;
            border-radius: 4px;
            box-shadow: 0 2px 5px rgba(0,0,0,0.2);
            z-index: 10000;
            animation: kilr-notification 0.3s ease-out;
        \`;
        notification.textContent = message;
        t.body.appendChild(notification);

        setTimeout(() => {
            notification.style.animation = "kilr-notification-out 0.3s ease-in forwards";
            setTimeout(() => notification.remove(), 300);
        }, 5000);
    }

    // Update button state
    function updateButtonState(button, state) {
        console.log('Updating button state:', state);
        
        button.classList.remove(config.loadingClass, config.successClass, config.errorClass);
        const originalText = button.getAttribute("data-original-text");

        switch (state) {
            case "loading":
                if (!originalText) {
                    button.setAttribute("data-original-text", button.textContent);
                }
                button.classList.add(config.loadingClass);
                button.textContent = "Processing...";
                break;
            case "success":
                button.classList.add(config.successClass);
                button.textContent = "Complete";
                setTimeout(() => {
                    button.classList.remove(config.successClass);
                    button.textContent = originalText;
                }, 2000);
                break;
            case "error":
                button.classList.add(config.errorClass);
                button.textContent = "Failed";
                setTimeout(() => {
                    button.classList.remove(config.errorClass);
                    button.textContent = originalText;
                }, 2000);
                break;
        }
    }

    // Handle sync (complete workflow - mapping + mutations)
    function handleSync(event) {
        event.preventDefault();
        const button = event.currentTarget;
        console.log('Handle sync called for button:', button);
        
        if (button.classList.contains(config.loadingClass)) {
            console.log('Button is already in loading state, ignoring click');
            return;
        }

        // Get the current domain
        const domain = window.location.hostname;
        console.log('Current domain:', domain);

        // Prepare the request data
        const requestData = { domain };
        console.log('Request data:', requestData);

        // Update button state
        updateButtonState(button, "loading");

        // Make the request to the complete sync endpoint
        fetch(config.syncUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Accept": "application/json"
            },
            body: JSON.stringify(requestData)
        })
        .then(response => {
            console.log('Response received:', response);
            return response.json().then(data => {
                if (!response.ok) {
                    throw new Error(data.error || 'Sync failed');
                }
                return data;
            });
        })
        .then(data => {
            console.log('Data received:', data);
            if (data.success) {
                // Handle sync response (includes both mapping and mutation results)
                const mapping = data.mappingResults;
                const mutations = data.mutationResults;
                
                showNotification(
                    \`Sync complete! Locations: \${mutations.successCount} processed, \${mutations.errors.length} errors\`,
                    mutations.errors.length > 0 ? "error" : "success"
                );
                updateButtonState(button, mutations.errors.length > 0 ? "error" : "success");

                // Log the complete sync results
                if (data.mappingResults && data.mutationResults) {
                    logSyncResults(data);
                }
            } else {
                throw new Error(data.error || 'Sync failed');
            }
        })
        .catch(error => {
            console.error('Sync error:', error);
            showNotification(error.message || "Failed to sync data", "error");
            updateButtonState(button, "error");
        });
    }

    // Initialize the script
    if (typeof e !== "undefined" && typeof t !== "undefined") {
        if (t.readyState === "loading") {
            t.addEventListener("DOMContentLoaded", init);
        } else {
            init();
        }
    }

    function init() {
        console.log('Initializing Unleashed Sync script...');
        initializeButtons();
    }

    function initializeButtons() {
        console.log('Initializing sync buttons...');
        
        // Find all sync buttons
        const syncButtons = t.querySelectorAll(\`[\${config.buttonAttribute}]\`);
        console.log(\`Found \${syncButtons.length} sync buttons\`);
        
        syncButtons.forEach(button => {
            console.log('Attaching event listener to sync button:', button);
            button.addEventListener('click', handleSync);
        });
    }
}(window, document);`;

  return new Response(clientScript, {
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/javascript',
      'Cache-Control': 'no-cache', // Prevent caching to ensure updates are immediate
    },
  });
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
      mappingResults.products = await mapProducts(data.unleashed.products, data.shopify.products, data.shopify.locations);
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
      // Redirect data-fetch to comprehensive sync for full functionality
      return handleComprehensiveSync(request, env);
    }
    
    // Comprehensive sync endpoints (NEW - handles both locations and customers)
    if (url.pathname === '/api/v2/comprehensive-sync' && request.method === 'POST') {
      return handleComprehensiveSync(request, env);
    }
    
    if (url.pathname === '/api/v2/optimized-sync' && request.method === 'POST') {
      return handleOptimizedSync(request, env);
    }
    
    // Individual location endpoints
    if (url.pathname === '/api/v2/mutate-locations' && request.method === 'POST') {
      return handleLocationMutations(request, env);
    }
    
    if (url.pathname === '/api/v2/sync-locations' && request.method === 'POST') {
      return handleLocationSync(request, env);
    }
    
    // Individual customer endpoints
    if (url.pathname === '/api/v2/mutate-customers' && request.method === 'POST') {
      return handleCustomerMutations(request, env);
    }
    
    if (url.pathname === '/api/v2/sync-customers' && request.method === 'POST') {
      return handleCustomerSync(request, env);
    }
    
    // Individual product endpoints
    if (url.pathname === '/api/v2/mutate-products' && request.method === 'POST') {
      return handleProductMutations(request, env);
    }
    
    if (url.pathname === '/api/v2/sync-products' && request.method === 'POST') {
      return handleProductSync(request, env);
    }
    
    // Product callback endpoints (for queue processing)
    if (url.pathname === '/api/v2/products/inventory-update' && request.method === 'POST') {
      return handleInventoryUpdate(request, env);
    }
    
    if (url.pathname === '/api/v2/products/image-update' && request.method === 'POST') {
      return handleImageUpdate(request, env);
    }
    
    // Serve client script
    if (url.pathname === '/client-script.js' && request.method === 'GET') {
      return serveClientScript();
    }

    return new Response('Not Found', { status: 404 });
  },

  // Queue consumer for product mutations
  async queue(batch, env) {
    console.log(`🔄 Processing ${batch.messages.length} queue messages`);
    
    for (const message of batch.messages) {
      try {
        console.log(`Processing message: ${message.body.type} for ${message.body.productData?.title || 'unknown product'}`);
        const result = await handleProductQueueMessage(message.body, env);
        
        if (result.success) {
          console.log(`✅ Successfully processed ${message.body.type}`);
          message.ack();
        } else {
          console.error(`❌ Failed to process ${message.body.type}: ${result.error}`);
          message.retry();
        }
      } catch (error) {
        console.error(`🚨 Queue message processing error:`, error);
        message.retry();
      }
    }
  }
}; 