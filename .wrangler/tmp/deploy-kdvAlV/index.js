var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/helpers.js
var require_helpers = __commonJS({
  "src/helpers.js"(exports, module) {
    function slugify(text) {
      return text.toString().toLowerCase().trim().replace(/\s+/g, "-").replace(/[^\w\-]+/g, "").replace(/\-\-+/g, "-").replace(/^-+/, "").replace(/-+$/, "");
    }
    __name(slugify, "slugify");
    function validateEmail(email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (emailRegex.test(email)) {
        return email;
      }
      throw new Error(`Invalid email format: ${email}`);
    }
    __name(validateEmail, "validateEmail");
    module.exports = {
      slugify,
      validateEmail
    };
  }
});

// src/customer-mapping.js
var require_customer_mapping = __commonJS({
  "src/customer-mapping.js"(exports, module) {
    var { slugify, validateEmail } = require_helpers();
    async function mapCustomers2(unleashedCustomers, shopifyCustomers) {
      const results = {
        toCreate: [],
        toUpdate: [],
        processed: 0,
        errors: []
      };
      try {
        for (const unleashedCustomer of unleashedCustomers) {
          try {
            const email = unleashedCustomer.Email || `${unleashedCustomer.CustomerCode}@placeholder.com`;
            const firstName = unleashedCustomer.ContactFirstName || unleashedCustomer.CustomerName.split(" ")[0];
            const lastName = unleashedCustomer.ContactLastName || unleashedCustomer.CustomerName.split(" ").slice(1).join(" ");
            const matchingCustomer = shopifyCustomers.find(
              (sc) => sc.email.toLowerCase() === email.toLowerCase() || (sc.firstName + " " + sc.lastName).toLowerCase() === (firstName + " " + lastName).toLowerCase() || sc.metafields?.find((m) => m.key === "unleashed_customer_code" && m.value === unleashedCustomer.CustomerCode)
            );
            const customerData = {
              firstName,
              lastName,
              email: validateEmail(email),
              phone: unleashedCustomer.PhoneNumber || unleashedCustomer.MobileNumber,
              metafields: [
                {
                  namespace: "unleashed",
                  key: "unleashed_customer_code",
                  value: unleashedCustomer.CustomerCode
                },
                {
                  namespace: "unleashed",
                  key: "unleashed_customer_name",
                  value: unleashedCustomer.CustomerName
                },
                {
                  namespace: "unleashed",
                  key: "unleashed_sell_price_tier",
                  value: unleashedCustomer.SellPriceTier
                }
              ]
            };
            if (matchingCustomer) {
              customerData.id = matchingCustomer.id;
              results.toUpdate.push(customerData);
            } else {
              results.toCreate.push(customerData);
            }
            results.processed++;
          } catch (error) {
            results.errors.push({
              customerCode: unleashedCustomer.CustomerCode,
              error: error.message
            });
          }
        }
      } catch (error) {
        throw new Error(`Customer mapping failed: ${error.message}`);
      }
      return results;
    }
    __name(mapCustomers2, "mapCustomers");
    module.exports = {
      mapCustomers: mapCustomers2
    };
  }
});

// src/location-mapping.js
var require_location_mapping = __commonJS({
  "src/location-mapping.js"(exports, module) {
    var COUNTRY_CODE_MAPPING = {
      "Australia": "AU",
      "United States": "US",
      "Canada": "CA",
      "United Kingdom": "GB",
      "New Zealand": "NZ"
    };
    var PROVINCE_CODE_MAPPING = {
      // Australia
      "New South Wales": "NSW",
      "Victoria": "VIC",
      "Queensland": "QLD",
      "Western Australia": "WA",
      "South Australia": "SA",
      "Tasmania": "TAS",
      "Northern Territory": "NT",
      "Australian Capital Territory": "ACT",
      // United States
      "Alabama": "AL",
      "Alaska": "AK",
      "Arizona": "AZ",
      "Arkansas": "AR",
      "California": "CA",
      "Colorado": "CO",
      "Connecticut": "CT",
      "Delaware": "DE",
      "Florida": "FL",
      "Georgia": "GA",
      "Hawaii": "HI",
      "Idaho": "ID",
      "Illinois": "IL",
      "Indiana": "IN",
      "Iowa": "IA",
      "Kansas": "KS",
      "Kentucky": "KY",
      "Louisiana": "LA",
      "Maine": "ME",
      "Maryland": "MD",
      "Massachusetts": "MA",
      "Michigan": "MI",
      "Minnesota": "MN",
      "Mississippi": "MS",
      "Missouri": "MO",
      "Montana": "MT",
      "Nebraska": "NE",
      "Nevada": "NV",
      "New Hampshire": "NH",
      "New Jersey": "NJ",
      "New Mexico": "NM",
      "New York": "NY",
      "North Carolina": "NC",
      "North Dakota": "ND",
      "Ohio": "OH",
      "Oklahoma": "OK",
      "Oregon": "OR",
      "Pennsylvania": "PA",
      "Rhode Island": "RI",
      "South Carolina": "SC",
      "South Dakota": "SD",
      "Tennessee": "TN",
      "Texas": "TX",
      "Utah": "UT",
      "Vermont": "VT",
      "Virginia": "VA",
      "Washington": "WA",
      "West Virginia": "WV",
      "Wisconsin": "WI",
      "Wyoming": "WY",
      // Canada
      "Alberta": "AB",
      "British Columbia": "BC",
      "Manitoba": "MB",
      "New Brunswick": "NB",
      "Newfoundland and Labrador": "NL",
      "Northwest Territories": "NT",
      "Nova Scotia": "NS",
      "Nunavut": "NU",
      "Ontario": "ON",
      "Prince Edward Island": "PE",
      "Quebec": "QC",
      "Saskatchewan": "SK",
      "Yukon": "YT"
    };
    async function mapLocations3(unleashedWarehouses, shopifyLocations) {
      console.log("\u{1F5FA}\uFE0F === STARTING LOCATION MAPPING ===");
      console.log(`\u{1F4CA} Input data: ${unleashedWarehouses.length} Unleashed warehouses, ${shopifyLocations.length} Shopify locations`);
      const results = {
        toCreate: [],
        toUpdate: [],
        processed: 0,
        errors: [],
        mappingDetails: {
          unleashedWarehouses: unleashedWarehouses.length,
          shopifyLocations: shopifyLocations.length,
          countryMappings: {},
          provinceMappings: {},
          matchingLogic: []
        }
      };
      console.log("\u{1F4CD} Existing Shopify locations:");
      shopifyLocations.forEach((loc, index) => {
        console.log(`   ${index + 1}. "${loc.name}" (ID: ${loc.id})`);
      });
      try {
        console.log("\n\u{1F504} Processing Unleashed warehouses...");
        for (const warehouse of unleashedWarehouses) {
          try {
            console.log(`
\u{1F4E6} Processing warehouse: ${warehouse.WarehouseCode}`);
            console.log(`   Original data:`, {
              WarehouseCode: warehouse.WarehouseCode,
              WarehouseName: warehouse.WarehouseName,
              AddressLine1: warehouse.AddressLine1,
              AddressLine2: warehouse.AddressLine2,
              City: warehouse.City,
              Region: warehouse.Region,
              Country: warehouse.Country,
              PostCode: warehouse.PostCode,
              PhoneNumber: warehouse.PhoneNumber
            });
            const locationName = warehouse.WarehouseName;
            console.log(`   \u{1F3F7}\uFE0F Generated location name: "${locationName}"`);
            let mappedCountryCode = null;
            if (warehouse.Country) {
              mappedCountryCode = COUNTRY_CODE_MAPPING[warehouse.Country] || warehouse.Country;
              console.log(`   \u{1F30D} Country mapped: "${warehouse.Country}" \u2192 "${mappedCountryCode}"`);
            } else {
              console.log(`   \u{1F30D} Country unchanged: "null"`);
            }
            let mappedProvinceCode = warehouse.Region;
            console.log(`   \u{1F3DB}\uFE0F Province unchanged: "${mappedProvinceCode}"`);
            console.log(`   \u{1F50D} Searching for matching Shopify location with name: "${locationName}"`);
            const matchingLocation = shopifyLocations.find(
              (loc) => loc.name === locationName
            );
            let matchResult = {
              warehouseCode: warehouse.WarehouseCode,
              generatedName: locationName,
              matchFound: !!matchingLocation,
              action: null
            };
            const locationData = {
              name: locationName,
              address1: warehouse.AddressLine1 || "Not specified",
              address2: warehouse.AddressLine2 || "",
              city: warehouse.City || "Not specified",
              provinceCode: mappedProvinceCode,
              countryCode: mappedCountryCode,
              zip: warehouse.PostCode || "00000",
              phone: warehouse.PhoneNumber || "",
              warehouseCode: warehouse.WarehouseCode
              // For metafields
            };
            console.log(`   \u{1F4CB} Prepared location data:`, locationData);
            if (matchingLocation) {
              console.log(`   \u2705 Match found! Existing location ID: ${matchingLocation.id}`);
              console.log(`   \u{1F504} Will UPDATE existing location`);
              const locationId = matchingLocation.id.startsWith("gid://") ? matchingLocation.id : `gid://shopify/Location/${matchingLocation.id}`;
              locationData.id = locationId;
              results.toUpdate.push(locationData);
              matchResult.action = "update";
              matchResult.existingLocationId = locationId;
              console.log(`   \u{1F4DD} Comparing current vs new data:`);
              console.log(`      Name: "${matchingLocation.name}" (unchanged)`);
              if (matchingLocation.address) {
                console.log(`      Address1: "${matchingLocation.address.address1 || "N/A"}" \u2192 "${locationData.address1}"`);
                console.log(`      City: "${matchingLocation.address.city || "N/A"}" \u2192 "${locationData.city}"`);
                console.log(`      Province: "${matchingLocation.address.provinceCode || "N/A"}" \u2192 "${locationData.provinceCode}"`);
                console.log(`      Country: "${matchingLocation.address.countryCode || "N/A"}" \u2192 "${locationData.countryCode}"`);
                console.log(`      Zip: "${matchingLocation.address.zip || "N/A"}" \u2192 "${locationData.zip}"`);
                console.log(`      Phone: "${matchingLocation.address.phone || "N/A"}" \u2192 "${locationData.phone}"`);
              }
            } else {
              console.log(`   \u274C No match found for "${locationName}"`);
              console.log(`   \u{1F195} Will CREATE new location`);
              results.toCreate.push(locationData);
              matchResult.action = "create";
            }
            results.mappingDetails.matchingLogic.push(matchResult);
            results.processed++;
            console.log(`   \u2705 Warehouse "${warehouse.WarehouseCode}" processed successfully`);
          } catch (error) {
            console.error(`   \u274C Error processing warehouse "${warehouse.WarehouseCode}":`, error.message);
            results.errors.push({
              warehouseCode: warehouse.WarehouseCode,
              error: error.message
            });
          }
        }
        console.log("\n\u{1F3AF} === LOCATION MAPPING SUMMARY ===");
        console.log(`\u{1F4CA} Total processed: ${results.processed}/${unleashedWarehouses.length}`);
        console.log(`\u{1F195} Locations to create: ${results.toCreate.length}`);
        console.log(`\u{1F504} Locations to update: ${results.toUpdate.length}`);
        console.log(`\u274C Errors encountered: ${results.errors.length}`);
        if (results.toCreate.length > 0) {
          console.log("\n\u{1F195} NEW LOCATIONS TO CREATE:");
          results.toCreate.forEach((loc, index) => {
            console.log(`   ${index + 1}. "${loc.name}" at ${loc.address1}, ${loc.city}, ${loc.provinceCode}, ${loc.countryCode}`);
          });
        }
        if (results.toUpdate.length > 0) {
          console.log("\n\u{1F504} EXISTING LOCATIONS TO UPDATE:");
          results.toUpdate.forEach((loc, index) => {
            console.log(`   ${index + 1}. "${loc.name}" (ID: ${loc.id}) at ${loc.address1}, ${loc.city}, ${loc.provinceCode}, ${loc.countryCode}`);
          });
        }
        if (results.errors.length > 0) {
          console.log("\n\u274C ERRORS ENCOUNTERED:");
          results.errors.forEach((error, index) => {
            console.log(`   ${index + 1}. Warehouse "${error.warehouseCode}": ${error.error}`);
          });
        }
        const countryMappingsUsed = Object.keys(results.mappingDetails.countryMappings);
        if (countryMappingsUsed.length > 0) {
          console.log("\n\u{1F30D} COUNTRY MAPPINGS APPLIED:");
          countryMappingsUsed.forEach((original) => {
            console.log(`   "${original}" \u2192 "${results.mappingDetails.countryMappings[original]}"`);
          });
        }
        const provinceMappingsUsed = Object.keys(results.mappingDetails.provinceMappings);
        if (provinceMappingsUsed.length > 0) {
          console.log("\n\u{1F3DB}\uFE0F PROVINCE/STATE MAPPINGS APPLIED:");
          provinceMappingsUsed.forEach((original) => {
            console.log(`   "${original}" \u2192 "${results.mappingDetails.provinceMappings[original]}"`);
          });
        }
      } catch (error) {
        console.error("\u{1F6A8} Critical error in location mapping:", error);
        throw new Error(`Location mapping failed: ${error.message}`);
      }
      console.log("\u{1F5FA}\uFE0F === LOCATION MAPPING COMPLETE ===\n");
      return results;
    }
    __name(mapLocations3, "mapLocations");
    module.exports = {
      mapLocations: mapLocations3,
      COUNTRY_CODE_MAPPING,
      PROVINCE_CODE_MAPPING
    };
  }
});

// src/product-mapping.js
var require_product_mapping = __commonJS({
  "src/product-mapping.js"(exports, module) {
    var { slugify } = require_helpers();
    function generateVariantTitle(options) {
      if (!options || !options.length) return "Default Title";
      return options.map((opt) => opt.value).join(" / ");
    }
    __name(generateVariantTitle, "generateVariantTitle");
    function groupUnleashedProducts(products) {
      const groups = /* @__PURE__ */ new Map();
      let filteredCount = 0;
      const filterReasons = {
        isComponent: 0,
        notSellable: 0,
        both: 0
      };
      console.log(`Processing ${products.length} Unleashed products...`);
      for (const product of products) {
        const isComponent = product.IsComponent;
        const isNotSellable = !product.IsSellable;
        if (isComponent || isNotSellable) {
          filteredCount++;
          if (isComponent && isNotSellable) {
            filterReasons.both++;
            console.log(`Filtered: ${product.ProductCode} - ${product.ProductDescription} (Component & Not Sellable)`);
          } else if (isComponent) {
            filterReasons.isComponent++;
            console.log(`Filtered: ${product.ProductCode} - ${product.ProductDescription} (Component)`);
          } else if (isNotSellable) {
            filterReasons.notSellable++;
            console.log(`Filtered: ${product.ProductCode} - ${product.ProductDescription} (Not Sellable)`);
          }
          continue;
        }
        const groupKey = product.AttributeSet?.ProductTitle || product.ProductDescription;
        if (!groups.has(groupKey)) {
          groups.set(groupKey, []);
        }
        groups.get(groupKey).push(product);
      }
      console.log(`Product filtering summary:`);
      console.log(`- Total products: ${products.length}`);
      console.log(`- Filtered out: ${filteredCount}`);
      console.log(`  - Components: ${filterReasons.isComponent}`);
      console.log(`  - Not sellable: ${filterReasons.notSellable}`);
      console.log(`  - Both: ${filterReasons.both}`);
      console.log(`- Remaining for sync: ${products.length - filteredCount}`);
      console.log(`- Product groups created: ${groups.size}`);
      return Array.from(groups.values());
    }
    __name(groupUnleashedProducts, "groupUnleashedProducts");
    async function mapProducts2(unleashedProducts, shopifyProducts) {
      const results = {
        toCreate: [],
        toUpdate: [],
        toArchive: [],
        processed: 0,
        errors: []
      };
      try {
        const productGroups = groupUnleashedProducts(unleashedProducts);
        for (const group of productGroups) {
          try {
            const mainProduct = group[0];
            const isMultiVariant = group.length > 1;
            const productTitle = isMultiVariant ? mainProduct.AttributeSet.ProductTitle : mainProduct.ProductDescription;
            const handle = slugify(productTitle);
            const matchingProduct = shopifyProducts.find((sp) => sp.handle === handle);
            const productData = {
              handle,
              title: productTitle,
              description: mainProduct.ProductDescription,
              product_type: mainProduct.ProductGroup?.GroupName || "",
              vendor: mainProduct.ProductBrand?.BrandName || "Default",
              status: mainProduct.Obsolete ? "ARCHIVED" : "ACTIVE",
              tags: [
                mainProduct.ProductSubGroup?.GroupName,
                mainProduct.ProductGroup?.GroupName
              ].filter(Boolean),
              images: [{
                src: mainProduct.ImageUrl || mainProduct.Images && mainProduct.Images[0]?.Url
              }].filter((img) => img.src),
              variants: group.map((product) => ({
                sku: product.ProductCode,
                title: isMultiVariant ? generateVariantTitle(product.AttributeSet?.Options) : "Default Title",
                price: product.DefaultSellPrice,
                compare_at_price: null,
                weight: product.Weight || 0,
                weight_unit: "g",
                inventory_management: !product.NeverDiminishing && product.IsSellable ? "shopify" : null,
                inventory_policy: "deny",
                option1: product.AttributeSet?.Options?.[0]?.value,
                option2: product.AttributeSet?.Options?.[1]?.value,
                option3: product.AttributeSet?.Options?.[2]?.value,
                metafields: Array.from({ length: 10 }, (_, i) => ({
                  namespace: "custom",
                  key: `price_tier_${i + 1}`,
                  value: product[`SellPriceTier${i + 1}`]?.Value || ""
                }))
              })),
              options: isMultiVariant ? Array.from(new Set(group.flatMap(
                (p) => p.AttributeSet?.Options?.map((o) => o.name) || []
              ))).slice(0, 3).map((name) => ({ name })) : [{ name: "Title" }]
            };
            if (matchingProduct) {
              const skusMatch = isMultiVariant ? group.some((p) => matchingProduct.variants.some((v) => v.sku === p.ProductCode)) : matchingProduct.variants[0]?.sku === mainProduct.ProductCode;
              if (skusMatch) {
                productData.id = matchingProduct.id;
                productData.variants = productData.variants.map((v) => {
                  const matchingVariant = matchingProduct.variants.find((mv) => mv.sku === v.sku);
                  if (matchingVariant) v.id = matchingVariant.id;
                  return v;
                });
                results.toUpdate.push(productData);
              } else {
                productData.handle = `${handle}-${mainProduct.ProductCode}`;
                results.toCreate.push(productData);
              }
            } else {
              results.toCreate.push(productData);
            }
            results.processed++;
          } catch (error) {
            results.errors.push({
              productCode: group[0].ProductCode,
              error: error.message
            });
          }
        }
        const unleashedHandles = new Set(productGroups.map(
          (group) => slugify(group[0].AttributeSet?.ProductTitle || group[0].ProductDescription)
        ));
        const productsToArchive = shopifyProducts.filter((sp) => !sp.status.includes("ARCHIVED") && !unleashedHandles.has(sp.handle)).map((sp) => ({
          id: sp.id,
          status: "ARCHIVED"
        }));
        results.toArchive.push(...productsToArchive);
      } catch (error) {
        throw new Error(`Product mapping failed: ${error.message}`);
      }
      return results;
    }
    __name(mapProducts2, "mapProducts");
    module.exports = {
      mapProducts: mapProducts2,
      generateVariantTitle,
      groupUnleashedProducts
    };
  }
});

// src/data_pull.js
async function getAuthData(kvStore, domain) {
  try {
    const authString = await kvStore.get(domain);
    if (!authString) {
      throw new Error(`No authentication data found for domain: ${domain}`);
    }
    return JSON.parse(authString);
  } catch (error) {
    console.error("Error getting auth data:", error);
    throw new Error(`Failed to get authentication data: ${error.message}`);
  }
}
__name(getAuthData, "getAuthData");
async function generateUnleashedSignature(queryString, apiKey) {
  const encoder = new TextEncoder();
  const keyBuffer = encoder.encode(apiKey);
  const dataBuffer = encoder.encode(queryString);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBuffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, dataBuffer);
  const base64Signature = btoa(String.fromCharCode(...new Uint8Array(signature)));
  return base64Signature;
}
__name(generateUnleashedSignature, "generateUnleashedSignature");
async function createUnleashedHeaders(endpoint, apiKey, apiId) {
  const url = new URL(endpoint);
  const queryString = url.search ? url.search.substring(1) : "";
  const signature = await generateUnleashedSignature(queryString, apiKey);
  return {
    "Content-Type": "application/json",
    "Accept": "application/json",
    "api-auth-id": apiId,
    "api-auth-signature": signature,
    "Client-Type": "kilr/unleashedshopify"
  };
}
__name(createUnleashedHeaders, "createUnleashedHeaders");
async function fetchUnleashedData(authData) {
  const results = {};
  const productsUrl = "https://api.unleashedsoftware.com/Products?pageSize=200&pageNumber=1";
  const productsResponse = await fetch(productsUrl, {
    method: "GET",
    headers: await createUnleashedHeaders(productsUrl, authData.apiKey, authData.apiId)
  });
  const productsData = await productsResponse.json();
  results.products = productsData.Items || [];
  const customersUrl = "https://api.unleashedsoftware.com/Customers?pageSize=200&pageNumber=1";
  const customersResponse = await fetch(customersUrl, {
    method: "GET",
    headers: await createUnleashedHeaders(customersUrl, authData.apiKey, authData.apiId)
  });
  const customersData = await customersResponse.json();
  results.customers = customersData.Items || [];
  const warehousesUrl = "https://api.unleashedsoftware.com/Warehouses";
  const warehousesResponse = await fetch(warehousesUrl, {
    method: "GET",
    headers: await createUnleashedHeaders(warehousesUrl, authData.apiKey, authData.apiId)
  });
  const warehousesData = await warehousesResponse.json();
  results.warehouses = warehousesData.Items || [];
  return results;
}
__name(fetchUnleashedData, "fetchUnleashedData");
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
            status
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
      method: "POST",
      headers,
      body: JSON.stringify({ query, variables })
    });
    const data = await response.json();
    if (data.errors) throw new Error(`Shopify GraphQL errors: ${JSON.stringify(data.errors)}`);
    const products = data.data.products.edges.map((edge) => edge.node);
    allProducts.push(...products);
    hasNextPage = data.data.products.pageInfo.hasNextPage;
    cursor = data.data.products.pageInfo.endCursor;
  }
  return allProducts;
}
__name(fetchShopifyProducts, "fetchShopifyProducts");
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
              keys: ["unleashed.unleashed_customer_code", "unleashed.unleashed_customer_name", "unleashed.unleashed_sell_price_tier"]
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
      method: "POST",
      headers,
      body: JSON.stringify({ query, variables })
    });
    const data = await response.json();
    if (data.errors) throw new Error(`Shopify Customers GraphQL errors: ${JSON.stringify(data.errors)}`);
    const customers = data.data.customers.edges.map((edge) => edge.node);
    allCustomers.push(...customers);
    hasNextPage = data.data.customers.pageInfo.hasNextPage;
    cursor = data.data.customers.pageInfo.endCursor;
  }
  return allCustomers;
}
__name(fetchShopifyCustomers, "fetchShopifyCustomers");
async function fetchShopifyLocations(baseUrl, headers) {
  const response = await fetch(`${baseUrl}/locations.json`, { headers });
  const data = await response.json();
  return data.locations;
}
__name(fetchShopifyLocations, "fetchShopifyLocations");
async function fetchShopifyData(auth) {
  const { accessToken, shopDomain } = auth;
  const baseUrl = `https://${shopDomain}/admin/api/2025-04`;
  const headers = {
    "Content-Type": "application/json",
    "X-Shopify-Access-Token": accessToken
  };
  const [products, customers, locations] = await Promise.all([
    fetchShopifyProducts(baseUrl, headers),
    fetchShopifyCustomers(baseUrl, headers),
    fetchShopifyLocations(baseUrl, headers)
  ]);
  return { products, customers, locations };
}
__name(fetchShopifyData, "fetchShopifyData");
async function pullAllData(domain, env) {
  if (!env.AUTH_STORE) {
    throw new Error("KV binding AUTH_STORE not found");
  }
  const authData = await getAuthData(env.AUTH_STORE, domain);
  if (!authData || !authData.unleashed || !authData.shopify) {
    throw new Error("Invalid authentication data structure");
  }
  const [unleashedData, shopifyData] = await Promise.all([
    fetchUnleashedData(authData.unleashed),
    fetchShopifyData(authData.shopify)
  ]);
  return {
    unleashed: unleashedData,
    shopify: shopifyData
  };
}
__name(pullAllData, "pullAllData");

// src/index.js
var import_customer_mapping = __toESM(require_customer_mapping());
var import_location_mapping2 = __toESM(require_location_mapping());
var import_product_mapping = __toESM(require_product_mapping());

// src/location-mutation-handler.js
var import_location_mapping = __toESM(require_location_mapping());

// src/location-mutations.js
var MAX_BATCH_SIZE = 10;
var MUTATION_DELAY = 100;
var CREATE_LOCATION_MUTATION = `
  mutation locationAdd($input: LocationAddInput!) {
    locationAdd(input: $input) {
      location {
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
        fulfillsOnlineOrders
      }
      userErrors {
        field
        message
      }
    }
  }
`;
var UPDATE_LOCATION_MUTATION = `
  mutation locationEdit($id: ID!, $input: LocationEditInput!) {
    locationEdit(id: $id, input: $input) {
      location {
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
        fulfillsOnlineOrders
      }
      userErrors {
        field
        message
      }
    }
  }
`;
async function executeMutation(baseUrl, headers, mutation, variables) {
  try {
    const response = await fetch(`${baseUrl}/graphql.json`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        query: mutation,
        variables
      })
    });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const result = await response.json();
    if (result.errors) {
      throw new Error(`GraphQL errors: ${JSON.stringify(result.errors)}`);
    }
    return result.data;
  } catch (error) {
    console.error("Mutation execution failed:", error);
    throw error;
  }
}
__name(executeMutation, "executeMutation");
async function createLocationsBatch(baseUrl, headers, locationsToCreate) {
  const results = {
    successful: [],
    failed: [],
    totalProcessed: 0
  };
  console.log(`\u{1F4CD} Starting creation of ${locationsToCreate.length} locations in batches of ${MAX_BATCH_SIZE}`);
  for (let i = 0; i < locationsToCreate.length; i += MAX_BATCH_SIZE) {
    const batch = locationsToCreate.slice(i, i + MAX_BATCH_SIZE);
    console.log(`\u{1F4E6} Processing batch ${Math.floor(i / MAX_BATCH_SIZE) + 1} with ${batch.length} locations`);
    for (const locationData of batch) {
      try {
        console.log(`\u{1F3D7}\uFE0F Creating location: "${locationData.name}"`);
        console.log(`   Address: ${locationData.address1}, ${locationData.city}, ${locationData.provinceCode}, ${locationData.countryCode}`);
        const locationInput = {
          name: locationData.name,
          address: {
            address1: locationData.address1,
            address2: locationData.address2 || "",
            city: locationData.city,
            provinceCode: locationData.provinceCode,
            countryCode: locationData.countryCode,
            zip: locationData.zip,
            phone: locationData.phone || ""
          },
          fulfillsOnlineOrders: true
        };
        if (locationData.warehouseCode) {
          locationInput.metafields = [
            {
              namespace: "custom",
              key: "warehouse_code",
              value: locationData.warehouseCode,
              type: "single_line_text_field"
            }
          ];
        }
        const mutationResult = await executeMutation(
          baseUrl,
          headers,
          CREATE_LOCATION_MUTATION,
          { input: locationInput }
        );
        if (mutationResult.locationAdd.userErrors.length > 0) {
          const errors = mutationResult.locationAdd.userErrors;
          console.error(`\u274C Failed to create location "${locationData.name}":`, errors);
          results.failed.push({
            locationData,
            errors: errors.map((e) => `${e.field}: ${e.message}`)
          });
        } else {
          const createdLocation = mutationResult.locationAdd.location;
          console.log(`\u2705 Successfully created location: "${createdLocation.name}" (ID: ${createdLocation.id})`);
          results.successful.push({
            originalData: locationData,
            shopifyLocation: createdLocation
          });
        }
        results.totalProcessed++;
      } catch (error) {
        console.error(`\u274C Error creating location "${locationData.name}":`, error.message);
        results.failed.push({
          locationData,
          errors: [error.message]
        });
        results.totalProcessed++;
      }
    }
    if (i + MAX_BATCH_SIZE < locationsToCreate.length) {
      console.log(`\u23F3 Waiting ${MUTATION_DELAY}ms before next batch...`);
      await new Promise((resolve) => setTimeout(resolve, MUTATION_DELAY));
    }
  }
  return results;
}
__name(createLocationsBatch, "createLocationsBatch");
async function updateLocationsBatch(baseUrl, headers, locationsToUpdate) {
  const results = {
    successful: [],
    failed: [],
    totalProcessed: 0
  };
  console.log(`\u{1F4CD} Starting update of ${locationsToUpdate.length} locations in batches of ${MAX_BATCH_SIZE}`);
  for (let i = 0; i < locationsToUpdate.length; i += MAX_BATCH_SIZE) {
    const batch = locationsToUpdate.slice(i, i + MAX_BATCH_SIZE);
    console.log(`\u{1F4E6} Processing batch ${Math.floor(i / MAX_BATCH_SIZE) + 1} with ${batch.length} locations`);
    for (const locationData of batch) {
      try {
        console.log(`\u{1F504} Updating location: "${locationData.name}" (ID: ${locationData.id})`);
        console.log(`   New Address: ${locationData.address1}, ${locationData.city}, ${locationData.provinceCode}, ${locationData.countryCode}`);
        const locationInput = {
          name: locationData.name,
          address: {
            address1: locationData.address1,
            address2: locationData.address2 || "",
            city: locationData.city,
            provinceCode: locationData.provinceCode,
            countryCode: locationData.countryCode,
            zip: locationData.zip,
            phone: locationData.phone || ""
          },
          fulfillsOnlineOrders: true
        };
        if (locationData.warehouseCode) {
          locationInput.metafields = [
            {
              namespace: "custom",
              key: "warehouse_code",
              value: locationData.warehouseCode,
              type: "single_line_text_field"
            }
          ];
        }
        const mutationResult = await executeMutation(
          baseUrl,
          headers,
          UPDATE_LOCATION_MUTATION,
          {
            id: locationData.id,
            input: locationInput
          }
        );
        if (mutationResult.locationEdit.userErrors.length > 0) {
          const errors = mutationResult.locationEdit.userErrors;
          console.error(`\u274C Failed to update location "${locationData.name}" (ID: ${locationData.id}):`, errors);
          results.failed.push({
            locationData,
            errors: errors.map((e) => `${e.field}: ${e.message}`)
          });
        } else {
          const updatedLocation = mutationResult.locationEdit.location;
          console.log(`\u2705 Successfully updated location: "${updatedLocation.name}" (ID: ${updatedLocation.id})`);
          results.successful.push({
            originalData: locationData,
            shopifyLocation: updatedLocation
          });
        }
        results.totalProcessed++;
      } catch (error) {
        console.error(`\u274C Error updating location "${locationData.name}" (ID: ${locationData.id}):`, error.message);
        results.failed.push({
          locationData,
          errors: [error.message]
        });
        results.totalProcessed++;
      }
    }
    if (i + MAX_BATCH_SIZE < locationsToUpdate.length) {
      console.log(`\u23F3 Waiting ${MUTATION_DELAY}ms before next batch...`);
      await new Promise((resolve) => setTimeout(resolve, MUTATION_DELAY));
    }
  }
  return results;
}
__name(updateLocationsBatch, "updateLocationsBatch");
async function mutateLocations(authData, mappingResults) {
  const { accessToken, shopDomain } = authData;
  const baseUrl = `https://${shopDomain}/admin/api/2025-04`;
  const headers = {
    "Content-Type": "application/json",
    "X-Shopify-Access-Token": accessToken
  };
  const results = {
    created: { successful: [], failed: [], totalProcessed: 0 },
    updated: { successful: [], failed: [], totalProcessed: 0 },
    summary: {
      totalLocationsProcessed: 0,
      totalSuccessful: 0,
      totalFailed: 0,
      createdCount: 0,
      updatedCount: 0,
      startTime: (/* @__PURE__ */ new Date()).toISOString(),
      endTime: null,
      duration: null
    }
  };
  const startTime = Date.now();
  try {
    console.log("\u{1F680} Starting location mutations...");
    console.log(`\u{1F4CA} Summary: ${mappingResults.toCreate.length} to create, ${mappingResults.toUpdate.length} to update`);
    if (mappingResults.toCreate.length > 0) {
      console.log("\n\u{1F3D7}\uFE0F === CREATING NEW LOCATIONS ===");
      results.created = await createLocationsBatch(baseUrl, headers, mappingResults.toCreate);
    } else {
      console.log("\n\u{1F3D7}\uFE0F === NO NEW LOCATIONS TO CREATE ===");
    }
    if (mappingResults.toUpdate.length > 0) {
      console.log("\n\u{1F504} === UPDATING EXISTING LOCATIONS ===");
      results.updated = await updateLocationsBatch(baseUrl, headers, mappingResults.toUpdate);
    } else {
      console.log("\n\u{1F504} === NO EXISTING LOCATIONS TO UPDATE ===");
    }
    const endTime = Date.now();
    results.summary.totalLocationsProcessed = results.created.totalProcessed + results.updated.totalProcessed;
    results.summary.totalSuccessful = results.created.successful.length + results.updated.successful.length;
    results.summary.totalFailed = results.created.failed.length + results.updated.failed.length;
    results.summary.createdCount = results.created.successful.length;
    results.summary.updatedCount = results.updated.successful.length;
    results.summary.endTime = (/* @__PURE__ */ new Date()).toISOString();
    results.summary.duration = `${((endTime - startTime) / 1e3).toFixed(2)}s`;
    console.log("\n\u{1F3AF} === LOCATION MUTATIONS COMPLETE ===");
    console.log(`\u{1F4CA} Total Processed: ${results.summary.totalLocationsProcessed}`);
    console.log(`\u2705 Successful: ${results.summary.totalSuccessful} (${results.summary.createdCount} created, ${results.summary.updatedCount} updated)`);
    console.log(`\u274C Failed: ${results.summary.totalFailed}`);
    console.log(`\u23F1\uFE0F Duration: ${results.summary.duration}`);
    if (results.summary.totalFailed > 0) {
      console.log("\n\u274C Failed Operations:");
      results.created.failed.forEach((failure) => {
        console.log(`   Create "${failure.locationData.name}": ${failure.errors.join(", ")}`);
      });
      results.updated.failed.forEach((failure) => {
        console.log(`   Update "${failure.locationData.name}": ${failure.errors.join(", ")}`);
      });
    }
  } catch (error) {
    console.error("\u{1F6A8} Critical error during location mutations:", error);
    throw error;
  }
  return results;
}
__name(mutateLocations, "mutateLocations");

// src/location-mutation-handler.js
async function getAuthData2(env, domain) {
  if (!env.AUTH_STORE) {
    throw new Error("KV binding AUTH_STORE not found");
  }
  try {
    const authString = await env.AUTH_STORE.get(domain);
    if (!authString) {
      throw new Error(`No authentication data found for domain: ${domain}`);
    }
    return JSON.parse(authString);
  } catch (error) {
    console.error("Error getting auth data:", error);
    throw new Error(`Failed to get authentication data: ${error.message}`);
  }
}
__name(getAuthData2, "getAuthData");
function jsonResponse(data, status = 200) {
  const corsHeaders2 = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, Accept, Accept-Encoding, Accept-Language, Content-Length, Origin, Referer, User-Agent, X-Forwarded-Proto",
    "Access-Control-Max-Age": "86400"
    // 24 hours cache for preflight
  };
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      ...corsHeaders2,
      "Content-Type": "application/json"
    }
  });
}
__name(jsonResponse, "jsonResponse");
async function handleLocationMutations(request, env) {
  try {
    let domain = null;
    try {
      const rawBody = await request.text();
      if (!rawBody) {
        return jsonResponse({
          error: "Empty request body",
          details: "Request body is required and must contain a domain."
        }, 400);
      }
      const requestBody = JSON.parse(rawBody);
      domain = requestBody.domain;
      if (!domain) {
        return jsonResponse({
          error: "Domain is required",
          details: "The request body must contain a domain field."
        }, 400);
      }
    } catch (error) {
      return jsonResponse({
        error: "Invalid request body",
        details: error.message
      }, 400);
    }
    domain = domain.replace(/^https?:\/\//, "").split("/")[0];
    console.log(`\u{1F680} Starting location mutations for domain: ${domain}`);
    const authData = await getAuthData2(env, domain);
    if (!authData || !authData.unleashed || !authData.shopify) {
      throw new Error("Invalid authentication data structure");
    }
    const data = await pullAllData(domain, env);
    console.log("Data pulled successfully for mutations:", {
      unleashed: {
        warehouses: data.unleashed.warehouses.length
      },
      shopify: {
        locations: data.shopify.locations.length
      }
    });
    console.log("\u{1F5FA}\uFE0F Starting location mapping for mutations...");
    const locationMappingResults = await (0, import_location_mapping.mapLocations)(data.unleashed.warehouses, data.shopify.locations);
    console.log("\u{1F504} Starting location mutations...");
    const mutationResults = await mutateLocations(authData.shopify, locationMappingResults);
    console.log("\u2705 Location mutations completed successfully");
    return jsonResponse({
      success: true,
      domain,
      mappingResults: {
        toCreate: locationMappingResults.toCreate.length,
        toUpdate: locationMappingResults.toUpdate.length,
        errors: locationMappingResults.errors.length,
        processed: locationMappingResults.processed
      },
      mutationResults: {
        created: {
          successful: mutationResults.created.successful.length,
          failed: mutationResults.created.failed.length
        },
        updated: {
          successful: mutationResults.updated.successful.length,
          failed: mutationResults.updated.failed.length
        },
        summary: mutationResults.summary
      },
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
  } catch (error) {
    console.error("\u{1F6A8} Location mutation handler error:", error);
    return jsonResponse({
      error: error.message || "Internal server error",
      details: error.stack
    }, 500);
  }
}
__name(handleLocationMutations, "handleLocationMutations");
async function handleLocationSync(request, env) {
  try {
    let domain = null;
    try {
      const rawBody = await request.text();
      if (!rawBody) {
        return jsonResponse({
          error: "Empty request body",
          details: "Request body is required and must contain a domain."
        }, 400);
      }
      const requestBody = JSON.parse(rawBody);
      domain = requestBody.domain;
      if (!domain) {
        return jsonResponse({
          error: "Domain is required",
          details: "The request body must contain a domain field."
        }, 400);
      }
    } catch (error) {
      return jsonResponse({
        error: "Invalid request body",
        details: error.message
      }, 400);
    }
    domain = domain.replace(/^https?:\/\//, "").split("/")[0];
    console.log(`\u{1F504} Starting complete location sync workflow for domain: ${domain}`);
    const authData = await getAuthData2(env, domain);
    if (!authData || !authData.unleashed || !authData.shopify) {
      throw new Error("Invalid authentication data structure");
    }
    console.log("\u{1F4CA} Step 1: Fetching data from Unleashed and Shopify...");
    const data = await pullAllData(domain, env);
    console.log("Data pulled successfully:", {
      unleashed: {
        warehouses: data.unleashed.warehouses.length
      },
      shopify: {
        locations: data.shopify.locations.length
      }
    });
    console.log("\u{1F5FA}\uFE0F Step 2: Mapping locations...");
    const locationMappingResults = await (0, import_location_mapping.mapLocations)(data.unleashed.warehouses, data.shopify.locations);
    console.log("Mapping completed:", {
      toCreate: locationMappingResults.toCreate.length,
      toUpdate: locationMappingResults.toUpdate.length,
      errors: locationMappingResults.errors.length
    });
    let mutationResults = null;
    if (locationMappingResults.toCreate.length > 0 || locationMappingResults.toUpdate.length > 0) {
      console.log("\u{1F680} Step 3: Executing location mutations...");
      mutationResults = await mutateLocations(authData.shopify, locationMappingResults);
      console.log("\u2705 Location mutations completed successfully");
    } else {
      console.log("\u23ED\uFE0F Step 3: No mutations needed - all locations are up to date");
      mutationResults = {
        created: { successful: [], failed: [], totalProcessed: 0 },
        updated: { successful: [], failed: [], totalProcessed: 0 },
        summary: {
          totalLocationsProcessed: 0,
          totalSuccessful: 0,
          totalFailed: 0,
          createdCount: 0,
          updatedCount: 0,
          startTime: (/* @__PURE__ */ new Date()).toISOString(),
          endTime: (/* @__PURE__ */ new Date()).toISOString(),
          duration: "0.00s"
        }
      };
    }
    console.log("\u{1F3AF} Complete location sync workflow finished successfully");
    return jsonResponse({
      success: true,
      domain,
      workflow: "complete-sync",
      mappingResults: {
        toCreate: locationMappingResults.toCreate.length,
        toUpdate: locationMappingResults.toUpdate.length,
        errors: locationMappingResults.errors.length,
        processed: locationMappingResults.processed,
        details: locationMappingResults.mappingDetails
      },
      mutationResults: {
        created: {
          successful: mutationResults.created.successful.length,
          failed: mutationResults.created.failed.length
        },
        updated: {
          successful: mutationResults.updated.successful.length,
          failed: mutationResults.updated.failed.length
        },
        summary: mutationResults.summary
      },
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
  } catch (error) {
    console.error("\u{1F6A8} Location sync workflow error:", error);
    return jsonResponse({
      error: error.message || "Internal server error",
      details: error.stack
    }, 500);
  }
}
__name(handleLocationSync, "handleLocationSync");

// src/index.js
var corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Accept, Accept-Encoding, Accept-Language, Content-Length, Origin, Referer, User-Agent, X-Forwarded-Proto",
  "Access-Control-Max-Age": "86400"
  // 24 hours cache for preflight
};
function serveClientScript() {
  const clientScript = `!function(e,t){"use strict";
    // Configuration object
    const config = {
        workerUrl: "https://unleashed-shopify-sync-v2.adrian-b0e.workers.dev/api/v2/data-fetch",
        mutationUrl: "https://unleashed-shopify-sync-v2.adrian-b0e.workers.dev/api/v2/mutate-locations",
        syncUrl: "https://unleashed-shopify-sync-v2.adrian-b0e.workers.dev/api/v2/sync-locations",
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
      "Content-Type": "application/javascript",
      "Cache-Control": "no-cache"
      // Prevent caching to ensure updates are immediate
    }
  });
}
__name(serveClientScript, "serveClientScript");
var index_default = {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders
      });
    }
    const url = new URL(request.url);
    if (url.pathname === "/api/v2/data-fetch" && request.method === "POST") {
      return handleLocationSync(request, env);
    }
    if (url.pathname === "/api/v2/mutate-locations" && request.method === "POST") {
      return handleLocationMutations(request, env);
    }
    if (url.pathname === "/api/v2/sync-locations" && request.method === "POST") {
      return handleLocationSync(request, env);
    }
    if (url.pathname === "/client-script.js" && request.method === "GET") {
      return serveClientScript();
    }
    return new Response("Not Found", { status: 404 });
  }
};
export {
  index_default as default
};
//# sourceMappingURL=index.js.map
