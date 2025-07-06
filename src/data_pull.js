// src/data_pull.js

const BATCH_SIZE = 100;
const PAGE_SIZE = 100; // Conservative page size for reliable pagination (API supports up to 1000)

// Helper function to get auth data from KV store
async function getAuthData(kvStore, domain) {
  try {
    const authString = await kvStore.get(domain);
    if (!authString) {
      throw new Error(`No authentication data found for domain: ${domain}`);
    }
    return JSON.parse(authString);
  } catch (error) {
    console.error('Error getting auth data:', error);
    throw new Error(`Failed to get authentication data: ${error.message}`);
  }
}

// Helper: Generate HMAC-SHA256 signature for Unleashed API authentication
async function generateUnleashedSignature(queryString, apiKey) {
  const encoder = new TextEncoder();
  const keyBuffer = encoder.encode(apiKey);
  const dataBuffer = encoder.encode(queryString);
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, dataBuffer);
  const base64Signature = btoa(String.fromCharCode(...new Uint8Array(signature)));
  return base64Signature;
}

// Helper: Create headers for Unleashed API requests
async function createUnleashedHeaders(endpoint, apiKey, apiId) {
  const url = new URL(endpoint);
  const queryString = url.search ? url.search.substring(1) : '';
  const signature = await generateUnleashedSignature(queryString, apiKey);
  return {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'api-auth-id': apiId,
    'api-auth-signature': signature,
    'Client-Type': 'kilr/unleashedshopify'
  };
}

// Helper functions for processing data
function processCustomer(customer) {
  if (!customer || !customer.CustomerCode) {
    return null;
  }
  return {
    customerCode: customer.CustomerCode,
    customerName: customer.CustomerName,
    guid: customer.Guid,
    // Add other fields as needed
  };
}

function processStockOnHand(stockItem) {
  if (!stockItem) {
    return null;
  }
  return {
    productCode: stockItem.ProductCode,
    availableQty: stockItem.AvailableQty,
    warehouseCode: stockItem.WarehouseCode,
    // Add other fields as needed
  };
}

// Fetch stock on hand for a product
async function fetchStockOnHand(productCode, authData) {
  try {
    console.log(`📦 Fetching stock on hand for product ${productCode}`);
    
    const stockUrl = `https://api.unleashedsoftware.com/StockOnHand?productCode=${productCode}`;
    const response = await fetch(stockUrl, {
      method: 'GET',
      headers: await createUnleashedHeaders(stockUrl, authData.apiKey, authData.apiId)
    });

    if (!response.ok) {
      console.error(`❌ Error fetching stock for product ${productCode}: ${response.status} ${response.statusText}`);
      return [];
    }

    const data = await response.json();
    const items = data.Items || [];
    
    console.log(`📊 Stock levels for product ${productCode}:`);
    if (items.length === 0) {
      console.log(`  ⚠️ No stock data found`);
    } else {
      items.forEach(item => {
        console.log(`  - Warehouse: ${item.WarehouseCode || item.Warehouse?.WarehouseCode || 'Unknown'}`);
        console.log(`    Available: ${item.QuantityAvailable || 0}`);
        console.log(`    On Hand: ${item.QtyOnHand || 0}`);
        console.log(`    Allocated: ${item.QtyAllocated || 0}`);
        console.log(`    In Transit: ${item.QtyInTransit || 0}`);
      });
    }

    return items;
  } catch (error) {
    console.error(`❌ Error fetching stock for product ${productCode}:`, error);
    return [];
  }
}

// Fetch ALL stock on hand records in bulk (paginated)
async function fetchAllStockOnHand(authData) {
  const allStock = [];
  let currentStockPage = 1;
  
  do {
    const stockUrl = `https://api.unleashedsoftware.com/StockOnHand/${currentStockPage}?pageSize=${PAGE_SIZE}`;
    console.log(`📄 Fetching stock page ${currentStockPage}...`);
    
    const stockResponse = await fetch(stockUrl, {
      method: 'GET',
      headers: await createUnleashedHeaders(stockUrl, authData.apiKey, authData.apiId)
    });

    if (!stockResponse.ok) {
      throw new Error(`Failed to fetch stock page ${currentStockPage}: ${stockResponse.status} ${stockResponse.statusText}`);
    }
    
    const stockData = await stockResponse.json();
    const stock = stockData.Items || [];
    
    // Log pagination info
    console.log(`📊 Stock page ${currentStockPage} - Got ${stock.length} stock items`);
    
    // Break if no stock returned
    if (stock.length === 0) {
      console.log(`✅ No more stock found on page ${currentStockPage} - pagination complete`);
      break;
    }
    
    // Process stock
    for (const stockItem of stock) {
      const processedStock = processStockOnHand(stockItem);
      if (processedStock) {
        allStock.push(processedStock);
      }
    }
    
    currentStockPage++;
    
    // Safety break to prevent infinite loops
    if (currentStockPage > 50) {
      console.log(`🛑 Safety break at page ${currentStockPage} to prevent infinite loop`);
      break;
    }
    
  } while (true); // Continue until we get 0 results
  
  console.log(`✅ Successfully fetched ${allStock.length} stock items across ${currentStockPage - 1} pages`);
  return allStock;
}

// Note: Product attachments endpoint is not available in the Unleashed API
// The /Products/{productCode}/Attachments endpoint returns 404 errors
// This functionality is disabled until a valid endpoint is found

// Fetch Unleashed data
async function fetchUnleashedData(authData) {
  const results = {};
  
  // Products - Fetch ALL products with AttributeSet data using proper endpoint
  console.log(`\n🔍 FETCHING ALL PRODUCTS WITH ATTRIBUTESET DATA...`);
  
  const allProducts = [];
  let currentPage = 1;
  const pageSize = PAGE_SIZE;
  const seenProductCodes = new Set(); // Track seen product codes to detect duplicates
  
  do {
    const productsUrl = `https://api.unleashedsoftware.com/Products/${currentPage}?pageSize=${pageSize}&includeAttributeSet=true&includeAttributes=true`;
    console.log(`📄 Fetching page ${currentPage} - URL: ${productsUrl}`);
    
    const productsResponse = await fetch(productsUrl, {
      method: 'GET',
      headers: await createUnleashedHeaders(productsUrl, authData.apiKey, authData.apiId)
    });
    
    if (!productsResponse.ok) {
      throw new Error(`Failed to fetch products page ${currentPage}: ${productsResponse.status} ${productsResponse.statusText}`);
    }
    
    const productsData = await productsResponse.json();
    const products = productsData.Items || [];
    
    // Log pagination info and first product to detect duplicates
    console.log(`📊 Page ${currentPage} - Got ${products.length} products - First product: ${products[0]?.ProductCode || 'NONE'}`);
    
    // Break if no products returned
    if (products.length === 0) {
      console.log(`✅ No more products found on page ${currentPage} - pagination complete`);
      break;
    }
    
    // Track duplicates
    let duplicateCount = 0;
    for (const product of products) {
      if (seenProductCodes.has(product.ProductCode)) {
        duplicateCount++;
      } else {
        seenProductCodes.add(product.ProductCode);
        // Attachments placeholder (stock fetched in bulk later)
        product.Attachments = [];
        allProducts.push(product);
      }
    }
    
    if (duplicateCount > 0) {
      console.log(`⚠️ Found ${duplicateCount} duplicate products on page ${currentPage}`);
    }
    
    // Debug first product's data structure on first page
    if (currentPage === 1 && products.length > 0) {
      console.log(`📊 Sample product: ${products[0].ProductCode}, AttributeSet: ${!!products[0].AttributeSet}`);
    }
    
    currentPage++;
    
    // Safety break to prevent infinite loops
    if (currentPage > 50) {
      console.log(`🛑 Safety break at page ${currentPage} to prevent infinite loop`);
      break;
    }
    
    // Add small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 100));
  
  } while (true); // Continue until we get 0 results
  
  console.log(`✅ Retrieved ${allProducts.length} total products, ${seenProductCodes.size} unique products`);

  // Fetch all stock on hand in bulk and attach to products
  console.log(`\n📊 Fetching bulk Stock On Hand data for all products...`);
  try {
    const bulkStock = await fetchAllStockOnHand(authData);
    const stockMap = {};
    bulkStock.forEach(item => {
      const prodCode = item.ProductCode || item.Product?.ProductCode;
      if (!prodCode) return;
      if (!stockMap[prodCode]) stockMap[prodCode] = [];
      stockMap[prodCode].push(item);
    });

    allProducts.forEach(product => {
      product.StockOnHand = stockMap[product.ProductCode] || [];
    });
  } catch (error) {
    console.error('⚠️ Failed bulk StockOnHand fetch:', error);
    // Fallback: products keep empty StockOnHand
  }

  results.products = allProducts;

  // Customers (company entities) - Fetch ALL customers with proper pagination
  console.log(`\n👥 FETCHING ALL CUSTOMERS...`);
  const allCustomers = [];
  let currentCustomerPage = 1;
  
  do {
    const customersUrl = `https://api.unleashedsoftware.com/Customers/${currentCustomerPage}?pageSize=${PAGE_SIZE}&includeObsolete=false`;
    console.log(`📄 Fetching customers page ${currentCustomerPage}...`);
    
  const customersResponse = await fetch(customersUrl, {
    method: 'GET',
    headers: await createUnleashedHeaders(customersUrl, authData.apiKey, authData.apiId)
  });
    
    if (!customersResponse.ok) {
      throw new Error(`Failed to fetch customers page ${currentCustomerPage}: ${customersResponse.status} ${customersResponse.statusText}`);
    }
    
  const customersData = await customersResponse.json();
    const customers = customersData.Items || [];
    
    // Log pagination info
    console.log(`📊 Customers page ${currentCustomerPage} - Got ${customers.length} customers`);
    
    // Break if no customers returned
    if (customers.length === 0) {
      console.log(`✅ No more customers found on page ${currentCustomerPage} - pagination complete`);
      break;
    }
    
    // Process customers
    for (const customer of customers) {
      const processedCustomer = processCustomer(customer);
      if (processedCustomer) {
        allCustomers.push(processedCustomer);
      }
    }
    
    currentCustomerPage++;
    
    // Safety break to prevent infinite loops
    if (currentCustomerPage > 50) {
      console.log(`🛑 Safety break at customer page ${currentCustomerPage} to prevent infinite loop`);
      break;
    }
    
  } while (true); // Continue until we get 0 results
  
  console.log(`✅ Successfully fetched ${allCustomers.length} customers across ${currentCustomerPage - 1} pages`);
  results.customers = allCustomers;

  // Skip contact fetching to avoid subrequest limit in main worker
  // Contacts can be synced separately if needed
  console.log(`⏭️  Skipping contact fetching to avoid subrequest limit`);
  results.contacts = [];

  // Warehouses
  console.log(`\n🏭 FETCHING WAREHOUSES...`);
  const warehousesUrl = 'https://api.unleashedsoftware.com/Warehouses';
  const warehousesResponse = await fetch(warehousesUrl, {
    method: 'GET',
    headers: await createUnleashedHeaders(warehousesUrl, authData.apiKey, authData.apiId)
  });
  const warehousesData = await warehousesResponse.json();
  results.warehouses = warehousesData.Items || [];
  console.log(`✅ Retrieved ${results.warehouses.length} warehouses`);

  console.log(`\n📦 FETCHING ALL STOCK ON HAND...`);
  const allStock = await fetchAllStockOnHand(authData);
  results.stockOnHand = allStock;

  return results;
}

// ---------------------------------------------------------------------------
// Helper: perform Shopify GraphQL request with exponential-backoff retry when
// the platform responds with THROTTLED errors. This prevents data fetching
// failures during the initial sync phase.
// ---------------------------------------------------------------------------
async function shopifyGraphQLWithRetry(url, headers, payload, {
  maxRetries = 10,
  baseDelayMs = 1000,
  maxDelayMs = 60000
} = {}) {
  let attempt = 0;

  while (true) {
    const resp = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    // Quickly retry (with back-off) on transient HTTP 5xx errors
    if (!resp.ok && resp.status >= 500) {
      if (attempt >= maxRetries) {
        throw new Error(`HTTP ${resp.status} after ${maxRetries} retries`);
      }
      const wait = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs);
      console.warn(`⚠️ HTTP ${resp.status} – retrying in ${wait}ms (attempt ${attempt + 1}/${maxRetries})`);
      await new Promise(r => setTimeout(r, wait));
      attempt++;
      continue;
    }

    const data = await resp.json();

    // ---- Normal success path ----
    const throttleInfo =
      data.extensions?.cost?.throttleStatus ||
      (Array.isArray(data.errors) && data.errors[0]?.extensions?.throttleStatus);

    const throttledError = Array.isArray(data.errors) && data.errors.some(e => e.extensions?.code === 'THROTTLED');

    if (!throttledError) {
      // Not throttled – but we can still pace ourselves if close to the cap
      if (throttleInfo) {
        const { maximumAvailable, currentlyAvailable, restoreRate } = throttleInfo;
        // If we have less than 50 cost units left, wait for a restore window
        if (currentlyAvailable < 50 && restoreRate > 0) {
          const deficit = 50 - currentlyAvailable;
          const waitMs = Math.min(((deficit / restoreRate) + 1) * 1000, maxDelayMs);
          console.log(`⏳ Near throttle limit – waiting ${waitMs}ms to regain budget`);
          await new Promise(r => setTimeout(r, waitMs));
        }
      }
      return { response: resp, data };
    }

    // ---- Throttled path ----
    if (attempt >= maxRetries) {
      throw new Error(`Shopify throttled after ${maxRetries} retries`);
    }

    let waitMs = baseDelayMs * Math.pow(2, attempt); // fallback exponential
    if (throttleInfo) {
      const { maximumAvailable, currentlyAvailable, restoreRate } = throttleInfo;
      if (restoreRate > 0) {
        const needed = maximumAvailable - currentlyAvailable; // to fully refill
        waitMs = Math.min(((needed / restoreRate) + 1) * 1000, maxDelayMs);
      }
    }

    console.warn(`⏳ Shopify throttled – waiting ${waitMs}ms then retrying (attempt ${attempt + 1}/${maxRetries})`);
    await new Promise(r => setTimeout(r, waitMs));
    attempt++;
  }
}

// Bulk query operations for efficient data fetching
async function startShopifyBulkQuery(baseUrl, headers, query, operationType = 'products') {
  const bulkQuery = `
    mutation bulkOperationRunQuery($query: String!) {
      bulkOperationRunQuery(query: $query) {
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

  console.log(`🚀 Starting bulk ${operationType} query...`);
  const response = await fetch(`${baseUrl}/graphql.json`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      query: bulkQuery,
      variables: { query }
    })
  });

  const data = await response.json();
  if (data.errors) {
    throw new Error(`Bulk query start failed: ${JSON.stringify(data.errors)}`);
  }

  if (data.data.bulkOperationRunQuery.userErrors.length > 0) {
    throw new Error(`Bulk query errors: ${JSON.stringify(data.data.bulkOperationRunQuery.userErrors)}`);
  }

  const bulkOperation = data.data.bulkOperationRunQuery.bulkOperation;
  console.log(`✅ Bulk ${operationType} query started: ${bulkOperation.id}`);
  
  return bulkOperation;
}

// Monitor bulk query status
async function monitorShopifyBulkQuery(baseUrl, headers, operationId, operationType = 'data', maxWaitTime = 300000) {
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

  console.log(`⏳ Monitoring bulk ${operationType} query ${operationId}...`);

  while (Date.now() - startTime < maxWaitTime) {
    await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds between checks

    const response = await fetch(`${baseUrl}/graphql.json`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query: statusQuery })
    });

    const data = await response.json();
    if (data.errors) {
      console.error(`Error checking bulk ${operationType} query status:`, data.errors);
      continue;
    }

    const operation = data.data.currentBulkOperation;
    if (!operation || operation.id !== operationId) {
      console.log(`No current bulk ${operationType} operation or different operation running`);
      continue;
    }

    if (operation.status !== lastStatus) {
      console.log(`📊 Bulk ${operationType} query status: ${operation.status} (${operation.objectCount || 0} objects processed)`);
      lastStatus = operation.status;
    }

    if (operation.status === 'COMPLETED') {
      console.log(`✅ Bulk ${operationType} query completed successfully`);
      return {
        success: true,
        operation,
        resultUrl: operation.url
      };
    }

    if (operation.status === 'FAILED' || operation.status === 'CANCELED') {
      console.error(`❌ Bulk ${operationType} query ${operation.status.toLowerCase()}: ${operation.errorCode || 'Unknown error'}`);
      return {
        success: false,
        operation,
        error: operation.errorCode || `Operation ${operation.status.toLowerCase()}`
      };
    }
  }

  console.error(`⏰ Bulk ${operationType} query timed out`);
  return {
    success: false,
    error: 'Operation timed out',
    operation: null
  };
}

// Download and parse bulk query results
async function parseShopifyBulkQueryResults(resultUrl, operationType = 'data') {
  if (!resultUrl) {
    console.log(`No ${operationType} result URL provided - bulk query may have had no results`);
    return [];
  }

  try {
    console.log(`📥 Downloading bulk ${operationType} query results...`);
    const response = await fetch(resultUrl);
    
    if (!response.ok) {
      throw new Error(`Failed to download ${operationType} results: ${response.status} ${response.statusText}`);
    }

    const jsonlContent = await response.text();
    const lines = jsonlContent.trim().split('\n').filter(line => line.trim());
    
    console.log(`📊 Processing ${lines.length} ${operationType} result lines...`);
    
    const results = lines.map(line => {
      try {
        return JSON.parse(line);
      } catch (error) {
        console.error(`Error parsing ${operationType} result line:`, line, error);
        return null;
      }
    }).filter(Boolean);

    return results;
  } catch (error) {
    console.error(`Error parsing bulk ${operationType} query results:`, error);
    return [];
  }
}

// Bulk fetch Shopify products
async function fetchShopifyProductsBulk(baseUrl, headers) {
  console.log('🚀 === STARTING BULK PRODUCTS QUERY ===');
  
  // Bulk query for all products with comprehensive data
  const productsQuery = `
    {
      products {
        edges {
          node {
            id
            handle
            title
            tracksInventory
            totalInventory
            featuredImage {
              id
              url
              altText
              width
              height
            }
            media(first: 50) {
              edges {
                node {
                  ... on MediaImage {
                    id
                    image { url originalSrc }
                  }
                }
              }
            }
            variants(first: 20) {
              edges {
                node {
                  inventoryItem {
                    tracked
                    inventoryLevels(first: 5) {
                      nodes {
                        quantities(names: "available") {
                          quantity
                        }
                        location {
                          id
                          name
                        }
                      }
                    }
                    sku
                  }
                  displayName
                  id
                  image {
                    id
                    url
                    altText
                    width
                    height
                  }
                  price
                  metafields(first: 3, keys: ["custom.price_tier_1", "custom.price_tier_2", "custom.price_tier_3"]) {
                    edges {
                      node {
                        key
                        value
                      }
                    }
                  }
                  title
                  sku
                }
              }
            }
            description
            productType
            vendor
            status
            options {
              name
              values
            }
          }
        }
      }
    }
  `;

  try {
    // Start bulk operation
    const bulkOperation = await startShopifyBulkQuery(baseUrl, headers, productsQuery, 'products');

    // Monitor bulk operation
    const operationResult = await monitorShopifyBulkQuery(baseUrl, headers, bulkOperation.id, 'products', 600000); // 10 minutes max

    if (!operationResult.success) {
      throw new Error(`Bulk products query failed: ${operationResult.error}`);
    }

    // Parse results
    const bulkResults = await parseShopifyBulkQueryResults(operationResult.resultUrl, 'products');
    
    // Transform bulk results to match the expected format
    const products = bulkResults.map(result => {
      const product = result;
      
      // Transform variants from GraphQL edges/node structure to flat array
      if (product.variants && product.variants.edges) {
        product.variants = product.variants.edges.map(variantEdge => {
          const variant = variantEdge.node;
          
          // Transform metafields from edges/node structure to flat array
          if (variant.metafields && variant.metafields.edges) {
            variant.metafields = variant.metafields.edges.map(mfEdge => mfEdge.node);
          }
          
          return variant;
        });
      }
      
      // Flatten media into an array of {id, url}
      if (product.media && product.media.edges) {
        product.media = product.media.edges.map(mEdge => ({
          id: mEdge.node.id,
          url: mEdge.node.image.url || mEdge.node.image.originalSrc
        }));
      }

      // DEBUG: list media filenames so we can compare later
      if (product.media && product.media.length) {
        console.log(`\n🖼️ EXISTING MEDIA for ${product.handle} (${product.id}):`);
        product.media.forEach(m => {
          const filename = m.url.split('/').pop().split('?')[0];
          console.log(`   - ${filename} (${m.id})`);
        });
      }
      
      return product;
    });

    console.log(`✅ Bulk products query completed: ${products.length} products fetched`);
    return products;

  } catch (error) {
    console.error('❌ Bulk products query failed, falling back to paginated approach:', error);
    return await fetchShopifyProducts(baseUrl, headers);
  }
}

// Bulk fetch Shopify customers
async function fetchShopifyCustomersBulk(baseUrl, headers) {
  console.log('🚀 === STARTING BULK CUSTOMERS QUERY ===');
  
  // Bulk query for all customers with metafields
  const customersQuery = `
    {
      customers {
        edges {
          node {
            id
            firstName
            lastName
            email
            phone
            metafields(
              keys: ["unleashed.contact_guid", "unleashed.customer_code", "unleashed.customer_name", "unleashed.sell_price_tier"]
              first: 10
            ) {
              edges {
                node {
                  id
                  key
                  value
                  namespace
                }
              }
            }
          }
        }
      }
    }
  `;

  try {
    // Start bulk operation
    const bulkOperation = await startShopifyBulkQuery(baseUrl, headers, customersQuery, 'customers');

    // Monitor bulk operation
    const operationResult = await monitorShopifyBulkQuery(baseUrl, headers, bulkOperation.id, 'customers', 600000); // 10 minutes max

    if (!operationResult.success) {
      throw new Error(`Bulk customers query failed: ${operationResult.error}`);
    }

    // Parse results
    const bulkResults = await parseShopifyBulkQueryResults(operationResult.resultUrl, 'customers');
    
    // Transform bulk results to match the expected format
    const customers = bulkResults.map(result => {
      const customer = result;
      const metafields = {};
      
      // Process metafields into a more accessible format
      if (customer.metafields && customer.metafields.edges) {
        customer.metafields.edges.forEach(metafieldEdge => {
          const metafield = metafieldEdge.node;
          const key = `${metafield.namespace}.${metafield.key}`;
          metafields[key] = metafield.value;
        });
      }

      return {
        ...customer,
        metafields
      };
    });

    console.log(`✅ Bulk customers query completed: ${customers.length} customers fetched`);
    return customers;

  } catch (error) {
    console.error('❌ Bulk customers query failed, falling back to paginated approach:', error);
    return await fetchShopifyCustomers(baseUrl, headers);
  }
}

// Original paginated fetch functions (kept as fallbacks)
async function fetchShopifyProducts(baseUrl, headers) {
  const allProducts = [];
  let hasNextPage = true;
  let cursor = null;
  const query = `
    query GetProducts($first: Int!, $after: String) {
      products(first: $first, after: $after) {
        edges {
          node {
            id
            handle
            title
            tracksInventory
            totalInventory
            featuredImage {
              id
              url
              altText
              width
              height
            }
            media(first: 50) {
              edges {
                node {
                  ... on MediaImage {
                    id
                    image { url originalSrc }
                  }
                }
              }
            }
            variants(first: 20) {
              edges {
                node {
                  inventoryItem {
                    tracked
                    inventoryLevels(first: 5) {
                      nodes {
                        quantities(names: "available") {
                          quantity
                        }
                        location {
                          id
                          name
                        }
                      }
                    }
                    sku
                  }
                  displayName
                  id
                  image {
                    id
                    url
                    altText
                    width
                    height
                  }
                  price
                  metafields(first: 3, keys: ["custom.price_tier_1", "custom.price_tier_2", "custom.price_tier_3"]) {
                    edges {
                      node {
                        key
                        value
                      }
                    }
                  }
                  title
                  sku
                }
              }
            }
            description
            productType
            vendor
            status
            options {
              name
              values
            }
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  `;
  
  while (hasNextPage) {
    const variables = { first: 5, after: cursor }; // Ultra-conservative batch size for heavy product queries
    
    // Use throttling helper to handle rate limits during data fetching
    const { data } = await shopifyGraphQLWithRetry(
      `${baseUrl}/graphql.json`,
      headers,
      { query, variables },
      { maxRetries: 15, baseDelayMs: 2000, maxDelayMs: 120000 } // More aggressive throttling
    );
    
    if (data.errors) throw new Error(`Shopify GraphQL errors: ${JSON.stringify(data.errors)}`);
    
    // Transform products and flatten variant data structure
    const products = data.data.products.edges.map(edge => {
      const product = edge.node;
      
      // Transform variants from GraphQL edges/node structure to flat array
      product.variants = product.variants.edges.map(variantEdge => {
        const variant = variantEdge.node;
        
        // Transform metafields from edges/node structure to flat array
        if (variant.metafields && variant.metafields.edges) {
          variant.metafields = variant.metafields.edges.map(mfEdge => mfEdge.node);
        }
        
        return variant;
      });
      
      // Flatten media into an array of {id, url}
      product.media = (product.media?.edges || []).map(mEdge => ({
        id: mEdge.node.id,
        url: mEdge.node.image.url || mEdge.node.image.originalSrc
      }));

      // DEBUG: list media filenames so we can compare later
      if (product.media.length) {
        console.log(`\n🖼️ EXISTING MEDIA for ${product.handle} (${product.id}):`);
        product.media.forEach(m => {
          const filename = m.url.split('/').pop().split('?')[0];
          console.log(`   - ${filename} (${m.id})`);
        });
      }
      
      return product;
    });
    
    allProducts.push(...products);
    hasNextPage = data.data.products.pageInfo.hasNextPage;
    cursor = data.data.products.pageInfo.endCursor;
    
    // Longer delay between requests to be respectful of rate limits
    if (hasNextPage) {
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  return allProducts;
}

async function fetchShopifyCustomers(baseUrl, headers) {
  const allCustomers = [];
  let hasNextPage = true;
  let cursor = null;
  const query = `
    query GetCustomers($first: Int!, $after: String) {
      customers(first: $first, after: $after) {
        edges {
          node {
            id
            firstName
            lastName
            email
            phone
            metafields(
              keys: ["unleashed.contact_guid", "unleashed.customer_code", "unleashed.customer_name", "unleashed.sell_price_tier"]
              first: 10
            ) {
              edges {
                node {
                  id
                  key
                  value
                  namespace
                }
              }
            }
          }
          cursor
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  `;
  while (hasNextPage) {
    const variables = { first: 10, after: cursor }; // Ultra-conservative batch size for customers
    
    // Use throttling helper to handle rate limits during data fetching
    const { data } = await shopifyGraphQLWithRetry(
      `${baseUrl}/graphql.json`,
      headers,
      { query, variables },
      { maxRetries: 15, baseDelayMs: 2000, maxDelayMs: 120000 } // More aggressive throttling
    );
    
    if (data.errors) throw new Error(`Shopify Customers GraphQL errors: ${JSON.stringify(data.errors)}`);
    
    // Transform customers to include metafields in accessible format (same as locations)
    const customers = data.data.customers.edges.map(edge => {
      const customer = edge.node;
      const metafields = {};
      
      // Process metafields into a more accessible format
      customer.metafields.edges.forEach(metafieldEdge => {
        const metafield = metafieldEdge.node;
        const key = `${metafield.namespace}.${metafield.key}`;
        metafields[key] = metafield.value;
      });

      return {
        ...customer,
        metafields
      };
    });
    
    allCustomers.push(...customers);
    hasNextPage = data.data.customers.pageInfo.hasNextPage;
    cursor = data.data.customers.pageInfo.endCursor;
    
    // Longer delay between requests to be respectful of rate limits
    if (hasNextPage) {
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  return allCustomers;
}

async function fetchShopifyLocations(baseUrl, headers) {
  // Use GraphQL to get locations with metafields
  const query = `
    query GetLocations {
      locations(first: 50) {
        edges {
          node {
            id
            name
            address {
              address1
              address2
              city
              provinceCode
              countryCode
              zip
              phone
            }
            metafields(first: 10, namespace: "custom") {
              edges {
                node {
                  id
                  key
                  value
                  namespace
                }
              }
            }
          }
        }
      }
    }
  `;

  // Use throttling helper to handle rate limits during data fetching
  const { data } = await shopifyGraphQLWithRetry(
    `${baseUrl}/graphql.json`,
    headers,
    { query },
    { maxRetries: 15, baseDelayMs: 2000, maxDelayMs: 120000 } // More aggressive throttling
  );
  
  if (data.errors) {
    throw new Error(`Shopify Locations GraphQL errors: ${JSON.stringify(data.errors)}`);
  }

  // Transform the GraphQL response to include metafields in a more accessible format
  return data.data.locations.edges.map(edge => {
    const location = edge.node;
    const metafields = {};
    
    // Process metafields into a more accessible format
    location.metafields.edges.forEach(metafieldEdge => {
      const metafield = metafieldEdge.node;
      const key = `${metafield.namespace}.${metafield.key}`;
      metafields[key] = metafield.value;
    });

    return {
      ...location,
      metafields
    };
  });
}

// Enhanced fetchShopifyData function with bulk operations
async function fetchShopifyDataBulk(auth, useBulk = true) {
  const { accessToken, shopDomain } = auth;
  const baseUrl = `https://${shopDomain}/admin/api/2025-04`;
  const headers = {
    'Content-Type': 'application/json',
    'X-Shopify-Access-Token': accessToken
  };

  console.log(`📊 Shopify data fetching strategy: ${useBulk ? 'Bulk queries' : 'Paginated queries'}`);

  if (useBulk) {
    // Use bulk operations for maximum efficiency
    const [products, customers, locations] = await Promise.all([
      fetchShopifyProductsBulk(baseUrl, headers),
      fetchShopifyCustomersBulk(baseUrl, headers),
      fetchShopifyLocations(baseUrl, headers) // Locations are fine with single query
    ]);
    return { products, customers, locations };
  } else {
    // Use traditional paginated approach
  const [products, customers, locations] = await Promise.all([
    fetchShopifyProducts(baseUrl, headers),
    fetchShopifyCustomers(baseUrl, headers),
    fetchShopifyLocations(baseUrl, headers)
  ]);
  return { products, customers, locations };
  }
}

// Main exported function
async function pullAllData(domain, env) {
  if (!env.AUTH_STORE) {
    throw new Error('KV binding AUTH_STORE not found');
  }

  // Get authentication data from KV store
  const authData = await getAuthData(env.AUTH_STORE, domain);
  
  if (!authData || !authData.unleashed || !authData.shopify) {
    throw new Error('Invalid authentication data structure');
  }

  // Fetch data from both systems using paginated queries for faster response
  const [unleashedData, shopifyData] = await Promise.all([
    fetchUnleashedData(authData.unleashed),
    fetchShopifyDataBulk(authData.shopify, false) // Use paginated queries, not bulk
  ]);

  return {
    unleashed: unleashedData,
    shopify: shopifyData
  };
}

// Backwards compatible alias for existing code
async function fetchShopifyData(auth) {
  return await fetchShopifyDataBulk(auth, true);
}

export { pullAllData, fetchShopifyData, fetchShopifyDataBulk }; 