import { pullAllData } from './data_pull.js';
import { mapProducts } from './product-mapping.js';
import { mutateProducts } from './product-mutations.js';

// Helper function to get auth data from KV store
async function getAuthData(env, domain) {
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

/**
 * Handler for product mutations only (existing endpoint)
 */
export async function handleProductMutations(request, env) {
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

    console.log(`🚀 Starting product mutations for domain: ${domain}`);

    // Get authentication data from KV store
    const authData = await getAuthData(env, domain);
    
    if (!authData || !authData.unleashed || !authData.shopify) {
      throw new Error('Invalid authentication data structure');
    }

    // Pull data from both systems
    const data = await pullAllData(domain, env);
    
    console.log('Data pulled successfully for mutations:', {
      unleashed: {
        products: data.unleashed.products.length
      },
      shopify: {
        products: data.shopify.products.length
      }
    });

    // Perform product mapping
    console.log('🗺️ Starting product mapping for mutations...');
    const productMappingResults = await mapProducts(data.unleashed.products, data.shopify.products);
    
    // Execute product mutations
    console.log('🔄 Starting product mutations...');
    const mutationResults = await mutateProducts(authData.shopify, productMappingResults, env, domain);

    console.log('✅ Product mutations completed successfully');

    return jsonResponse({
      success: true,
      domain,
      mappingResults: {
        toCreate: productMappingResults.toCreate.length,
        toUpdate: productMappingResults.toUpdate.length,
        toArchive: productMappingResults.toArchive.length,
        errors: productMappingResults.errors.length,
        processed: productMappingResults.processed
      },
      mutationResults: {
        bulkOperation: mutationResults.bulkOperation,
        created: {
          successful: mutationResults.created.successful.length,
          failed: mutationResults.created.failed.length
        },
        updated: {
          successful: mutationResults.updated.successful.length,
          failed: mutationResults.updated.failed.length
        },
        archived: {
          successful: mutationResults.archived.successful.length,
          failed: mutationResults.archived.failed.length
        },
        inventory: {
          successful: mutationResults.inventory.successful.length,
          failed: mutationResults.inventory.failed.length
        },
        summary: mutationResults.summary,
        errors: mutationResults.errors
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('🚨 Product mutation handler error:', error);
    return jsonResponse({ 
      error: error.message || 'Internal server error',
      details: error.stack 
    }, 500);
  }
}

/**
 * Handler for complete product sync workflow (data fetch + mapping + mutations)
 */
export async function handleProductSync(request, env) {
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

    console.log(`🚀 Starting complete product sync workflow for domain: ${domain}`);

    // Step 1: Get authentication data from KV store
    console.log('🔑 Step 1: Getting authentication data...');
    const authData = await getAuthData(env, domain);
    
    if (!authData || !authData.unleashed || !authData.shopify) {
      throw new Error('Invalid authentication data structure');
    }

    // Step 2: Pull data from both systems
    console.log('📊 Step 2: Pulling data from both systems...');
    const data = await pullAllData(domain, env);
    
    console.log('Data pulled successfully:', {
      unleashed: {
        products: data.unleashed.products.length
      },
      shopify: {
        products: data.shopify.products.length
      }
    });

    // Step 3: Map products
    console.log('🗺️ Step 3: Mapping products...');
    const productMappingResults = await mapProducts(data.unleashed.products, data.shopify.products);
    
    console.log('Product mapping completed:', {
      toCreate: productMappingResults.toCreate.length,
      toUpdate: productMappingResults.toUpdate.length,
      toArchive: productMappingResults.toArchive.length,
      errors: productMappingResults.errors.length,
      processed: productMappingResults.processed
    });

    // Step 4: Execute mutations on Shopify
    console.log('🔄 Step 4: Executing product mutations on Shopify...');
    const mutationResults = await mutateProducts(authData.shopify, productMappingResults, env, domain);

    console.log('✅ Complete product sync workflow completed successfully');

    return jsonResponse({
      success: true,
      domain,
      workflow: 'complete_sync',
      steps: {
        dataFetch: {
          unleashed: {
            products: data.unleashed.products.length
          },
          shopify: {
            products: data.shopify.products.length
          }
        },
        mapping: {
          toCreate: productMappingResults.toCreate.length,
          toUpdate: productMappingResults.toUpdate.length,
          toArchive: productMappingResults.toArchive.length,
          errors: productMappingResults.errors.length,
          processed: productMappingResults.processed
        },
        mutations: {
          bulkOperation: {
            success: mutationResults.bulkOperation?.success || false,
            operationId: mutationResults.bulkOperation?.operation?.id || null,
            error: mutationResults.bulkOperation?.error || null
          },
          created: {
            successful: mutationResults.created.successful.length,
            failed: mutationResults.created.failed.length
          },
          updated: {
            successful: mutationResults.updated.successful.length,
            failed: mutationResults.updated.failed.length
          },
          archived: {
            successful: mutationResults.archived.successful.length,
            failed: mutationResults.archived.failed.length
          },
          inventory: {
            successful: mutationResults.inventory.successful.length,
            failed: mutationResults.inventory.failed.length
          },
          summary: mutationResults.summary,
          errors: mutationResults.errors || []
        }
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('🚨 Complete product sync workflow error:', error);
    return jsonResponse({ 
      error: error.message || 'Internal server error',
      details: error.stack 
    }, 500);
  }
}

async function handleProductMutations(shopifyClient, mappingResults) {
  const results = {
    created: 0,
    updated: 0,
    archived: 0,
    errors: 0
  };

  try {
    console.log(`🔄 Using direct mutations for ${mappingResults.toCreate.length + mappingResults.toUpdate.length + mappingResults.toArchive.length} operations`);
    console.log(`🚀 === STARTING DIRECT PRODUCT MUTATIONS ===`);

    // Create new products
    if (mappingResults.toCreate.length > 0) {
      console.log(`🆕 Creating ${mappingResults.toCreate.length} new products...`);
      for (const productData of mappingResults.toCreate) {
        try {
          const response = await createProduct(shopifyClient, productData);
          if (response.userErrors.length > 0) {
            console.error(`❌ Failed to create product "${productData.title}":`, response.userErrors);
            results.errors++;
          } else {
            console.log(`✅ Created product: ${productData.title}`);
            results.created++;
          }
        } catch (error) {
          console.error(`❌ Error creating product "${productData.title}":`, error);
          results.errors++;
        }
      }
    }

    // Update existing products
    if (mappingResults.toUpdate.length > 0) {
      console.log(`🔄 Updating ${mappingResults.toUpdate.length} existing products...`);
      for (const productData of mappingResults.toUpdate) {
        try {
          const response = await updateProduct(shopifyClient, productData);
          if (response.userErrors.length > 0) {
            console.error(`❌ Failed to update product "${productData.title}":`, response.userErrors);
            results.errors++;
          } else {
            console.log(`✅ Updated product: ${productData.title}`);
            results.updated++;
          }
        } catch (error) {
          console.error(`❌ Error updating product "${productData.title}":`, error);
          results.errors++;
        }
      }
    }

    // Archive products
    if (mappingResults.toArchive.length > 0) {
      console.log(`🗄️ Archiving ${mappingResults.toArchive.length} products...`);
      console.log(`🗄️ Starting archival of ${mappingResults.toArchive.length} products...`);
      
      for (const productData of mappingResults.toArchive) {
        try {
          const response = await updateProduct(shopifyClient, {
            id: productData.id,
            status: 'ARCHIVED'
          });
          
          if (response.userErrors.length > 0) {
            console.error(`❌ Failed to archive product:`, response.userErrors);
            results.errors++;
          } else {
            console.log(`✅ Archived product: ${response.product.title}`);
            results.archived++;
          }
        } catch (error) {
          console.error(`❌ Error archiving product:`, error);
          results.errors++;
        }
      }
      console.log(`✅ Product archival completed: ${results.archived} successful, ${results.errors} failed`);
    }

    console.log(`✅ === DIRECT PRODUCT MUTATIONS COMPLETE ===`);
    console.log(`✅ Product sync completed: Products: ${results.created} created, ${results.updated} updated, ${results.archived} archived (direct). Errors: ${results.errors}`);

    return results;
  } catch (error) {
    console.error('Error in handleProductMutations:', error);
    throw error;
  }
} 