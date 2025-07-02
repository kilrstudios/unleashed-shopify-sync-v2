// src/product-mutations.js

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

// Convert Shopify GID to numeric ID
function extractNumericId(gid) {
  if (!gid) return null;
  const parts = gid.split('/');
  return parts[parts.length - 1];
}

// Convert numeric ID to Shopify GID
function createShopifyGid(type, id) {
  return `gid://shopify/${type}/${id}`;
}

// Generate variant title from AttributeSet
function generateVariantTitle(attributeSet) {
  if (!attributeSet) return 'Default Title';
  
  const values = [
    attributeSet['Option 1 Value'],
    attributeSet['Option 2 Value'], 
    attributeSet['Option 3 Value']
  ].filter(Boolean);
  
  if (!values.length) return 'Default Title';
  return values.join(' / ');
}

// Build productSet input for bulk operation
function buildProductSetInput(productData, isUpdate = false) {
  const input = {
    title: productData.title,
    status: productData.status || 'ACTIVE',
    productType: productData.product_type || '',
    vendor: productData.vendor || 'Default',
    tags: productData.tags || [],
    variants: productData.variants.map(variant => {
      const variantInput = {
        sku: variant.sku,
        price: variant.price?.toString(),
        inventoryItem: {
          sku: variant.sku,
          tracked: variant.inventory_management === 'shopify',
          measurement: {
            weight: {
              value: parseFloat(variant.weight) || 0,
              unit: 'GRAMS'
            }
          }
        },
        inventoryPolicy: 'DENY' // Must be uppercase
      };

      // Add variant ID if updating
      if (isUpdate && variant.id) {
        variantInput.id = variant.id;
      }

      // Add metafields for price tiers
      if (variant.metafields && variant.metafields.length > 0) {
        variantInput.metafields = variant.metafields
          .filter(mf => mf.value && mf.value.toString().trim() !== '')
          .map(mf => ({
            namespace: mf.namespace,
            key: mf.key,
            value: mf.value.toString(),
            type: 'money'
          }));
      }

      // For now, don't set optionValues - let Shopify auto-generate
      // This will be auto-populated based on the productOptions
      // variantInput.optionValues = will be set automatically

      return variantInput;
    })
  };

  // Add product ID if updating
  if (isUpdate && productData.id) {
    input.id = productData.id;
  }

  // Add product description
  if (productData.description) {
    input.descriptionHtml = productData.description;
  }

  // Handle product options - for single variant products with default option
  if (!productData.options || productData.options.length === 0) {
    // Single variant products need at least one option
    input.productOptions = [{
      name: 'Title',
      values: [{ name: 'Default Title' }]
    }];
  } else {
    // Multi-variant products
    input.productOptions = productData.options.map(option => ({
      name: option.name || option,
      values: option.values ? option.values.map(v => ({ name: v })) : [{ name: 'Default' }]
    }));
  }

  return { input };
}

// Create JSONL content for bulk operation
function createBulkOperationJsonl(products, updates) {
  const lines = [];
  
  // Add creates
  products.forEach(product => {
    const jsonLine = JSON.stringify(buildProductSetInput(product, false));
    lines.push(jsonLine);
  });

  // Add updates
  updates.forEach(product => {
    const jsonLine = JSON.stringify(buildProductSetInput(product, true));
    lines.push(jsonLine);
  });

  return lines.join('\n');
}

// Upload JSONL to Shopify's staged upload
async function uploadJsonlFile(baseUrl, headers, jsonlContent) {
  // First, get a staged upload URL
  const stagedUploadMutation = `
    mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
      stagedUploadsCreate(input: $input) {
        stagedTargets {
          url
          resourceUrl
          parameters {
            name
            value
          }
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const stagedUploadVariables = {
    input: [{
      resource: 'BULK_MUTATION_VARIABLES',
      filename: 'bulk_product_operations.jsonl',
      mimeType: 'text/plain',
      httpMethod: 'POST'
    }]
  };

  console.log('📤 Requesting staged upload URL...');
  const stagedResponse = await fetch(`${baseUrl}/graphql.json`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      query: stagedUploadMutation,
      variables: stagedUploadVariables
    })
  });

  const stagedData = await stagedResponse.json();
  if (stagedData.errors) {
    throw new Error(`Staged upload request failed: ${JSON.stringify(stagedData.errors)}`);
  }

  const stagedTarget = stagedData.data.stagedUploadsCreate.stagedTargets[0];
  if (!stagedTarget) {
    throw new Error('No staged upload target received');
  }

  console.log('📤 Uploading JSONL file to staged URL...');
  
  // Prepare form data for upload
  const formData = new FormData();
  
  // Add parameters from Shopify
  stagedTarget.parameters.forEach(param => {
    formData.append(param.name, param.value);
  });
  
  // Add the file content
  const blob = new Blob([jsonlContent], { type: 'text/plain' });
  formData.append('file', blob, 'bulk_product_operations.jsonl');

  const uploadResponse = await fetch(stagedTarget.url, {
    method: 'POST',
    body: formData
  });

  if (!uploadResponse.ok) {
    throw new Error(`File upload failed: ${uploadResponse.status} ${uploadResponse.statusText}`);
  }

  console.log('✅ JSONL file uploaded successfully');
  return stagedTarget.resourceUrl;
}

// Start bulk operation
async function startBulkOperation(baseUrl, headers, stagedUploadUrl) {
  const bulkMutation = `
    mutation bulkOperationRunMutation($mutation: String!, $stagedUploadPath: String!) {
      bulkOperationRunMutation(mutation: $mutation, stagedUploadPath: $stagedUploadPath) {
        bulkOperation {
          id
          status
          createdAt
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const productSetMutation = `
    mutation productSet($input: ProductSetInput!) {
      productSet(input: $input) {
        product {
          id
          title
          variants(first: 50) {
            nodes {
              id
              sku
              inventoryItem {
                id
              }
            }
          }
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  console.log('🚀 Starting bulk operation...');
  const response = await fetch(`${baseUrl}/graphql.json`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      query: bulkMutation,
      variables: {
        mutation: productSetMutation,
        stagedUploadPath: stagedUploadUrl
      }
    })
  });

  const data = await response.json();
  if (data.errors) {
    throw new Error(`Bulk operation start failed: ${JSON.stringify(data.errors)}`);
  }

  if (data.data.bulkOperationRunMutation.userErrors.length > 0) {
    throw new Error(`Bulk operation errors: ${JSON.stringify(data.data.bulkOperationRunMutation.userErrors)}`);
  }

  const bulkOperation = data.data.bulkOperationRunMutation.bulkOperation;
  console.log(`✅ Bulk operation started: ${bulkOperation.id}`);
  
  return bulkOperation;
}

// Monitor bulk operation status
async function monitorBulkOperation(baseUrl, headers, operationId, maxWaitTime = 300000) { // 5 minutes max
  const statusQuery = `
    query {
      currentBulkOperation {
        id
        status
        errorCode
        createdAt
        completedAt
        objectCount
        fileSize
        url
        partialDataUrl
      }
    }
  `;

  const startTime = Date.now();
  let lastStatus = null;

  console.log(`⏳ Monitoring bulk operation ${operationId}...`);

  while (Date.now() - startTime < maxWaitTime) {
    await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds between checks

    const response = await fetch(`${baseUrl}/graphql.json`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query: statusQuery })
    });

    const data = await response.json();
    if (data.errors) {
      console.error('Error checking bulk operation status:', data.errors);
      continue;
    }

    const operation = data.data.currentBulkOperation;
    if (!operation || operation.id !== operationId) {
      console.log('No current bulk operation or different operation running');
      continue;
    }

    if (operation.status !== lastStatus) {
      console.log(`📊 Bulk operation status: ${operation.status} (${operation.objectCount || 0} objects processed)`);
      lastStatus = operation.status;
    }

    if (operation.status === 'COMPLETED') {
      console.log('✅ Bulk operation completed successfully');
      return {
        success: true,
        operation,
        resultUrl: operation.url
      };
    }

    if (operation.status === 'FAILED' || operation.status === 'CANCELED') {
      console.error(`❌ Bulk operation ${operation.status.toLowerCase()}: ${operation.errorCode || 'Unknown error'}`);
      return {
        success: false,
        operation,
        error: operation.errorCode || `Operation ${operation.status.toLowerCase()}`
      };
    }
  }

  console.error('⏰ Bulk operation timed out');
  return {
    success: false,
    error: 'Operation timed out',
    operation: null
  };
}

// Download and parse bulk operation results
async function parseBulkOperationResults(resultUrl) {
  if (!resultUrl) {
    console.log('No result URL provided - bulk operation may have had no results');
    return [];
  }

  try {
    console.log('📥 Downloading bulk operation results...');
    const response = await fetch(resultUrl);
    
    if (!response.ok) {
      throw new Error(`Failed to download results: ${response.status} ${response.statusText}`);
    }

    const jsonlContent = await response.text();
    const lines = jsonlContent.trim().split('\n').filter(line => line.trim());
    
    console.log(`📊 Processing ${lines.length} result lines...`);
    
    const results = lines.map(line => {
      try {
        return JSON.parse(line);
      } catch (error) {
        console.error('Error parsing result line:', line, error);
        return null;
      }
    }).filter(Boolean);

    return results;
  } catch (error) {
    console.error('Error parsing bulk operation results:', error);
    return [];
  }
}

// Update inventory for variants
async function updateInventoryLevels(baseUrl, headers, inventoryUpdates) {
  const results = {
    successful: [],
    failed: []
  };

  console.log(`📦 Starting inventory updates for ${inventoryUpdates.length} items...`);

  // Process inventory updates in batches
  const batchSize = 10;
  for (let i = 0; i < inventoryUpdates.length; i += batchSize) {
    const batch = inventoryUpdates.slice(i, i + batchSize);
    
    console.log(`📦 Processing inventory batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(inventoryUpdates.length / batchSize)}`);

    const batchPromises = batch.map(async (update) => {
      try {
        const mutation = `
          mutation inventorySetQuantities($input: InventorySetQuantitiesInput!) {
            inventorySetQuantities(input: $input) {
              inventoryAdjustmentGroup {
                id
                changes {
                  item {
                    id
                  }
                  delta
                }
              }
              userErrors {
                field
                message
              }
            }
          }
        `;

        const variables = {
          input: {
            locationId: update.locationId,
            inventoryItemAdjustments: [{
              inventoryItemId: update.inventoryItemId,
              availableDelta: update.delta
            }]
          }
        };

        const response = await fetch(`${baseUrl}/graphql.json`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            query: mutation,
            variables
          })
        });

        const data = await response.json();
        
        if (data.errors) {
          throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
        }

        if (data.data.inventorySetQuantities.userErrors.length > 0) {
          throw new Error(`Inventory update errors: ${JSON.stringify(data.data.inventorySetQuantities.userErrors)}`);
        }

        results.successful.push({
          inventoryItemId: update.inventoryItemId,
          locationId: update.locationId,
          delta: update.delta,
          adjustmentGroupId: data.data.inventorySetQuantities.inventoryAdjustmentGroup.id
        });

      } catch (error) {
        console.error(`❌ Inventory update failed for ${update.inventoryItemId}:`, error.message);
        results.failed.push({
          inventoryItemId: update.inventoryItemId,
          locationId: update.locationId,
          delta: update.delta,
          error: error.message
        });
      }
    });

    await Promise.all(batchPromises);
    
    // Brief delay between batches to avoid rate limiting
    if (i + batchSize < inventoryUpdates.length) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  console.log(`✅ Inventory updates completed: ${results.successful.length} successful, ${results.failed.length} failed`);
  return results;
}

// Archive products that are no longer in Unleashed
async function archiveProducts(baseUrl, headers, productsToArchive) {
  const results = {
    successful: [],
    failed: []
  };

  console.log(`🗄️ Starting archival of ${productsToArchive.length} products...`);

  for (const product of productsToArchive) {
    try {
      const mutation = `
        mutation productUpdate($input: ProductInput!) {
          productUpdate(input: $input) {
            product {
              id
              status
              title
            }
            userErrors {
              field
              message
            }
          }
        }
      `;

      const variables = {
        input: {
          id: product.id,
          status: 'ARCHIVED'
        }
      };

      const response = await fetch(`${baseUrl}/graphql.json`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          query: mutation,
          variables
        })
      });

      const data = await response.json();
      
      if (data.errors) {
        throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
      }

      if (data.data.productUpdate.userErrors.length > 0) {
        throw new Error(`Product archive errors: ${JSON.stringify(data.data.productUpdate.userErrors)}`);
      }

      results.successful.push({
        id: product.id,
        title: data.data.productUpdate.product.title,
        status: data.data.productUpdate.product.status
      });

      console.log(`✅ Archived product: ${data.data.productUpdate.product.title}`);

    } catch (error) {
      console.error(`❌ Failed to archive product ${product.id}:`, error.message);
      results.failed.push({
        id: product.id,
        error: error.message
      });
    }
  }

  console.log(`✅ Product archival completed: ${results.successful.length} successful, ${results.failed.length} failed`);
  return results;
}

// Individual product mutations (fallback method)
async function mutateProductsIndividually(baseUrl, headers, products, isUpdate = false) {
  const results = { successful: [], failed: [] };
  const batchSize = 10;
  let requestCount = 0;
  
  console.log(`🔄 Processing ${products.length} products individually in batches of ${batchSize}...`);
  
  for (let i = 0; i < products.length; i += batchSize) {
    const batch = products.slice(i, i + batchSize);
    console.log(`📦 Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(products.length / batchSize)} (${batch.length} products)`);
    
    const batchPromises = batch.map(async (product) => {
      try {
        requestCount++;
        console.log(`🛠️ ${isUpdate ? 'Updating' : 'Creating'} product: "${product.title}" (Request #${requestCount})`);
        
        const mutation = `
          mutation productSet($input: ProductSetInput!) {
            productSet(input: $input) {
              product {
                id
                title
                handle
                variants(first: 50) {
                  nodes {
                    id
                    sku
                    inventoryItem {
                      id
                    }
                  }
                }
              }
              userErrors {
                field
                message
              }
            }
          }
        `;

        const variables = buildProductSetInput(product, isUpdate);
        
        const response = await fetch(`${baseUrl}/graphql.json`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            query: mutation,
            variables
          })
        });

        const data = await response.json();
        
        if (data.errors) {
          throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
        }

        if (data.data.productSet.userErrors.length > 0) {
          throw new Error(`Product errors: ${JSON.stringify(data.data.productSet.userErrors)}`);
        }

        results.successful.push({
          original: product,
          result: data.data.productSet.product
        });

        console.log(`✅ Successfully ${isUpdate ? 'updated' : 'created'} product: "${data.data.productSet.product.title}"`);

      } catch (error) {
        console.error(`❌ Failed to ${isUpdate ? 'update' : 'create'} product "${product.title}":`, error.message);
        results.failed.push({
          product: product,
          error: error.message
        });
      }
    });

    await Promise.all(batchPromises);
    
    // Brief delay between batches to avoid rate limiting
    if (i + batchSize < products.length) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  console.log(`✅ Individual processing completed: ${results.successful.length} successful, ${results.failed.length} failed`);
  return results;
}

// Queue-based product mutations (primary method)
async function mutateProductsViaQueue(env, shopifyAuth, mappingResults, originalDomain) {
  console.log('🚀 === STARTING QUEUE-BASED PRODUCT MUTATIONS ===');
  
  const { shopDomain } = shopifyAuth;
  const syncId = crypto.randomUUID();
  
  const results = {
    method: 'queue_based',
    syncId,
    queued: { creates: 0, updates: 0, archives: 0 },
    summary: '',
    errors: []
  };

  try {
    // Queue product creates
    for (const product of mappingResults.toCreate) {
      const message = {
        type: 'CREATE_PRODUCT',
        syncId,
        originalDomain,
        shopDomain,
        productData: product,
        timestamp: new Date().toISOString()
      };
      
      await env.PRODUCT_QUEUE.send(message);
      results.queued.creates++;
    }

    // Queue product updates  
    for (const product of mappingResults.toUpdate) {
      const message = {
        type: 'UPDATE_PRODUCT', 
        syncId,
        originalDomain,
        shopDomain,
        productData: product,
        timestamp: new Date().toISOString()
      };
      
      await env.PRODUCT_QUEUE.send(message);
      results.queued.updates++;
    }

    // Queue product archives
    for (const product of mappingResults.toArchive) {
      const message = {
        type: 'ARCHIVE_PRODUCT',
        syncId,
        originalDomain,
        shopDomain,
        productData: product,
        timestamp: new Date().toISOString()
      };
      
      await env.PRODUCT_QUEUE.send(message);
      results.queued.archives++;
    }

    const totalQueued = results.queued.creates + results.queued.updates + results.queued.archives;
    results.summary = `Queued ${totalQueued} product operations (${results.queued.creates} creates, ${results.queued.updates} updates, ${results.queued.archives} archives) - Processing in background`;
    
    console.log(`✅ Queued ${totalQueued} product operations with sync ID: ${syncId}`);

  } catch (error) {
    console.error('🚨 Queue-based product mutations failed:', error);
    results.errors.push({
      type: 'queue_error',
      message: error.message
    });
    results.summary = `Queue operation failed: ${error.message}`;
  }

  console.log('✅ === QUEUE-BASED PRODUCT MUTATIONS COMPLETE ===');
  return results;
}

// Fallback: Individual product mutations for small batches or queue failures
async function mutateProductsDirect(shopifyAuth, mappingResults) {
  console.log('🚀 === STARTING DIRECT PRODUCT MUTATIONS ===');
  
  const { accessToken, shopDomain } = shopifyAuth;
  const baseUrl = `https://${shopDomain}/admin/api/2025-04`;
  const headers = {
    'Content-Type': 'application/json',
    'X-Shopify-Access-Token': accessToken
  };

  const results = {
    created: { successful: [], failed: [] },
    updated: { successful: [], failed: [] },
    archived: { successful: [], failed: [] },
    method: 'direct_individual',
    summary: '',
    errors: []
  };

  try {
    // Use individual operations directly
    if (mappingResults.toCreate.length > 0) {
      console.log(`🔄 Creating ${mappingResults.toCreate.length} products...`);
      const createResults = await mutateProductsIndividually(baseUrl, headers, mappingResults.toCreate, false);
      results.created = createResults;
    }
    
    if (mappingResults.toUpdate.length > 0) {
      console.log(`🔄 Updating ${mappingResults.toUpdate.length} products...`);
      const updateResults = await mutateProductsIndividually(baseUrl, headers, mappingResults.toUpdate, true);
      results.updated = updateResults;
    }

    if (mappingResults.toArchive.length > 0) {
      console.log(`🗄️ Archiving ${mappingResults.toArchive.length} products...`);
      const archiveResults = await archiveProducts(baseUrl, headers, mappingResults.toArchive);
      results.archived = archiveResults;
    }
    
    // Generate summary
    results.summary = `Products: ${results.created.successful.length} created, ${results.updated.successful.length} updated, ${results.archived.successful.length} archived (direct). Errors: ${results.errors.length}`;

  } catch (error) {
    console.error('🚨 Direct product mutations failed:', error);
    results.errors.push({
      type: 'critical_error',
      message: error.message
    });
    results.summary = `Product mutations failed: ${error.message}`;
  }

  console.log('✅ === DIRECT PRODUCT MUTATIONS COMPLETE ===');
  return results;
}

// Main function: Decides between queue and direct methods
async function mutateProducts(shopifyAuth, mappingResults, env = null, originalDomain = null) {
  const totalOperations = mappingResults.toCreate.length + mappingResults.toUpdate.length + mappingResults.toArchive.length;
  
  // Decide strategy based on availability and volume
  const useQueue = env && env.PRODUCT_QUEUE && totalOperations > 5; // Use queue for > 5 operations
  
  if (useQueue) {
    console.log(`📋 Using queue-based mutations for ${totalOperations} operations`);
    return await mutateProductsViaQueue(env, shopifyAuth, mappingResults, originalDomain);
  } else {
    console.log(`🔄 Using direct mutations for ${totalOperations} operations`);
    return await mutateProductsDirect(shopifyAuth, mappingResults);
  }
}

// Queue consumer: Processes individual product mutations
async function handleProductQueueMessage(message, env) {
  console.log(`🔄 Processing queue message: ${message.type} for ${message.productData.title}`);
  
  try {
    // Get auth data using the original domain (where auth is stored in KV)
    const authData = await getAuthData(env, message.originalDomain);
    const { accessToken } = authData.shopify;
    
    // Use the Shopify domain for API calls
    const baseUrl = `https://${message.shopDomain}/admin/api/2025-04`;
    const headers = {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': accessToken
    };

    let result = null;

    switch (message.type) {
      case 'CREATE_PRODUCT':
      case 'UPDATE_PRODUCT':
        console.log(`🛠️ ${message.type === 'CREATE_PRODUCT' ? 'Creating' : 'Updating'} product: ${message.productData.title}`);
        
        const mutation = `
          mutation productSet($input: ProductSetInput!) {
            productSet(input: $input) {
              product {
                id
                title
                handle
                variants(first: 50) {
                  nodes {
                    id
                    sku
                    inventoryItem {
                      id
                    }
                  }
                }
              }
              userErrors {
                field
                message
              }
            }
          }
        `;

        const variables = buildProductSetInput(message.productData, message.type === 'UPDATE_PRODUCT');
        
        const response = await fetch(`${baseUrl}/graphql.json`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ query: mutation, variables })
        });

        const data = await response.json();
        
        if (data.errors) {
          throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
        }

        if (data.data.productSet.userErrors.length > 0) {
          throw new Error(`Product errors: ${JSON.stringify(data.data.productSet.userErrors)}`);
        }

        result = data.data.productSet.product;
        console.log(`✅ Successfully ${message.type === 'CREATE_PRODUCT' ? 'created' : 'updated'} product: ${result.title}`);

        // TODO: Trigger inventory and image callbacks here
        // await triggerInventoryCallback(result, message, env);
        // await triggerImageCallback(result, message, env);
        
        break;

      case 'ARCHIVE_PRODUCT':
        console.log(`🗄️ Archiving product: ${message.productData.id}`);
        
        const archiveMutation = `
          mutation productUpdate($input: ProductInput!) {
            productUpdate(input: $input) {
              product {
                id
                status
                title
              }
              userErrors {
                field
                message
              }
            }
          }
        `;

        const archiveResponse = await fetch(`${baseUrl}/graphql.json`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            query: archiveMutation,
            variables: {
              input: {
                id: message.productData.id,
                status: 'ARCHIVED'
              }
            }
          })
        });

        const archiveData = await archiveResponse.json();
        
        if (archiveData.errors || archiveData.data.productUpdate.userErrors.length > 0) {
          throw new Error(`Archive failed: ${JSON.stringify(archiveData.errors || archiveData.data.productUpdate.userErrors)}`);
        }

        result = archiveData.data.productUpdate.product;
        console.log(`✅ Successfully archived product: ${result.title}`);
        
        break;

      default:
        throw new Error(`Unknown message type: ${message.type}`);
    }

    return { success: true, result };

  } catch (error) {
    console.error(`❌ Queue message processing failed:`, error);
    return { success: false, error: error.message };
  }
}

// Handle inventory updates for a specific product
async function handleInventoryUpdate(request, env) {
  try {
    const body = await request.json();
    const { originalDomain, shopDomain, productId, variants, inventoryLevels } = body;

    console.log(`📦 Handling inventory update for product ${productId}`);

    // Get auth data using original domain
    const authData = await getAuthData(env, originalDomain);
    const { accessToken } = authData.shopify;
    
    // Use shopify domain for API calls
    const baseUrl = `https://${shopDomain}/admin/api/2025-04`;
    const headers = {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': accessToken
    };

    // Process inventory updates for each variant
    const results = { successful: [], failed: [] };
    
    for (const update of inventoryLevels) {
      try {
        const mutation = `
          mutation inventorySetQuantities($input: InventorySetQuantitiesInput!) {
            inventorySetQuantities(input: $input) {
              inventoryAdjustmentGroup {
                id
              }
              userErrors {
                field
                message
              }
            }
          }
        `;

        const response = await fetch(`${baseUrl}/graphql.json`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            query: mutation,
            variables: {
              input: {
                locationId: update.locationId,
                inventoryItemAdjustments: [{
                  inventoryItemId: update.inventoryItemId,
                  availableDelta: update.delta
                }]
              }
            }
          })
        });

        const data = await response.json();
        
        if (data.errors || data.data.inventorySetQuantities.userErrors.length > 0) {
          throw new Error(`Inventory error: ${JSON.stringify(data.errors || data.data.inventorySetQuantities.userErrors)}`);
        }

        results.successful.push(update);
        console.log(`✅ Updated inventory for variant ${update.inventoryItemId}`);

      } catch (error) {
        console.error(`❌ Inventory update failed for ${update.inventoryItemId}:`, error.message);
        results.failed.push({ ...update, error: error.message });
      }
    }

    return new Response(JSON.stringify({
      success: true,
      results,
      summary: `${results.successful.length} successful, ${results.failed.length} failed`
    }), { headers: { 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('❌ Inventory update handler failed:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

// Handle image attachments for a specific product
async function handleImageUpdate(request, env) {
  try {
    const body = await request.json();
    const { originalDomain, shopDomain, productId, variants, images } = body;

    console.log(`🖼️ Handling image update for product ${productId}`);

    // Get auth data using original domain
    const authData = await getAuthData(env, originalDomain);
    const { accessToken } = authData.shopify;
    
    // Use shopify domain for API calls
    const baseUrl = `https://${shopDomain}/admin/api/2025-04`;
    const headers = {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': accessToken
    };

    // Process image attachments
    const results = { successful: [], failed: [] };
    
    for (const imageData of images) {
      try {
        const mutation = `
          mutation productAppendImages($productId: ID!, $images: [ImageInput!]!) {
            productAppendImages(productId: $productId, images: $images) {
              images {
                id
                url
                altText
              }
              userErrors {
                field
                message
              }
            }
          }
        `;

        const response = await fetch(`${baseUrl}/graphql.json`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            query: mutation,
            variables: {
              productId,
              images: [{
                src: imageData.src,
                altText: imageData.altText || '',
                variantIds: imageData.variantIds || []
              }]
            }
          })
        });

        const data = await response.json();
        
        if (data.errors || data.data.productAppendImages.userErrors.length > 0) {
          throw new Error(`Image error: ${JSON.stringify(data.errors || data.data.productAppendImages.userErrors)}`);
        }

        results.successful.push(imageData);
        console.log(`✅ Attached image to product ${productId}`);

      } catch (error) {
        console.error(`❌ Image attachment failed:`, error.message);
        results.failed.push({ ...imageData, error: error.message });
      }
    }

    return new Response(JSON.stringify({
      success: true,
      results,
      summary: `${results.successful.length} successful, ${results.failed.length} failed`
    }), { headers: { 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('❌ Image update handler failed:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

export {
  mutateProducts,
  buildProductSetInput,
  createBulkOperationJsonl,
  monitorBulkOperation,
  updateInventoryLevels,
  archiveProducts,
  handleProductQueueMessage,
  handleInventoryUpdate,
  handleImageUpdate
}; 