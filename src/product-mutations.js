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

function getAttributeValue(attributeSet, attributeName) {
  if (!attributeSet || !attributeSet.Attributes) return null;
  const attribute = attributeSet.Attributes.find(attr => attr.Name === attributeName);
  return attribute ? attribute.Value : null;
}

// Generate variant title from AttributeSet
function generateVariantTitle(attributeSet) {
  if (!attributeSet) return 'Default Title';
  
  const values = [
    getAttributeValue(attributeSet, 'Option 1 Value'),
    getAttributeValue(attributeSet, 'Option 2 Value'),
    getAttributeValue(attributeSet, 'Option 3 Value')
  ].filter(Boolean);
  
  if (!values.length) return 'Default Title';
  return values.join(' / ');
}

function parseOptionNames(optionNamesStr) {
  if (!optionNamesStr) return [];
  return optionNamesStr.split(/[|,]/).map(name => name.trim()).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Global variables used by product builders and queue consumer
// These are populated once per Worker instance when the queue consumer fetches
// the locations list. buildProductSetInput relies on them being defined.
// ---------------------------------------------------------------------------
let shopifyLocations;           // Array of { id, name, ... }
let firstProductPayloadLogged = false; // Debug flag – log first payload only

// ---------------------------------------------------------------------------
// Helper: perform Shopify GraphQL request with exponential-backoff retry when
// the platform responds with THROTTLED errors. This dramatically reduces the
// chance our Worker crashes a queue batch due to bursty write traffic.
// ---------------------------------------------------------------------------
async function shopifyGraphQLWithRetry(url, headers, payload, maxRetries = 5) {
  let attempt = 0;
  while (true) {
    const resp = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    // Non-200 HTTP? bail unless we can retry safely (Shopify uses 200 even for
    // GraphQL errors, but handle generic 5xx as well)
    if (!resp.ok && resp.status >= 500 && attempt < maxRetries) {
      const wait = Math.min(1000 * Math.pow(2, attempt), 10000);
      console.warn(`⚠️ HTTP ${resp.status} – retrying in ${wait}ms (attempt ${attempt + 1}/${maxRetries})`);
      await new Promise(r => setTimeout(r, wait));
      attempt++;
      continue;
    }

    const data = await resp.json();

    // Detect Shopify throttling error in GraphQL error extensions
    const isThrottled = Array.isArray(data.errors) && data.errors.some(e => e.extensions?.code === 'THROTTLED');

    if (isThrottled && attempt < maxRetries) {
      const wait = Math.min(1000 * Math.pow(2, attempt), 15000);
      console.warn(`⏳ Shopify throttled – waiting ${wait}ms then retrying (attempt ${attempt + 1}/${maxRetries})`);
      await new Promise(r => setTimeout(r, wait));
      attempt++;
      continue;
    }

    return { response: resp, data };
  }
}

// Build productSet input for bulk operation
function buildProductSetInput(productData, isUpdate = false) {
  // Determine if this is a single-variant product with default options only
  const isSingleVariantDefault = !productData.options || 
    productData.options.length === 0 || 
    (productData.options.length === 1 && productData.options[0].name === 'Title');
  
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
            value: JSON.stringify({
              amount: mf.value.toString(),
              currency_code: "AUD"  // Default to AUD - should be shop's currency
            }),
            type: 'money'
          }));
      }

      // Always add optionValues - Shopify requires this field for productSet API
      if (isSingleVariantDefault) {
        // Single-variant products need Default Title option value
        variantInput.optionValues = [{ optionName: "Title", name: "Default Title" }];
      } else {
        // Multi-variant products with actual option values
        const optionValues = [];
        if (variant.option1) optionValues.push({ optionName: productData.options[0]?.name || 'Option1', name: variant.option1 });
        if (variant.option2) optionValues.push({ optionName: productData.options[1]?.name || 'Option2', name: variant.option2 });
        if (variant.option3) optionValues.push({ optionName: productData.options[2]?.name || 'Option3', name: variant.option3 });
        
        // If no option values found, fall back to default
        variantInput.optionValues = optionValues.length > 0 ? optionValues : [{ optionName: "Title", name: "Default Title" }];
      }

      // Add inventory quantities for each location (supports both inventory_levels and inventoryQuantities aliases)
      const invLevels = variant.inventory_levels || variant.inventoryQuantities;
      if (invLevels && shopifyLocations) {
        const qtyByLocation = new Map(); // locationId(GID) -> summed qty

        invLevels.forEach(level => {
          const availableVal = level.available ?? level.quantity;
          if (availableVal === undefined) return;

          // Find matching Shopify location for this stock row.
          const locMatch = shopifyLocations.find(loc => {
            const locNumeric = extractNumericId(loc.id);
            return (
              loc.id === level.locationId ||
              loc.id === level.location_id ||
              locNumeric === level.location_id ||
              locNumeric === level.locationId
            );
          });

          if (!locMatch) return; // no mapping – skip

          const locId = locMatch.id;
          const qty = parseInt(availableVal) || 0;

          // Accumulate – if we've already seen this location for the variant,
          // add the quantities together instead of creating a duplicate entry.
          qtyByLocation.set(locId, (qtyByLocation.get(locId) || 0) + qty);
        });

        // Build inventoryQuantities array from the collapsed map.
        variantInput.inventoryQuantities = Array.from(qtyByLocation.entries()).map(([locationId, quantity]) => ({
          locationId,
          name: "available",
          quantity
        }));
      }

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

  // Handle product options
  if (isSingleVariantDefault) {
    // Single variant products need at least one option
    input.productOptions = [{
      name: 'Title',
      values: [{ name: 'Default Title' }]
    }];
  } else {
    // Multi-variant products - collect all unique option values from variants
    const optionValuesMap = new Map();
    
    productData.variants.forEach(variant => {
      if (variant.option1) {
        if (!optionValuesMap.has(0)) optionValuesMap.set(0, new Set());
        optionValuesMap.get(0).add(variant.option1);
      }
      if (variant.option2) {
        if (!optionValuesMap.has(1)) optionValuesMap.set(1, new Set());
        optionValuesMap.get(1).add(variant.option2);
      }
      if (variant.option3) {
        if (!optionValuesMap.has(2)) optionValuesMap.set(2, new Set());
        optionValuesMap.get(2).add(variant.option3);
      }
    });

    input.productOptions = productData.options.map((option, index) => ({
      name: option.name || option,
      values: optionValuesMap.has(index) 
        ? Array.from(optionValuesMap.get(index)).map(value => ({ name: value }))
        : [{ name: 'Default' }]
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
  const results = { successful: [], failed: [] };

  console.log(`📦 Starting inventory updates for ${inventoryUpdates.length} items...`);

  // Shopify allows multiple inventory item quantities per call, but to keep
  // the JSON payload tiny we'll push them one-by-one in small batches.
  const batchSize = 10;
  for (let i = 0; i < inventoryUpdates.length; i += batchSize) {
    const batch = inventoryUpdates.slice(i, i + batchSize);
    console.log(`📦 Processing inventory batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(inventoryUpdates.length / batchSize)}`);

    const batchPromises = batch.map(async (update) => {
      try {
        const mutation = `
          mutation inventorySetQuantities($input: InventorySetQuantitiesInput!) {
            inventorySetQuantities(input: $input) {
              inventoryAdjustmentGroup { id }
              userErrors { field message }
            }
          }
        `;

        const variables = {
          input: {
            name: "available",
            reason: "correction",
            onHandQuantities: [{
            locationId: update.locationId,
              inventoryItemId: update.inventoryItemId,
              availableQuantity: update.availableQuantity
            }]
          }
        };

        // Use helper with automatic back-off to avoid Shopify rate-limit errors
        const { data } = await shopifyGraphQLWithRetry(
          `${baseUrl}/graphql.json`,
          headers,
          { query: mutation, variables }
        );
        
        const userErrs = data.data.inventorySetQuantities.userErrors;
        if (userErrs && userErrs.length > 0) {
          console.warn(`⚠️ Inventory userErrors for ${update.inventoryItemId}:`, JSON.stringify(userErrs));
          throw new Error(`Inventory userErrors: ${JSON.stringify(userErrs)}`);
        }

        results.successful.push({
          inventoryItemId: update.inventoryItemId,
          locationId: update.locationId,
          availableQuantity: update.availableQuantity
        });

      } catch (error) {
        console.error(`❌ Inventory update failed for ${update.inventoryItemId}:`, error.message);
        results.failed.push({
          inventoryItemId: update.inventoryItemId,
          locationId: update.locationId,
          availableQuantity: update.availableQuantity,
          error: error.message
        });
      }
    });

    await Promise.all(batchPromises);
    
    if (i + batchSize < inventoryUpdates.length) {
      await new Promise(res => setTimeout(res, 500));
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

      // Use helper with automatic back-off to avoid Shopify rate-limit errors
      const { data } = await shopifyGraphQLWithRetry(
        `${baseUrl}/graphql.json`,
        headers,
        { query: mutation, variables }
      );
      
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
        
        // Use helper with automatic back-off to avoid Shopify rate-limit errors
        const { data } = await shopifyGraphQLWithRetry(
          `${baseUrl}/graphql.json`,
          headers,
          { query: mutation, variables }
        );
        
        if (data.errors && data.errors.length) {
          throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
        }

        if (data.data?.productSet?.userErrors?.length) {
          throw new Error(`Product errors: ${JSON.stringify(data.data.productSet.userErrors)}`);
        }

        results.successful.push({
          original: product,
          result: data.data?.productSet?.product
        });

        console.log(`✅ Successfully ${isUpdate ? 'updated' : 'created'} product: "${data.data?.productSet?.product?.title}"`);

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
  console.log(`🔗 Using Shopify API base URL: ${baseUrl}`);
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

// Main function: Decides between comprehensive, queue, and direct methods
async function mutateProducts(shopifyAuth, mappingResults, env = null, originalDomain = null, shopifyLocations = null, useComprehensive = true) {
  // 🔒 Force queue-based product mutations for all operations to avoid sub-request limits
  return await mutateProductsViaQueue(env, shopifyAuth, mappingResults, originalDomain);
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
        
        // --- Ensure we have the Shopify locations list loaded for inventory mapping ---
        if (!shopifyLocations) {
          try {
            const locQuery = `query { locations(first: 250) { edges { node { id name } } } }`;
            const locResp = await fetch(`${baseUrl}/graphql.json`, {
              method: 'POST',
              headers,
              body: JSON.stringify({ query: locQuery })
            });
            const locData = await locResp.json();
            shopifyLocations = (locData.data?.locations?.edges || []).map(e => e.node);
            console.log(`📍 Loaded ${shopifyLocations.length} Shopify locations`);
          } catch (locErr) {
            console.error('🚨 Failed to load Shopify locations', locErr);
            shopifyLocations = [];
          }
        }

        // ---------------------------------------------------------------
        // Build mutation payload and log the very first one for debugging
        // ---------------------------------------------------------------
        const variables = buildProductSetInput(message.productData, message.type === 'UPDATE_PRODUCT');

        if (!firstProductPayloadLogged) {
          console.log('📝 First productSet payload:', JSON.stringify(variables).slice(0, 2000));
          firstProductPayloadLogged = true;
        }

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

        // Execute the mutation
        // Use helper with automatic back-off to avoid Shopify rate-limit errors
        const { data } = await shopifyGraphQLWithRetry(
          `${baseUrl}/graphql.json`,
          headers,
          { query: mutation, variables }
        );
        
        if (data.errors && data.errors.length) {
          throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
        }

        if (data.data?.productSet?.userErrors?.length) {
          throw new Error(`Product errors: ${JSON.stringify(data.data.productSet.userErrors)}`);
        }

        result = data.data?.productSet?.product;
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
                name: "available",
                reason: "correction",
                onHandQuantities: [{
                locationId: update.locationId,
                  inventoryItemId: update.inventoryItemId,
                  availableQuantity: update.availableQuantity
                }]
              }
            }
          })
        });

        const data = await response.json();
        
        const userErrs = data.data.inventorySetQuantities.userErrors;
        if (userErrs && userErrs.length > 0) {
          console.warn(`⚠️ Inventory userErrors for ${update.inventoryItemId}:`, JSON.stringify(userErrs));
          throw new Error(`Inventory userErrors: ${JSON.stringify(userErrs)}`);
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
    
    // Helper to reduce a filename like "foo_1024x.jpg" or CDN variants to its
    // base key "foo.jpg" for reliable matching.
    const baseKey = (fullPath) => {
      const file = fullPath.split('/').pop().split('?')[0]; // filename.ext
      const parts = file.split('.');
      const ext = parts.pop();
      const stem = parts.join('.');
      const stemBase = stem.split('_')[0]; // strip Shopify size suffix
      return `${stemBase}.${ext}`;
    };
    
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

async function createProduct(shopifyClient, productData) {
  try {
    const mutation = `
      mutation productCreate($input: ProductInput!) {
        productCreate(input: $input) {
          product {
            id
            title
            handle
            variants(first: 10) {
              edges {
                node {
                  id
                  sku
                  title
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

    const variables = {
      input: {
        ...productData,
        variants: productData.variants.map(variant => ({
          ...variant,
          inventoryItem: {
            tracked: variant.inventory_management === 'shopify'
          }
        }))
      }
    };

    const response = await shopifyClient.request(mutation, variables);
    return response.productCreate;
  } catch (error) {
    console.error('Error creating product:', error);
    throw error;
  }
}

async function updateProduct(shopifyClient, productData) {
  try {
    // First, get the existing variants to map IDs
    const existingProduct = await getProductById(shopifyClient, productData.id);
    const existingVariants = existingProduct.variants.edges.map(edge => edge.node);

    // Map variant IDs
    productData.variants = productData.variants.map(variant => {
      const existingVariant = existingVariants.find(ev => ev.sku === variant.sku);
      if (existingVariant) {
        variant.id = existingVariant.id;
      }
      return variant;
    });

    const mutation = `
      mutation productUpdate($input: ProductInput!) {
        productUpdate(input: $input) {
          product {
            id
            title
            handle
            variants(first: 10) {
              edges {
                node {
                  id
                  sku
                  title
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

    const variables = {
      input: {
        ...productData,
        variants: productData.variants.map(variant => ({
          ...variant,
          inventoryItem: {
            tracked: variant.inventory_management === 'shopify'
          }
        }))
      }
    };

    const response = await shopifyClient.request(mutation, variables);
    return response.productUpdate;
  } catch (error) {
    console.error('Error updating product:', error);
    throw error;
  }
}

async function getProductById(shopifyClient, productId) {
  try {
    const query = `
      query getProduct($id: ID!) {
        product(id: $id) {
          id
          title
          handle
          variants(first: 10) {
            edges {
              node {
                id
                sku
                title
                inventoryItemId
              }
            }
          }
        }
      }
    `;

    const variables = {
      id: productId
    };

    const response = await shopifyClient.request(query, variables);
    return response.product;
  } catch (error) {
    console.error('Error getting product by ID:', error);
    throw error;
  }
}

// Build comprehensive productSet input for single mutation
function buildComprehensiveProductSetInput(productData, shopifyLocations, isUpdate = false) {
  // Determine if this is a single-variant product with default options only
  const isSingleVariantDefault = !productData.options || 
    productData.options.length === 0 || 
    (productData.options.length === 1 && productData.options[0].name === 'Title');
  
  const input = {
    title: productData.title,
    handle: productData.handle || productData.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''),
    status: productData.status || 'ACTIVE',
    productType: productData.product_type || '',
    vendor: productData.vendor || 'Default',
    tags: productData.tags || []
  };

  // Add product ID if updating
  if (isUpdate && productData.id) {
    input.id = productData.id;
  }

  // Add product description
  if (productData.description) {
    input.descriptionHtml = productData.description;
  }

  // Add product metafields
  if (productData.metafields && productData.metafields.length > 0) {
    input.metafields = productData.metafields
      .filter(mf => mf.value && mf.value.toString().trim() !== '')
      .map(mf => ({
        namespace: mf.namespace,
        key: mf.key,
        value: mf.value.toString(),
        type: mf.type || 'single_line_text_field'
      }));
  }

  // Handle product options - build productOptions array first
  if (isSingleVariantDefault) {
    input.productOptions = [{
      name: 'Title',
      position: 1,
      values: [{ name: 'Default Title' }]
    }];
  } else {
    const optionValuesMap = new Map();
    
    productData.variants.forEach(variant => {
      if (variant.option1) {
        if (!optionValuesMap.has(0)) optionValuesMap.set(0, new Set());
        optionValuesMap.get(0).add(variant.option1);
      }
      if (variant.option2) {
        if (!optionValuesMap.has(1)) optionValuesMap.set(1, new Set());
        optionValuesMap.get(1).add(variant.option2);
      }
      if (variant.option3) {
        if (!optionValuesMap.has(2)) optionValuesMap.set(2, new Set());
        optionValuesMap.get(2).add(variant.option3);
      }
    });

    input.productOptions = productData.options.map((option, index) => ({
      name: option.name || option,
      position: index + 1,
      values: optionValuesMap.has(index) 
        ? Array.from(optionValuesMap.get(index)).map(value => ({ name: value }))
        : [{ name: 'Default' }]
    }));
  }

  // Build variants array
  input.variants = productData.variants.map(variant => {
    const variantInput = {
      sku: variant.sku,
      price: variant.price?.toString()
    };

    // Add variant ID if updating
    if (isUpdate && variant.id) {
      variantInput.id = variant.id;
    }

    // Add optionValues - required for productSet API
    if (isSingleVariantDefault) {
      variantInput.optionValues = [{ optionName: "Title", name: "Default Title" }];
    } else {
      const optionValues = [];
      if (variant.option1) optionValues.push({ optionName: productData.options[0]?.name || 'Option1', name: variant.option1 });
      if (variant.option2) optionValues.push({ optionName: productData.options[1]?.name || 'Option2', name: variant.option2 });
      if (variant.option3) optionValues.push({ optionName: productData.options[2]?.name || 'Option3', name: variant.option3 });
      
      variantInput.optionValues = optionValues.length > 0 ? optionValues : [{ optionName: "Title", name: "Default Title" }];
    }

    // Add inventoryItem details
    variantInput.inventoryItem = {
      tracked: variant.inventory_management === 'shopify'
    };

    // Add weight measurement
    if (variant.weight) {
      variantInput.inventoryItem.measurement = {
        weight: {
          value: parseFloat(variant.weight) || 0,
          unit: 'KILOGRAMS'  // Using KILOGRAMS to match your example
        }
      };
    }

    // Add cost if available
    if (variant.cost) {
      variantInput.inventoryItem.cost = variant.cost.toString();
    }

    // Add inventory quantities for each location (supports both inventory_levels and inventoryQuantities aliases)
    const invLevels = variant.inventory_levels || variant.inventoryQuantities;
    if (invLevels && shopifyLocations) {
      const qtyByLocation = new Map(); // locationId(GID) -> summed qty

      invLevels.forEach(level => {
        const availableVal = level.available ?? level.quantity;
        if (availableVal === undefined) return;

        // Find matching Shopify location for this stock row.
        const locMatch = shopifyLocations.find(loc => {
          const locNumeric = extractNumericId(loc.id);
          return (
            loc.id === level.locationId ||
            loc.id === level.location_id ||
            locNumeric === level.location_id ||
            locNumeric === level.locationId
          );
        });

        if (!locMatch) return; // no mapping – skip

        const locId = locMatch.id;
        const qty = parseInt(availableVal) || 0;

        // Accumulate – if we've already seen this location for the variant,
        // add the quantities together instead of creating a duplicate entry.
        qtyByLocation.set(locId, (qtyByLocation.get(locId) || 0) + qty);
      });

      // Build inventoryQuantities array from the collapsed map.
      variantInput.inventoryQuantities = Array.from(qtyByLocation.entries()).map(([locationId, quantity]) => ({
        locationId,
        name: "available",
        quantity
      }));
    }

    // Add metafields for price tiers - matching your exact format
    if (variant.metafields && variant.metafields.length > 0) {
      variantInput.metafields = variant.metafields
        .filter(mf => mf.value && mf.value.toString().trim() !== '')
        .map(mf => ({
          key: mf.key,
          namespace: mf.namespace,
          value: mf.type === 'money' ? JSON.stringify({
            amount: mf.value.toString(),
            currency_code: "AUD"
          }) : mf.value.toString(),
          type: mf.type || 'single_line_text_field'
        }));
    }

    return variantInput;
  });

  return input;
}

// Execute comprehensive productSet mutation with image handling
async function executeComprehensiveProductSet(baseUrl, headers, productData, shopifyLocations, isUpdate = false) {
  const mutation = `
    mutation productSet($input: ProductSetInput!) {
      productSet(input: $input) {
        product {
          id
          handle
          title
          variants(first: 250) {
            edges {
              node {
                id
                sku
                title
                image {
                  id
                }
                media(first: 10) {
                  edges {
                    node {
                      ... on MediaImage { id }
                    }
                  }
                }
                inventoryItem {
                  id
                }
              }
            }
          }
        }
        userErrors {
          field
          message
          code
        }
      }
    }
  `;

  const input = buildComprehensiveProductSetInput(productData, shopifyLocations, isUpdate);
  
  console.log(`🔄 Executing comprehensive productSet for: ${productData.title}`);
  
  const response = await fetch(`${baseUrl}/graphql.json`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      query: mutation,
      variables: { input }
    })
  });

  const result = await response.json();
  
  if (result.errors) {
    console.error('❌ GraphQL errors:', result.errors);
    throw new Error(`GraphQL errors: ${JSON.stringify(result.errors)}`);
  }

  if (result.data?.productSet?.userErrors?.length > 0) {
    console.error('❌ ProductSet user errors:', result.data.productSet.userErrors);
    throw new Error(`ProductSet errors: ${JSON.stringify(result.data.productSet.userErrors)}`);
  }

  const productSetResult = result.data.productSet;

  // Handle variant images after product creation/update, ensuring no duplicate uploads or links
  let imageResult = null;
  if (productData.images && productData.images.length > 0) {
    console.log(`🖼️ Processing ${productData.images.length} images for product: ${productSetResult.product.title}`);
    imageResult = await handleVariantImages(baseUrl, headers, productSetResult, productData);
  }

  return {
    ...productSetResult,
    imageProcessing: imageResult
  };
}

// New comprehensive mutation function that handles everything at once
async function mutateProductsComprehensive(shopifyAuth, mappingResults, shopifyLocations) {
  const baseUrl = `https://${shopifyAuth.shopDomain}/admin/api/2025-04`;
  console.log(`🔗 Using Shopify API base URL: ${baseUrl}`);
  const headers = {
    'Content-Type': 'application/json',
    'X-Shopify-Access-Token': shopifyAuth.accessToken
  };

  // If true we perform a second inventorySetQuantities call after productSet; normally unnecessary
  const enableSeparateInventoryPush = false;

  const results = {
    method: 'comprehensive',
    created: { successful: [], failed: [] },
    updated: { successful: [], failed: [] },
    archived: { successful: [], failed: [] },
    images: { successful: [], failed: [] },
    inventory: { successful: [], failed: [] },
    errors: [],
    summary: { created: 0, updated: 0, archived: 0, failed: 0, imagesProcessed: 0, imagesFailed: 0, inventoryPushed: 0, inventoryFailed: 0 }
  };

  // Helper to translate product+variant info into inventory updates
  function buildInventoryUpdates(resultProduct, sourceProduct) {
    const updates = [];
    if (!resultProduct || !resultProduct.variants || !sourceProduct?.variants) return updates;

    resultProduct.variants.edges.forEach(edge => {
      const sku = edge.node.sku;
      const inventoryItemId = edge.node.inventoryItem?.id;
      const variantData = sourceProduct.variants.find(v => v.sku === sku);
      if (!inventoryItemId || !variantData?.inventoryQuantities?.length) return;
      variantData.inventoryQuantities.forEach(iq => {
        const qty = parseInt(iq.quantity) || 0;
        if (qty === 0) return; // nothing to push
        updates.push({
          inventoryItemId,
          locationId: iq.locationId,
          availableQuantity: qty
        });
      });
    });
    return updates;
  }

  // Process product creations
  console.log(`🆕 Processing ${mappingResults.toCreate.length} products to create...`);
  for (const product of mappingResults.toCreate) {
    try {
      const result = await executeComprehensiveProductSet(baseUrl, headers, product, shopifyLocations, false);
      results.created.successful.push({
        product: result.product,
        originalData: product,
        imageProcessing: result.imageProcessing
      });
      results.summary.created++;
      
      // Track image processing results
      if (result.imageProcessing) {
        if (result.imageProcessing.success) {
          results.images.successful.push({
            productTitle: product.title,
            ...result.imageProcessing
          });
          results.summary.imagesProcessed++;
        } else {
          results.images.failed.push({
            productTitle: product.title,
            error: result.imageProcessing.error
          });
          results.summary.imagesFailed++;
        }
      }
      
      // --- Push inventory levels (optional) ---
      const inventoryUpdates = enableSeparateInventoryPush ? buildInventoryUpdates(result.product, product) : [];
      if (enableSeparateInventoryPush && inventoryUpdates.length > 0) {
        const invRes = await updateInventoryLevels(baseUrl, headers, inventoryUpdates);
        results.inventory.successful.push(...invRes.successful);
        results.inventory.failed.push(...invRes.failed);
        results.summary.inventoryPushed += invRes.successful.length;
        results.summary.inventoryFailed += invRes.failed.length;
      }
      
      console.log(`✅ Created product: ${product.title}`);
    } catch (error) {
      console.error(`❌ Failed to create product: ${product.title}`, error);
      results.created.failed.push({
        product,
        error: error.message
      });
      results.errors.push({
        operation: 'create',
        product: product.title,
        error: error.message
      });
      results.summary.failed++;
    }
  }

  // Process product updates
  console.log(`🔄 Processing ${mappingResults.toUpdate.length} products to update...`);
  for (const product of mappingResults.toUpdate) {
    try {
      const result = await executeComprehensiveProductSet(baseUrl, headers, product, shopifyLocations, true);
      results.updated.successful.push({
        product: result.product,
        originalData: product,
        imageProcessing: result.imageProcessing
      });
      results.summary.updated++;
      
      // Track image processing results
      if (result.imageProcessing) {
        if (result.imageProcessing.success) {
          results.images.successful.push({
            productTitle: product.title,
            ...result.imageProcessing
          });
          results.summary.imagesProcessed++;
        } else {
          results.images.failed.push({
            productTitle: product.title,
            error: result.imageProcessing.error
          });
          results.summary.imagesFailed++;
        }
      }
      
      // --- Push inventory levels (optional) ---
      const inventoryUpdates = enableSeparateInventoryPush ? buildInventoryUpdates(result.product, product) : [];
      if (enableSeparateInventoryPush && inventoryUpdates.length > 0) {
        const invRes = await updateInventoryLevels(baseUrl, headers, inventoryUpdates);
        results.inventory.successful.push(...invRes.successful);
        results.inventory.failed.push(...invRes.failed);
        results.summary.inventoryPushed += invRes.successful.length;
        results.summary.inventoryFailed += invRes.failed.length;
      }
      
      console.log(`✅ Updated product: ${product.title}`);
    } catch (error) {
      console.error(`❌ Failed to update product: ${product.title}`, error);
      results.updated.failed.push({
        product,
        error: error.message
      });
      results.errors.push({
        operation: 'update',
        product: product.title,
        error: error.message
      });
      results.summary.failed++;
    }
  }

  // Process product archiving (still need separate mutations for this)
  if (mappingResults.toArchive.length > 0) {
    console.log(`🗄️ Processing ${mappingResults.toArchive.length} products to archive...`);
    try {
      const archiveResults = await archiveProducts(baseUrl, headers, mappingResults.toArchive);
      results.archived = archiveResults;
      results.summary.archived = archiveResults.successful.length;
      results.summary.failed += archiveResults.failed.length;
    } catch (error) {
      console.error('❌ Failed to archive products:', error);
      results.errors.push({
        operation: 'archive',
        error: error.message
      });
    }
  }

  console.log(`✅ Comprehensive mutation completed:`, results.summary);
  return results;
}

// Handle variant images after product creation/update, ensuring no duplicate uploads or links
async function handleVariantImages(baseUrl, headers, productResult, productData) {
  if (!productData.images || productData.images.length === 0) {
    return { success: true, message: 'No images to process' };
  }

  console.log(`🖼️ Processing ${productData.images.length} images for product: ${productResult.product.title}`);

  try {
    // ---------------------------------------------
    // 1. Fetch existing images + build helper maps
    // ---------------------------------------------
    const existingImages = await getProductImages(baseUrl, headers, productResult.product.id);

    // ------------------------------------------------------
    // Build variant → media mapping using variant.media IDs
    // (Media IDs are required by productVariantDetachMedia / AppendMedia).
    // ------------------------------------------------------
    const variantImageMap = new Map(); // variantId → Set(mediaIds)

    productResult.product.variants.edges.forEach(edge => {
      const vId = edge.node.id;
      // Collect MediaImage IDs attached to this variant
      (edge.node.media?.edges || []).forEach(mEdge => {
        const mId = mEdge.node?.id;
        if (mId) {
          if (!variantImageMap.has(vId)) variantImageMap.set(vId, new Set());
          variantImageMap.get(vId).add(mId);
        }
      });
      // Fallback to deprecated image.id if still present (older uploads)
      const legacyImgId = edge.node.image?.id;
      if (legacyImgId) {
        if (!variantImageMap.has(vId)) variantImageMap.set(vId, new Set());
        variantImageMap.get(vId).add(legacyImgId);
      }
    });

    // Helper to create a stable key for an image URL (strip CDN params & size suffixes)
    const baseKey = (fullPath) => {
      const file = fullPath.split('/').pop().split('?')[0]; // filename.ext
      const parts = file.split('.');
      const ext = parts.pop();
      const stem = parts.join('.');
      const stemBase = stem.split('_')[0]; // strip Shopify size suffix
      return `${stemBase}.${ext}`;
    };

    // NEW helper – canonical GUID (pre-underscore, no extension)
    const guidOf = (url) => {
      const file = url.split('/').pop().split('?')[0];
      return file.split('.')[0].split('_')[0];
    };

    // Map of guid → image for quick lookup
    const existingByGuid = new Map(existingImages.map(img => [img.guid || guidOf(img.originalSrc), img]));
    // Map of baseKey → imageId for images already on the product
    const existingByKey = new Map(existingImages.map(img => [baseKey(img.originalSrc), img]));
    // NEW: Map of imageId → baseKey to allow reverse look-ups (needed for variant checks)
    const existingById = new Map(existingImages.map(img => [img.id, baseKey(img.originalSrc)]));

    // Ensure we only treat each canonical image once even if productData lists it multiple times
    const canonicalSeen = new Set();

    // ------------------------------------------------------
    // 2. Decide which images need uploading / variant linking
    // ------------------------------------------------------
    const imagesToUpload = [];
    const imageVariantMappings = []; // {imageId, variantSkus[]}

    for (const imageData of productData.images) {
      const guid = guidOf(imageData.src);
      const key = baseKey(imageData.src);
      if (canonicalSeen.has(guid)) continue;
      canonicalSeen.add(guid);

      const maybeExisting = existingByGuid.get(guid) || existingByKey.get(key);
      if (maybeExisting) {
        if (imageData.variantSkus && imageData.variantSkus.length) {
          imageVariantMappings.push({ imageId: maybeExisting.id, variantSkus: imageData.variantSkus, src: imageData.src });
        }
      } else {
        imagesToUpload.push({ ...imageData, guid });
      }
    }

    // ---------------------------------------------
    // 3. Upload missing images (once per unique URL)
    // ---------------------------------------------
    let uploadedImages = [];
    if (imagesToUpload.length) {
      uploadedImages = await uploadProductImages(baseUrl, headers, productResult.product.id, imagesToUpload);
      // Merge them into existing maps so subsequent logic sees them as present
      uploadedImages.forEach(uImg => {
        existingByKey.set(baseKey(uImg.originalSrc), uImg);
        existingByGuid.set(uImg.guid, uImg);
      });
    }

    // Add variant mappings for uploaded images
    for (const uImg of uploadedImages) {
      const original = imagesToUpload.find(i => i.src === uImg.originalSrc);
      if (original?.variantSkus?.length) {
        imageVariantMappings.push({ imageId: uImg.id, variantSkus: original.variantSkus, src: uImg.originalSrc });
      }
    }

    // ------------------------------------------------
    // 4. Build final ImageInput list, skipping dupes
    // ------------------------------------------------
    // SKU → variantId map
    const variantIdMap = new Map();
    productResult.product.variants.edges.forEach(edge => variantIdMap.set(edge.node.sku, edge.node.id));

    const imagesToLink = [];

    const sourceMappings = imageVariantMappings.length > 0 ? imageVariantMappings : [];
    sourceMappings.forEach(mapping => {
      const mappingKey = baseKey(mapping.src || ""); // canonical key for this image

      // Helper: does variant already have *any* media with the same canonical key?
      const variantHasKey = (vId) => {
        const idSet = variantImageMap.get(vId);
        if (!idSet) return false;
        for (const mId of idSet) {
          if (existingById.get(mId) === mappingKey) return true;
        }
        return false;
      };

      const variantIdsFromSku = (mapping.variantSkus || []).map(sku => variantIdMap.get(sku));
      const variantIds = (mapping.variantIds || []).concat(variantIdsFromSku)
        .filter(Boolean)
        // Skip if variant already linked to an image with the same canonical key
        .filter(vId => !variantHasKey(vId));

      if (variantIds.length) {
        imagesToLink.push({ id: mapping.imageId, variantIds });
        variantIds.forEach(vId => {
          if (!variantImageMap.has(vId)) variantImageMap.set(vId, new Set());
          variantImageMap.get(vId).add(mapping.imageId);
        });
      }
    });

    // ------------------------------------------------
    // 5. Optionally detach images from variants that should have none
    // ------------------------------------------------
    const variantsWithDesired = new Set();
    imagesToLink.forEach(({ variantIds }) => variantIds.forEach(id => variantsWithDesired.add(id)));

    const detachMap = new Map();
    imagesToLink.forEach(({ id, variantIds }) => {
      variantIds.forEach(vId => {
        if (!variantsWithDesired.has(vId)) {
          // variant is not meant to have any images – mark all current ones for detach
          const currentSet = variantImageMap.get(vId) || new Set();
          if (currentSet.size) {
            detachMap.set(vId, new Set([...currentSet]));
          }
        }
      });
    });

    // ---------------------------------------------
    // 6. Run single productAppendImages call to link
    // ---------------------------------------------
    const prodId = productResult.product.id;

    console.log(`🔗 Preparing media detach/append for ${imagesToLink.length} image sets ...`);

    // Build detach inputs (one per variant) – Shopify requires each variantId appear only once
    const detachInputs = Array.from(detachMap.entries())
      .map(([variantId, idSet]) => ({ variantId, mediaIds: [Array.from(idSet)[0]] }));

    if (detachInputs.length) {
      console.log(`🗑️ Detaching existing media from ${detachInputs.length} variant(s) first ...`);
      const detachMutation = `
        mutation ProductVariantDetachMedia($productId: ID!, $variantMedia: [ProductVariantDetachMediaInput!]!) {
          productVariantDetachMedia(productId: $productId, variantMedia: $variantMedia) {
            userErrors { field message }
          }
        }
      `;

      const detachRes = await fetch(`${baseUrl}/graphql.json`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          query: detachMutation,
          variables: { productId: prodId, variantMedia: detachInputs }
        })
      });

      const detachJson = await detachRes.json();
      if (detachJson.errors) {
        throw new Error(`Failed to detach media: ${JSON.stringify(detachJson.errors)}`);
      }
      const du = detachJson.data.productVariantDetachMedia.userErrors;
      if (du && du.length) {
        throw new Error(`Media detach errors: ${JSON.stringify(du)}`);
      }
    }

    if (imagesToLink.length) {
      console.log(`🔗 Appending media to variants via productVariantAppendMedia ...`);

      // Build append inputs with UNIQUE variantId (Shopify requirement).
      const appendMap = new Map(); // variantId → mediaId (choose first)
      imagesToLink.forEach(({ id, variantIds }) => {
        variantIds.forEach(vId => {
          if (!appendMap.has(vId)) appendMap.set(vId, id);
        });
      });

      const expanded = Array.from(appendMap.entries()).map(([variantId, mediaId]) => ({ variantId, mediaIds: [mediaId] }));

      const appendMutation = `
        mutation ProductVariantAppendMedia($productId: ID!, $variantMedia: [ProductVariantAppendMediaInput!]!) {
          productVariantAppendMedia(productId: $productId, variantMedia: $variantMedia) {
            userErrors { field message }
          }
        }
      `;

      const appendRes = await fetch(`${baseUrl}/graphql.json`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          query: appendMutation,
          variables: { productId: prodId, variantMedia: expanded }
        })
      });

      const appendJson = await appendRes.json();
      if (appendJson.errors) {
        throw new Error(`Failed to append media: ${JSON.stringify(appendJson.errors)}`);
      }
      const ue = appendJson.data.productVariantAppendMedia.userErrors;
      if (ue && ue.length) {
        throw new Error(`Image linking errors: ${JSON.stringify(ue)}`);
      }

      console.log(`✅ Successfully linked images to variants`);
    } else {
      console.log('⚠️ No images require linking');
    }

    // -------- Duplicate cleanup --------
    // Build desired GUID set once
    const desiredGuidSet = new Set(productData.images.map(img => guidOf(img.src)));

    const deleteIds = existingImages
      .filter(img => !desiredGuidSet.has(img.guid || guidOf(img.originalSrc)))
      .map(img => img.id)
      .filter(id => !uploadedImages.some(u => u.id === id));

    if (deleteIds.length) {
      console.log(`🗑️ Deleting ${deleteIds.length} obsolete media images ...`);
      const delMutation = `
        mutation mediaDelete($mediaIds: [ID!]!) {
          mediaDelete(mediaIds: $mediaIds) {
            deletedMediaIds
            userErrors { field message }
          }
        }
      `;
      const delRes = await fetch(`${baseUrl}/graphql.json`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ query: delMutation, variables: { mediaIds: deleteIds } })
      });
      const delJson = await delRes.json();
      if (delJson.errors || delJson.data?.mediaDelete?.userErrors?.length) {
        console.warn('⚠️ Media delete errors:', delJson.errors || delJson.data.mediaDelete.userErrors);
      } else {
        console.log(`✅ Removed ${delJson.data.mediaDelete.deletedMediaIds.length} obsolete images`);
      }
    }
    // -------- end cleanup --------

    return {
      success: true,
      uploadedImages: uploadedImages.length,
      linkedImages: imagesToLink.length,
      message: `Uploaded ${uploadedImages.length}, linked to ${imagesToLink.length} images/sets`
    };

  } catch (error) {
    console.error('❌ Error handling variant images:', error);
    return { success: false, error: error.message };
  }
}

// Get existing product images
async function getProductImages(baseUrl, headers, productId) {
  const query = `
    query getProductImages($productId: ID!) {
      product(id: $productId) {
        media(first: 50) {
          edges {
            node {
              ... on MediaImage {
                id
                image {
                  url
                  originalSrc
                }
                metafield(namespace: "unleashed", key: "image_guid") { value }
              }
            }
          }
        }
      }
    }
  `;

  const response = await fetch(`${baseUrl}/graphql.json`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      query,
      variables: { productId }
    })
  });

  const result = await response.json();
  
  if (result.errors) {
    throw new Error(`Failed to get product images: ${JSON.stringify(result.errors)}`);
  }

  // Map the MediaImage nodes to a simpler {id, originalSrc, guid} shape
  return result.data.product.media.edges.map(edge => ({
    id: edge.node.id,
    originalSrc: edge.node.image.url || edge.node.image.originalSrc,
    guid: (edge.node.metafield?.value) || (() => {
      const f = (edge.node.image.url || edge.node.image.originalSrc || '').split('/').pop().split('?')[0];
      return f.split('.')[0].split('_')[0];
    })()
  }));
}

// Upload new images to product
async function uploadProductImages(baseUrl, headers, productId, imagesToUpload) {
  const uploaded = [];

  // Helper: wait until a MediaImage is READY before we try to use it
  const waitForMediaReady = async (mediaId, maxAttempts = 12, delayMs = 1000) => {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const statusQuery = `
        query ($id: ID!) { node(id: $id) { ... on MediaImage { status } } }
      `;
      const res = await fetch(`${baseUrl}/graphql.json`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ query: statusQuery, variables: { id: mediaId } })
      });
      const js = await res.json();
      const status = js.data?.node?.status || 'READY';
      if (status === 'READY') return true;
      await new Promise(r => setTimeout(r, delayMs));
    }
    return false;
  };

  for (const img of imagesToUpload) {
    const guid = img.guid || (() => {
      const file = img.src.split('/').pop().split('?')[0];
      return file.split('.')[0].split('_')[0];
    })();

    const mutation = `
      mutation productCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
        productCreateMedia(productId: $productId, media: $media) {
          media {
            ... on MediaImage {
              id
              image {
                id
                url
                originalSrc
              }
            }
          }
          mediaUserErrors {
            field
            message
          }
        }
      }
    `;

    console.log(`📤 Uploading image ${img.src} ...`);

    const response = await fetch(`${baseUrl}/graphql.json`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        query: mutation,
        variables: {
          productId,
          media: [{
            originalSource: img.src,
            mediaContentType: "IMAGE"
          }]
        }
      })
    });

    const result = await response.json();

    if (result.errors) {
      throw new Error(`Failed to upload image: ${JSON.stringify(result.errors)}`);
    }

    const creation = result.data.productCreateMedia;
    const userErrors = creation.mediaUserErrors;
    if (userErrors && userErrors.length) {
      throw new Error(`Image upload errors: ${JSON.stringify(userErrors)}`);
    }

    const uploadedNode = creation.media[0].image || { id: creation.media[0].id, originalSrc: img.src };
    uploaded.push({
      id: uploadedNode.id,
      originalSrc: uploadedNode.url || uploadedNode.originalSrc || img.src,
      guid
    });

    // Wait until Shopify marks the media READY
    await waitForMediaReady(uploadedNode.id);

    // ➕ Attach GUID metafield
    try {
      const metaMutation = `
        mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
          metafieldsSet(metafields: $metafields) {
            metafields { id }
            userErrors { field message }
          }
        }
      `;
      const metaVars = {
        metafields: [{
          ownerId: uploadedNode.id,
          namespace: "unleashed",
          key: "image_guid",
          type: "single_line_text_field",
          value: guid
        }]
      };
      const metaRes = await fetch(`${baseUrl}/graphql.json`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ query: metaMutation, variables: metaVars })
      });
      const metaJson = await metaRes.json();
      if (metaJson.errors || metaJson.data?.metafieldsSet?.userErrors?.length) {
        console.warn('⚠️ Metafield set errors for image', guid, metaJson.errors || metaJson.data.metafieldsSet.userErrors);
      }
    } catch (e) {
      console.warn('⚠️ Failed to set image GUID metafield:', e.message);
    }
  }

  console.log(`✅ Uploaded ${uploaded.length} images`);
  return uploaded;
}

// Link images to specific variants
async function linkImagesToVariants(baseUrl, headers, productId, productVariants, legacyMappings = [], preBuiltImages = null) {
  // Build map sku -> variantId for convenience
  const variantIdMap = new Map();
  productVariants.forEach(edge => variantIdMap.set(edge.node.sku, edge.node.id));

  const sourceMappings = preBuiltImages && preBuiltImages.length ? preBuiltImages : legacyMappings;
  const imagesToLink = sourceMappings.map(m => {
    let variantIds = Array.isArray(m.variantIds) ? m.variantIds : [];
    if (variantIds.length === 0 && m.variantSkus) {
      variantIds = m.variantSkus.map(sku => variantIdMap.get(sku)).filter(Boolean);
    }
    return { imageId: m.imageId || m.id, variantIds: variantIds.filter(Boolean) };
  }).filter(i => i.variantIds.length);

  if (!imagesToLink.length) {
    console.log('⚠️ No images require linking');
    return;
  }

  console.log(`🔗 Linking ${imagesToLink.length} images to variants via productVariantAppendMedia ...`);

  // We can batch all links in one call; Shopify allows multiple inputs
  const variantMediaInputs = imagesToLink.map(l => ({ variantId: l.variantIds[0], mediaIds: [l.imageId] }));
  // If image needs to attach to multiple variants, create one input per variant (Shopify limitation)
  const expanded = [];
  imagesToLink.forEach(l => {
    l.variantIds.forEach(vId => expanded.push({ variantId: vId, mediaIds: [l.imageId] }));
  });

  const mutation = `
    mutation ProductVariantAppendMedia($productId: ID!, $variantMedia: [ProductVariantAppendMediaInput!]!) {
      productVariantAppendMedia(productId: $productId, variantMedia: $variantMedia) {
        productVariants { id }
        userErrors { field message }
      }
    }
  `;

  const response = await fetch(`${baseUrl}/graphql.json`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      query: mutation,
      variables: { productId, variantMedia: expanded }
    })
  });

  const result = await response.json();

  if (result.errors) {
    throw new Error(`Failed to append media: ${JSON.stringify(result.errors)}`);
  }

  const userErrors = result.data.productVariantAppendMedia.userErrors;
  if (userErrors && userErrors.length) {
    throw new Error(`Image linking errors: ${JSON.stringify(userErrors)}`);
  }

  console.log(`✅ Successfully linked images to variants`);
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
  handleImageUpdate,
  getProductById,
  createProduct,
  updateProduct,
  mutateProductsComprehensive,
  handleVariantImages,
  getProductImages,
  uploadProductImages,
  linkImagesToVariants
}; 