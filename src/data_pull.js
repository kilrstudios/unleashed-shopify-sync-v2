// src/data_pull.js

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

// Note: Product attachments endpoint is not available in the Unleashed API
// The /Products/{productCode}/Attachments endpoint returns 404 errors
// This functionality is disabled until a valid endpoint is found

// Fetch Unleashed data
async function fetchUnleashedData(authData) {
  const allProducts = [];
  let hasMorePages = true;
  let currentPage = 1;
  const pageSize = 100;

  console.log('\n📊 === UNLEASHED DATA PULL DETAILS ===');

  while (hasMorePages) {
    console.log(`\n📄 Fetching page ${currentPage}...`);
    
    const productsUrl = `https://api.unleashedsoftware.com/Products?pageSize=${pageSize}&pageNumber=${currentPage}`;
    const response = await fetch(productsUrl, {
      method: 'GET',
      headers: await createUnleashedHeaders(productsUrl, authData.apiKey, authData.apiId)
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch products: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const products = data.Items || [];
    
    // Debug first product's data structure on first page
    if (currentPage === 1 && products.length > 0) {
      const sampleProduct = products[0];
      console.log(`\n🔍 UNLEASHED PRODUCT DATA STRUCTURE (First Product):`)
      console.log(JSON.stringify({
        ProductCode: sampleProduct.ProductCode,
        ProductDescription: sampleProduct.ProductDescription,
        DefaultSellPrice: sampleProduct.DefaultSellPrice,
        NeverDiminishing: sampleProduct.NeverDiminishing,
        IsSellable: sampleProduct.IsSellable,
        AttributeSet: sampleProduct.AttributeSet,
        ProductGroup: sampleProduct.ProductGroup,
        ProductBrand: sampleProduct.ProductBrand,
        Obsolete: sampleProduct.Obsolete
      }, null, 2));
    }
    
    // For each product, fetch stock on hand and attachments
    console.log(`\n📦 Fetching additional data for ${products.length} products...`);
    for (const product of products) {
      try {
        // Fetch stock on hand
        console.log(`\n🏢 Stock data for ${product.ProductCode}:`);
        const stockData = await fetchStockOnHand(product.ProductCode, authData);
        product.StockOnHand = stockData;

        // Log detailed stock structure for the first product
        if (currentPage === 1 && products.indexOf(product) === 0 && stockData.length > 0) {
          console.log(`\n📊 STOCK ON HAND DATA STRUCTURE:`);
          console.log(JSON.stringify(stockData[0], null, 2));
        }
        
        // Note: Product attachments endpoint not available in Unleashed API
        // Keeping empty array for compatibility
        product.Attachments = [];
      } catch (error) {
        console.warn(`⚠️ Error fetching additional data for ${product.ProductCode}:`, error.message);
      }
      
      // Add small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    allProducts.push(...products);
    
    // Check if there are more pages
    hasMorePages = products.length === pageSize;
    currentPage++;
  }

  return allProducts;
}

// Helper: Perform GraphQL requests to Shopify
async function graphqlRequest(shopifyAuth, query, variables = {}) {
  if (!shopifyAuth || !shopifyAuth.accessToken || !shopifyAuth.shopDomain) {
    throw new Error('graphqlRequest: Invalid Shopify auth object');
  }

  const baseUrl = `https://${shopifyAuth.shopDomain}/admin/api/2025-04/graphql.json`;
  const headers = {
    'Content-Type': 'application/json',
    'X-Shopify-Access-Token': shopifyAuth.accessToken
  };

  const response = await fetch(baseUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, variables })
  });

  const data = await response.json();

  if (data.errors) {
    throw new Error(`Shopify GraphQL errors: ${JSON.stringify(data.errors)}`);
  }

  return data.data;
}

// Fetch Shopify data
async function fetchShopifyData(authData) {
  console.log('\n📊 === SHOPIFY DATA PULL DETAILS ===');

  // Fetch locations first
  const locationsQuery = `
    query getLocations {
      locations(first: 50) {
        edges {
          node {
            id
            name
            address {
              address1
              address2
              city
              province
              zip
              country
            }
            isActive
          }
        }
      }
    }
  `;

  const locationsData = await graphqlRequest(authData, locationsQuery);
  const locations = locationsData.locations.edges.map(edge => edge.node);

  console.log('\n📍 SHOPIFY LOCATIONS DATA STRUCTURE:');
  console.log(JSON.stringify(locations[0], null, 2));

  // Fetch products with variants and inventory
  const productsQuery = `
    query getProducts {
      products(first: 20) {
        edges {
          node {
            id
            title
            handle
            status
            productType
            vendor
            description
            options {
              id
              name
              position
              values
            }
            variants(first: 20) {
              edges {
                node {
                  id
                  title
                  sku
                  price
                  inventoryItem {
                    id
                    tracked
                    inventoryLevels(first: 20) {
                      edges {
                        node {
                          id
                          location {
                            id
                          }
                          quantities(names: ["available"]) {
                            name
                            quantity
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  `;

  const productsData = await graphqlRequest(authData, productsQuery);
  const products = productsData.products.edges.map(edge => {
    const product = edge.node;
    // Flatten variants connection to array for downstream compatibility
    product.variants = product.variants.edges.map(vEdge => {
      const variantNode = vEdge.node;
      // Flatten inventory levels as array
      if (variantNode.inventoryItem && variantNode.inventoryItem.inventoryLevels) {
        variantNode.inventoryItem.inventoryLevels = variantNode.inventoryItem.inventoryLevels.edges.map(lEdge => lEdge.node);
      }
      return variantNode;
    });
    return product;
  });

  // Log detailed structure of first product
  if (products.length > 0) {
    console.log('\n📦 SHOPIFY PRODUCT DATA STRUCTURE (First Product):');
    console.log(JSON.stringify({
      id: products[0].id,
      title: products[0].title,
      status: products[0].status,
      productType: products[0].productType,
      vendor: products[0].vendor,
      options: products[0].options,
      variants: products[0].variants.edges.map(edge => ({
        id: edge.node.id,
        sku: edge.node.sku,
        price: edge.node.price,
        inventoryItem: edge.node.inventoryItem
      }))
    }, null, 2));
  }

  return {
    locations,
    products
  };
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

  // Fetch data from both systems
  const [unleashedData, shopifyData] = await Promise.all([
    fetchUnleashedData(authData.unleashed),
    fetchShopifyData(authData.shopify)
  ]);

  return {
    unleashed: unleashedData,
    shopify: shopifyData
  };
}

export { pullAllData }; 