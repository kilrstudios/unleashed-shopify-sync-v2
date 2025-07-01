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

// Generate variant title from options
function generateVariantTitle(options) {
  if (!options || !options.length) return 'Default Title';
  return options.map(opt => opt.value).join(' / ');
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
        title: variant.title || 'Default Title',
        sku: variant.sku,
        price: variant.price?.toString(),
        weight: variant.weight,
        weightUnit: 'GRAMS',
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
        inventoryPolicy: variant.inventory_policy || 'DENY'
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

      // Handle variant options
      if (variant.option1) variantInput.option1 = variant.option1;
      if (variant.option2) variantInput.option2 = variant.option2;
      if (variant.option3) variantInput.option3 = variant.option3;

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

  // Handle product options for multi-variant products
  if (productData.options && productData.options.length > 0) {
    input.options = productData.options.map(option => option.name);
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

// Main function to execute all product mutations
async function mutateProducts(shopifyAuth, mappingResults) {
  console.log('🚀 === STARTING PRODUCT MUTATIONS ===');
  
  const { accessToken, shopDomain } = shopifyAuth;
  const baseUrl = `https://${shopDomain}/admin/api/2025-04`;
  const headers = {
    'Content-Type': 'application/json',
    'X-Shopify-Access-Token': accessToken
  };

  const results = {
    bulkOperation: null,
    created: { successful: [], failed: [] },
    updated: { successful: [], failed: [] },
    archived: { successful: [], failed: [] },
    inventory: { successful: [], failed: [] },
    summary: '',
    errors: []
  };

  try {
    // Step 1: Handle bulk operations for creates and updates
    const hasProductUpdates = mappingResults.toCreate.length > 0 || mappingResults.toUpdate.length > 0;
    
    if (hasProductUpdates) {
      console.log(`🔄 Step 1: Preparing bulk operation for ${mappingResults.toCreate.length} creates and ${mappingResults.toUpdate.length} updates...`);
      
      // Create JSONL content
      const jsonlContent = createBulkOperationJsonl(mappingResults.toCreate, mappingResults.toUpdate);
      console.log(`📄 Generated JSONL with ${jsonlContent.split('\n').length} operations`);
      
      // Upload JSONL file
      const stagedUploadUrl = await uploadJsonlFile(baseUrl, headers, jsonlContent);
      
      // Start bulk operation
      const bulkOperation = await startBulkOperation(baseUrl, headers, stagedUploadUrl);
      
      // Monitor operation completion
      const operationResult = await monitorBulkOperation(baseUrl, headers, bulkOperation.id);
      
      results.bulkOperation = operationResult;
      
      if (operationResult.success) {
        // Parse results
        const bulkResults = await parseBulkOperationResults(operationResult.resultUrl);
        
        // Process bulk results
        bulkResults.forEach(result => {
          if (result.data && result.data.productSet) {
            const productSet = result.data.productSet;
            if (productSet.userErrors && productSet.userErrors.length > 0) {
              results.errors.push({
                type: 'bulk_product_error',
                errors: productSet.userErrors
              });
            } else if (productSet.product) {
              // Determine if this was a create or update based on whether we provided an ID
              // This is a simplification - in a real implementation you might want to track this more precisely
              results.created.successful.push(productSet.product);
            }
          }
        });
        
        console.log(`✅ Bulk operation completed successfully`);
      } else {
        throw new Error(`Bulk operation failed: ${operationResult.error}`);
      }
    }

    // Step 2: Handle product archival (individual operations)
    if (mappingResults.toArchive.length > 0) {
      console.log(`🗄️ Step 2: Archiving ${mappingResults.toArchive.length} products...`);
      const archiveResults = await archiveProducts(baseUrl, headers, mappingResults.toArchive);
      results.archived = archiveResults;
    }

    // Step 3: Handle inventory updates (if needed)
    // Note: Inventory updates would need to be prepared based on the bulk operation results
    // This is a placeholder for now - you would need to implement inventory delta calculation
    
    // Generate summary
    results.summary = `Products: ${results.created.successful.length} created, ${results.updated.successful.length} updated, ${results.archived.successful.length} archived. Errors: ${results.errors.length}`;

  } catch (error) {
    console.error('🚨 Product mutations failed:', error);
    results.errors.push({
      type: 'critical_error',
      message: error.message
    });
    results.summary = `Product mutations failed: ${error.message}`;
  }

  console.log('✅ === PRODUCT MUTATIONS COMPLETE ===');
  return results;
}

export {
  mutateProducts,
  buildProductSetInput,
  createBulkOperationJsonl,
  monitorBulkOperation,
  updateInventoryLevels,
  archiveProducts
}; 