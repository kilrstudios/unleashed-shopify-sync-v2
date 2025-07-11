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

// Fetch ALL stock on hand records in bulk (paginated)
async function fetchAllStockOnHand(authData) {
  const allStock = [];
  let currentPage = 1;
  let hasMorePages = true;

  while (hasMorePages) {
    const stockUrl = `https://api.unleashedsoftware.com/StockOnHand?pageSize=200&pageNumber=${currentPage}`;
    console.log(`📦 Fetching StockOnHand page ${currentPage}...`);

    const response = await fetch(stockUrl, {
      method: 'GET',
      headers: await createUnleashedHeaders(stockUrl, authData.apiKey, authData.apiId)
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch StockOnHand page ${currentPage}: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const items = data.Items || [];
    allStock.push(...items);

    if (data.Pagination) {
      const totalPages = data.Pagination.NumberOfPages || 1;
      hasMorePages = currentPage < totalPages;
    } else {
      hasMorePages = false;
    }

    currentPage++;

    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  console.log(`✅ Retrieved ${allStock.length} StockOnHand rows in bulk`);

  // DEBUG logging disabled to keep tails under 256 KB
  /*
  allStock.forEach(item => {
    const prodCode = item.ProductCode || item.Product?.ProductCode || 'UNKNOWN_CODE';
    const whCode = item.WarehouseCode || item.Warehouse?.WarehouseCode || 'UNKNOWN_WH';
    const avail = item.QuantityAvailable ?? item.QtyAvailable ?? item.AvailableQty ?? 'n/a';
    const onHand = item.QuantityOnHand ?? item.QtyOnHand ?? 'n/a';
    console.log(`STOCK-ROW ${prodCode} | WH: ${whCode} | Avail: ${avail} | OnHand: ${onHand}`);

    if (whCode === 'UNKNOWN_WH') {
      console.log('RAW STOCK JSON', JSON.stringify(item));
    }
  });
  */

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
  let hasMorePages = true;
  
  while (hasMorePages) {
    const productsUrl = `https://api.unleashedsoftware.com/Products?pageSize=200&pageNumber=${currentPage}&includeAttributeSet=true&includeAttributes=true`;
    console.log(`📄 Fetching page ${currentPage}...`);
    
    const productsResponse = await fetch(productsUrl, {
      method: 'GET',
      headers: await createUnleashedHeaders(productsUrl, authData.apiKey, authData.apiId)
    });
    
    if (!productsResponse.ok) {
      throw new Error(`Failed to fetch products page ${currentPage}: ${productsResponse.status} ${productsResponse.statusText}`);
    }
    
    const productsData = await productsResponse.json();
    const products = productsData.Items || [];
    
    if (products.length === 0) {
      hasMorePages = false;
      break;
    }
    
    // Debug first product's data structure on first page
    if (currentPage === 1 && products.length > 0) {
      console.log(`\n📊 PRODUCT DATA STRUCTURE DEBUG - Sample from bulk endpoint:`)
      console.log(`   ProductCode: ${products[0].ProductCode}`);
      console.log(`   ProductDescription: ${products[0].ProductDescription}`);
      console.log(`   AttributeSet exists: ${!!products[0].AttributeSet}`);
      console.log(`   Attributes exists: ${!!products[0].Attributes}`);
      
      if (products[0].AttributeSet) {
        console.log(`   AttributeSet:`, typeof products[0].AttributeSet === 'string' ? products[0].AttributeSet : JSON.stringify(products[0].AttributeSet, null, 2));
      }
      
      if (products[0].Attributes) {
        console.log(`   Attributes:`, JSON.stringify(products[0].Attributes, null, 2));
      }
      
      if (!products[0].AttributeSet && !products[0].Attributes) {
        console.log(`   Available fields:`, Object.keys(products[0]));
      }
    }
    
    // Attachments placeholder (stock fetched in bulk later)
    products.forEach(product => {
      product.Attachments = [];
    });
    
    allProducts.push(...products);
    
    // Check if we have more pages
    if (productsData.Pagination) {
      const totalPages = productsData.Pagination.NumberOfPages || 1;
      hasMorePages = currentPage < totalPages;
      console.log(`📊 Page ${currentPage}/${totalPages} - Found ${products.length} products (Total so far: ${allProducts.length})`);
    } else {
      // If no pagination info, assume we got all products
      hasMorePages = false;
    }
    
    currentPage++;
    
    // Add small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  console.log(`✅ Retrieved ${allProducts.length} total products with AttributeSet data`);

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

  // Customers (company entities)
  const customersUrl = 'https://api.unleashedsoftware.com/Customers?pageSize=200&pageNumber=1';
  const customersResponse = await fetch(customersUrl, {
    method: 'GET',
    headers: await createUnleashedHeaders(customersUrl, authData.apiKey, authData.apiId)
  });
  const customersData = await customersResponse.json();
  results.customers = customersData.Items || [];

  // Contacts (individuals who should become Shopify customers)
  // Fetch contacts for each customer
  results.contacts = [];
  for (const customer of results.customers) {
    try {
      const contactsUrl = `https://api.unleashedsoftware.com/Customers/${customer.Guid}/Contacts`;
      const contactsResponse = await fetch(contactsUrl, {
        method: 'GET',
        headers: await createUnleashedHeaders(contactsUrl, authData.apiKey, authData.apiId)
      });
      const contactsData = await contactsResponse.json();
      const customerContacts = contactsData.Items || [];
      
      // Add customer reference to each contact for easy lookup
      customerContacts.forEach(contact => {
        contact.CustomerGuid = customer.Guid;
        contact.CustomerCode = customer.CustomerCode;
        contact.CustomerName = customer.CustomerName;
      });
      
      results.contacts.push(...customerContacts);
    } catch (error) {
      console.warn(`Failed to fetch contacts for customer ${customer.CustomerCode}:`, error.message);
    }
  }

  // Warehouses
  const warehousesUrl = 'https://api.unleashedsoftware.com/Warehouses';
  const warehousesResponse = await fetch(warehousesUrl, {
    method: 'GET',
    headers: await createUnleashedHeaders(warehousesUrl, authData.apiKey, authData.apiId)
  });
  const warehousesData = await warehousesResponse.json();
  results.warehouses = warehousesData.Items || [];

  return results;
}

// Fetch Shopify data
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
    const variables = { first: 25, after: cursor };
    const response = await fetch(`${baseUrl}/graphql.json`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query, variables })
    });
    const data = await response.json();
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
    const variables = { first: 25, after: cursor };
    const response = await fetch(`${baseUrl}/graphql.json`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query, variables })
    });
    const data = await response.json();
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

  const response = await fetch(`${baseUrl}/graphql.json`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query })
  });

  const data = await response.json();
  
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

async function fetchShopifyData(auth) {
  const { accessToken, shopDomain } = auth;
  const baseUrl = `https://${shopDomain}/admin/api/2025-04`;
  const headers = {
    'Content-Type': 'application/json',
    'X-Shopify-Access-Token': accessToken
  };
  const [products, customers, locations] = await Promise.all([
    fetchShopifyProducts(baseUrl, headers),
    fetchShopifyCustomers(baseUrl, headers),
    fetchShopifyLocations(baseUrl, headers)
  ]);
  return { products, customers, locations };
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