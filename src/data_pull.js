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

// Fetch Unleashed data
async function fetchUnleashedData(authData) {
  const results = {};
  
  // Products - Get basic list first, then fetch detailed data with AttributeSet
  console.log(`\n🔍 FETCHING PRODUCTS WITH ATTRIBUTESET DATA...`);
  
  const productsUrl = 'https://api.unleashedsoftware.com/Products?pageSize=200&pageNumber=1';
  const productsResponse = await fetch(productsUrl, {
    method: 'GET',
    headers: await createUnleashedHeaders(productsUrl, authData.apiKey, authData.apiId)
  });
  const productsData = await productsResponse.json();
  const basicProducts = productsData.Items || [];
  
  console.log(`📊 Found ${basicProducts.length} products, now fetching detailed data with AttributeSet...`);
  
  // Now fetch detailed product data for each product to get AttributeSet
  const detailedProducts = [];
  let processed = 0;
  
  for (const product of basicProducts.slice(0, 10)) { // Limit to first 10 for testing
    try {
      const detailUrl = `https://api.unleashedsoftware.com/Products/${product.Guid}`;
      const detailResponse = await fetch(detailUrl, {
        method: 'GET',
        headers: await createUnleashedHeaders(detailUrl, authData.apiKey, authData.apiId)
      });
      
      if (detailResponse.ok) {
        const detailData = await detailResponse.json();
        detailedProducts.push(detailData);
        processed++;
        
        // Debug first product's AttributeSet data
        if (processed === 1) {
          console.log(`\n📊 DETAILED PRODUCT DATA DEBUG - Sample:`)
          console.log(`   ProductCode: ${detailData.ProductCode}`);
          console.log(`   ProductDescription: ${detailData.ProductDescription}`);
          console.log(`   AttributeSet exists: ${!!detailData.AttributeSet}`);
          if (detailData.AttributeSet) {
            console.log(`   AttributeSet keys:`, Object.keys(detailData.AttributeSet));
            console.log(`   Full AttributeSet:`, JSON.stringify(detailData.AttributeSet, null, 2));
          } else {
            console.log(`   ❌ Still no AttributeSet data in detailed view`);
            console.log(`   Available detailed fields:`, Object.keys(detailData));
          }
        }
      } else {
        console.log(`⚠️  Failed to fetch details for ${product.ProductCode}: ${detailResponse.status}`);
        detailedProducts.push(product); // Use basic data as fallback
        processed++;
      }
    } catch (error) {
      console.log(`⚠️  Error fetching details for ${product.ProductCode}:`, error.message);
      detailedProducts.push(product); // Use basic data as fallback
      processed++;
    }
    
    // Add small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  console.log(`✅ Processed ${processed} products with detailed data`);
  results.products = detailedProducts;

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
            metafields(first: 10, keys: ["custom.warehouse_code"]) {
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