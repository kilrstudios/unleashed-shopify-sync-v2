import { slugify } from './helpers.js';

function parseOptionNames(optionNamesString) {
  if (!optionNamesString) return [];
  // Split by comma or pipe and clean up whitespace
  return optionNamesString.split(/[,|]/).map(name => name.trim()).filter(Boolean);
}

function generateVariantTitle(attributeSet) {
  if (!attributeSet) return 'Default Title';
  
  const options = extractVariantOptions(attributeSet);
  return Object.values(options)
    .filter(Boolean)
    .filter(v => v.toLowerCase() !== 'null')
    .join(' / ');
}

// Compare product data to determine if update is needed
function compareProductData(unleashedProductData, shopifyProduct) {
  const differences = [];
  const needsPostSync = {
    inventory: false,
    images: false
  };
  
  // Compare basic product fields
  if (unleashedProductData.title !== shopifyProduct.title) {
    differences.push(`title: "${shopifyProduct.title}" → "${unleashedProductData.title}"`);
  }
  
  if (unleashedProductData.status !== shopifyProduct.status) {
    differences.push(`status: "${shopifyProduct.status}" → "${unleashedProductData.status}"`);
  }
  
  if (unleashedProductData.product_type !== shopifyProduct.productType) {
    differences.push(`productType: "${shopifyProduct.productType}" → "${unleashedProductData.product_type}"`);
  }
  
  if (unleashedProductData.vendor !== shopifyProduct.vendor) {
    differences.push(`vendor: "${shopifyProduct.vendor}" → "${unleashedProductData.vendor}"`);
  }
  
  // Compare variants (only check critical fields that actually matter)
  const unleashedVariants = new Map(unleashedProductData.variants.map(v => [v.sku, v]));
  const shopifyVariants = new Map(shopifyProduct.variants.map(v => [v.sku, v]));
  
  for (const [sku, unleashedVariant] of unleashedVariants) {
    const shopifyVariant = shopifyVariants.get(sku);
    if (!shopifyVariant) {
      differences.push(`variant: New variant with SKU "${sku}"`);
      continue;
    }
    
    // Compare prices (normalize to strings for comparison)
    const unleashedPrice = parseFloat(unleashedVariant.price || 0).toFixed(2);
    const shopifyPrice = parseFloat(shopifyVariant.price || 0).toFixed(2);
    if (unleashedPrice !== shopifyPrice) {
      differences.push(`variant ${sku} price: "${shopifyPrice}" → "${unleashedPrice}"`);
    }
    
    // Compare weights (convert shopify weight to grams, then normalize)
    const unleashedWeight = parseFloat(unleashedVariant.weight || 0);
    const shopifyWeight = parseFloat(shopifyVariant.weight || 0);
    if (Math.abs(unleashedWeight - shopifyWeight) > 0.01) { // Allow small floating point differences
      differences.push(`variant ${sku} weight: "${shopifyWeight}g" → "${unleashedWeight}g"`);
    }
    
    // Compare inventory management
    const unleashedTracked = unleashedVariant.inventory_management === 'shopify';
    const shopifyTracked = shopifyVariant.inventoryItem?.tracked || false;
    if (unleashedTracked !== shopifyTracked) {
      differences.push(`variant ${sku} tracking: ${shopifyTracked} → ${unleashedTracked}`);
    }

    // ---- Inventory comparison by location ----
    if (unleashedVariant.inventory_management === 'shopify') {
      const unleashedInv = new Map();
      (unleashedVariant.inventory_levels || unleashedVariant.inventoryQuantities || []).forEach(lvl => {
        const locId = String(lvl.locationId || lvl.location_id || '');
        if (!locId) return;
        const qty = parseInt(lvl.quantity ?? lvl.available ?? 0, 10);
        unleashedInv.set(locId, isNaN(qty) ? 0 : qty);
      });

      const shopifyInv = new Map();
      const invNodes = shopifyVariant.inventoryItem?.inventoryLevels?.nodes || [];
      invNodes.forEach(node => {
        const locId = String(node.location?.id || '');
        if (!locId) return;
        const qty = parseInt(node.quantities?.[0]?.quantity ?? 0, 10);
        shopifyInv.set(locId, isNaN(qty) ? 0 : qty);
      });

      const allLocIds = new Set([...unleashedInv.keys(), ...shopifyInv.keys()]);
      let inventoryDiffFound = false;
      allLocIds.forEach(locId => {
        const uQty = unleashedInv.get(locId) ?? 0;
        const sQty = shopifyInv.get(locId) ?? 0;
        if (uQty !== sQty) {
          inventoryDiffFound = true;
          differences.push(`variant ${sku} inventory (${locId}): ${sQty} → ${uQty}`);
        }
      });

      if (inventoryDiffFound) {
        // Flag that we need to sync inventory via productSet update or post-sync operation.
        needsPostSync.inventory = true;
      }
    }
  }
  
  // Check for removed variants in Shopify that don't exist in Unleashed
  for (const [sku, shopifyVariant] of shopifyVariants) {
    if (!unleashedVariants.has(sku)) {
      differences.push(`variant: Shopify variant "${sku}" no longer exists in Unleashed`);
    }
  }
  
  // ---- Image comparison (after variants loop) ----
  const baseKey = (url) => {
    if (!url) return '';
    try {
      const u = new URL(url);
      return u.pathname.split('/').pop().split('?')[0].toLowerCase();
    } catch {
      return url.split('/').pop().split('?')[0].toLowerCase();
    }
  };

  const unleashedImageKeys = new Set(
    (unleashedProductData.images || [])
      .map(img => baseKey(img.src))
      .filter(Boolean)
  );

  const shopifyImageKeys = new Set();
  // Variant-level images (available from data_pull)
  shopifyProduct.variants.forEach(v => {
    if (v.image && v.image.url) {
      shopifyImageKeys.add(baseKey(v.image.url));
    }
  });
  // Featured image if present
  if (shopifyProduct.featuredImage && shopifyProduct.featuredImage.url) {
    shopifyImageKeys.add(baseKey(shopifyProduct.featuredImage.url));
  }

  let imagesDifferent = false;
  // Any images present in Unleashed but missing in Shopify?
  unleashedImageKeys.forEach(key => {
    if (!shopifyImageKeys.has(key)) imagesDifferent = true;
  });
  // Any extra images in Shopify that are not in Unleashed?
  shopifyImageKeys.forEach(key => {
    if (!unleashedImageKeys.has(key)) imagesDifferent = true;
  });

  if (imagesDifferent) {
    needsPostSync.images = true;
    differences.push(`product images differ`);
  }
  
  return {
    hasChanges: differences.length > 0,
    differences: differences,
    needsPostSync
  };
}

function getAttributeValue(attributeSet, attributeName) {
  if (!attributeSet || !attributeSet.Attributes) return null;
  const attribute = attributeSet.Attributes.find(attr => attr.Name === attributeName);
  return attribute ? attribute.Value : null;
}

function extractVariantOptions(attributeSet) {
  if (!attributeSet) return { option1: 'Default Title' };
  
  return {
    option1: getAttributeValue(attributeSet, 'Option 1 Value'),
    option2: getAttributeValue(attributeSet, 'Option 2 Value'),
    option3: getAttributeValue(attributeSet, 'Option 3 Value')
  };
}

function extractProductOptions(attributeSet) {
  if (!attributeSet) {
    return [{ name: 'Title' }];
  }
  
  const optionNames = getAttributeValue(attributeSet, 'Option Names');
  if (!optionNames) {
    return [{ name: 'Title' }];
  }
  
  const parsedNames = parseOptionNames(optionNames);
  if (!parsedNames.length) {
    return [{ name: 'Title' }];
  }
  
  return parsedNames.slice(0, 3).map(name => ({ name }));
}

function groupUnleashedProducts(products) {
  const groups = new Map();
  let filteredCount = 0;
  let duplicateSkuCount = 0;
  const filterReasons = {
    isComponent: 0,
    notSellable: 0,
    both: 0
  };
  
  console.log(`Processing ${products.length} Unleashed products...`);
  
  // Track SKUs we've already seen to detect duplicates early
  const seenSkus = new Set();
  
  for (const product of products) {
    const isComponent = product.IsComponent;
    const isNotSellable = !product.IsSellable;
    const sku = product.ProductCode;

    // Check for duplicate SKUs first
    if (seenSkus.has(sku)) {
      duplicateSkuCount++;
      console.log(`⚠️ Skipping duplicate SKU: ${sku} - ${product.ProductDescription}`);
      continue;
    }
    seenSkus.add(sku);

    // NEW FILTERING RULE:
    //   – Skip ONLY when the product is NOT sellable.
    //   – Components are now allowed through as long as they are sellable.
    if (isNotSellable) {
      filteredCount++;
      filterReasons.notSellable++;
      console.log(`Filtered: ${product.ProductCode} - ${product.ProductDescription} (Not Sellable)`);
      continue;
    }
    // Components are no longer filtered; log for visibility if needed
    if (isComponent) {
      console.log(`Component product included: ${product.ProductCode} - ${product.ProductDescription}`);
    }

    // Debug: Log AttributeSet data for grouping analysis
    console.log(`\n🔍 GROUPING DEBUG for "${product.ProductCode}" - "${product.ProductDescription}"`);
    console.log(`   AttributeSet exists: ${!!product.AttributeSet}`);
    if (product.AttributeSet) {
      console.log(`   ProductTitle: "${getAttributeValue(product.AttributeSet, 'Product Title')}"`);
      console.log(`   Option 1 Value: "${getAttributeValue(product.AttributeSet, 'Option 1 Value')}"`);
      console.log(`   Option 2 Value: "${getAttributeValue(product.AttributeSet, 'Option 2 Value')}"`);
      console.log(`   Option 3 Value: "${getAttributeValue(product.AttributeSet, 'Option 3 Value')}"`);
      console.log(`   Option Names: "${getAttributeValue(product.AttributeSet, 'Option Names')}"`);
    } else {
      console.log(`   No AttributeSet - will use ProductDescription as groupKey`);
    }

    // NEW GROUPING LOGIC ----------------------------------------------
    //  • Only group SKUs together when the product has an AttributeSet AND
    //    a non-empty "Product Title" attribute (explicit grouping signal).
    //  • Otherwise, treat each SKU as its own group (key = ProductCode).
    let groupKey;
    if (product.AttributeSet) {
      const attrTitle = getAttributeValue(product.AttributeSet, 'Product Title');
      if (attrTitle && attrTitle.trim() !== '') {
        groupKey = attrTitle.trim();
      } else {
        // No explicit group title – keep SKUs separate
        groupKey = product.ProductCode;
      }
    } else {
      // No AttributeSet – keep SKUs separate
      groupKey = product.ProductCode;
    }
    console.log(`   🎯 Final groupKey: "${groupKey}"`);
    
    if (!groups.has(groupKey)) {
      console.log(`   🆕 Creating new group: "${groupKey}"`);
      groups.set(groupKey, []);
    } else {
      console.log(`   📝 Adding to existing group: "${groupKey}"`);
    }
    groups.get(groupKey).push(product);
  }

  console.log(`Product filtering summary:`);
  console.log(`- Total products: ${products.length}`);
  console.log(`- Duplicate SKUs skipped: ${duplicateSkuCount}`);
  console.log(`- Filtered out: ${filteredCount}`);
  console.log(`  - Components: ${filterReasons.isComponent}`);
  console.log(`  - Not sellable: ${filterReasons.notSellable}`);
  console.log(`  - Both: ${filterReasons.both}`);
  console.log(`- Remaining for sync: ${products.length - filteredCount - duplicateSkuCount}`);
  console.log(`- Product groups created: ${groups.size}`);

  return {
    groupsMap: groups,
    stats: {
      totalProducts: products.length,
      duplicateSkuCount,
      filteredCount,
      filterReasons,
      groupsCreated: groups.size,
      remainingProducts: products.length - filteredCount - duplicateSkuCount
    }
  };
}

// SKU-based mapping approach - Use SKU as the master key for all matching
async function mapProducts(unleashedProducts, shopifyProducts, shopifyLocations = [], defaultWarehouseCode = null) {
  const results = {
    toCreate: [],
    toUpdate: [],
    toArchive: [],
    skipped: [],
    processed: 0,
    errors: [],
    details: null,
    mappingLog: [] // Comprehensive JSON log for debugging
  };

  console.log('\n🎯 === STARTING SKU-BASED PRODUCT MAPPING ===');
  console.log(`📊 Input data: ${unleashedProducts.length} Unleashed products, ${shopifyProducts.length} Shopify products`);

  try {
    // Step 1: Build comprehensive SKU maps for fast lookup
    console.log('\n📋 Step 1: Building SKU maps...');
    
    // Map all Shopify products by their variant SKUs
    const shopifySkuMap = new Map(); // SKU -> { product, variant }
    const shopifyProductMap = new Map(); // product.id -> product
    
    shopifyProducts.forEach(product => {
      shopifyProductMap.set(product.id, product);
      (product.variants || []).forEach(variant => {
        if (variant.sku) {
          if (shopifySkuMap.has(variant.sku)) {
            console.warn(`⚠️ Duplicate SKU found in Shopify: ${variant.sku} in products ${shopifySkuMap.get(variant.sku).product.id} and ${product.id}`);
          }
          shopifySkuMap.set(variant.sku, { product, variant });
        }
      });
    });

    // Map all Unleashed products by SKU (duplicates already filtered out in grouping)
    const unleashedSkuMap = new Map(); // SKU -> unleashedProduct
    unleashedProducts.forEach(product => {
      if (product.ProductCode) {
        unleashedSkuMap.set(product.ProductCode, product);
      }
    });

    console.log(`✅ SKU maps built: ${shopifySkuMap.size} Shopify SKUs, ${unleashedSkuMap.size} Unleashed SKUs`);

    // Step 2: Group Unleashed products for multi-variant products
    console.log('\n📋 Step 2: Grouping Unleashed products...');
    const { groupsMap: productGroupsMap, stats: groupingStats } = groupUnleashedProducts(unleashedProducts);
    results.details = groupingStats;

    // Step 3: Process each product group
    console.log('\n📋 Step 3: Processing product groups...');
    
    for (const [groupKey, group] of productGroupsMap.entries()) {
      const mainProduct = group[0];
      const groupSkus = group.map(p => p.ProductCode);
      
      console.log(`\n🔍 Processing group: "${groupKey}" with SKUs: [${groupSkus.join(', ')}]`);
      
      // Find existing Shopify products that contain any of these SKUs
      const relatedShopifyProducts = new Set();
      groupSkus.forEach(sku => {
        const shopifyEntry = shopifySkuMap.get(sku);
        if (shopifyEntry) {
          relatedShopifyProducts.add(shopifyEntry.product);
        }
      });

      const relatedProducts = Array.from(relatedShopifyProducts);
      
      const logEntry = {
        groupKey,
        unleashed: {
          productCount: group.length,
          skus: groupSkus,
          title: getAttributeValue(mainProduct.AttributeSet, 'Product Title') || mainProduct.ProductDescription
        },
        shopify: {
          relatedProducts: relatedProducts.length,
          products: relatedProducts.map(p => ({
            id: p.id,
            title: p.title,
            handle: p.handle,
            skus: p.variants.map(v => v.sku)
          }))
        },
        decision: null,
        reasoning: []
      };

      try {
        // Build the Unleashed product data
        const unleashedProductData = buildUnleashedProductData(group, shopifyLocations, defaultWarehouseCode);
        
        if (relatedProducts.length === 0) {
          // No existing Shopify products found with these SKUs
          logEntry.decision = 'CREATE';
          logEntry.reasoning.push('No existing Shopify products found with matching SKUs');
          
          console.log(`   🆕 CREATE: No existing products found for SKUs [${groupSkus.join(', ')}]`);
          results.toCreate.push(unleashedProductData);
          
        } else if (relatedProducts.length === 1) {
          // Found exactly one related product - this is the ideal case
          const shopifyProduct = relatedProducts[0];
          
          // Check if ALL group SKUs are in this ONE product (perfect match)
          const shopifySkus = new Set(shopifyProduct.variants.map(v => v.sku));
          const allSkusInProduct = groupSkus.every(sku => shopifySkus.has(sku));
          const extraSkusInProduct = Array.from(shopifySkus).filter(sku => !groupSkus.includes(sku));
          
          if (allSkusInProduct && extraSkusInProduct.length === 0) {
            // Perfect SKU match - compare data to decide update vs skip
            const comparison = compareProductData(unleashedProductData, shopifyProduct);
            
            if (comparison.hasChanges) {
              logEntry.decision = 'UPDATE';
              logEntry.reasoning.push('Perfect SKU match found');
              logEntry.reasoning.push(`Changes detected: ${comparison.differences.join(', ')}`);
              
              console.log(`   🔄 UPDATE: Perfect SKU match, changes detected`);
              console.log(`      Changes: ${comparison.differences.join(', ')}`);
              
              unleashedProductData.id = shopifyProduct.id;
              results.toUpdate.push(unleashedProductData);
              
            } else {
              logEntry.decision = 'SKIP';
              logEntry.reasoning.push('Perfect SKU match found');
              logEntry.reasoning.push('No changes detected - data is identical');
              
              console.log(`   ✅ SKIP: Perfect SKU match, no changes needed`);
              results.skipped.push({
                title: shopifyProduct.title,
                id: shopifyProduct.id,
                skus: groupSkus,
                reason: 'identical_data',
                needsPostSync: comparison.needsPostSync
              });
            }
            
          } else {
            // Partial SKU match - complex scenario
            if (!allSkusInProduct) {
              logEntry.decision = 'CREATE';
              logEntry.reasoning.push('Partial SKU match - some SKUs missing from existing product');
              logEntry.reasoning.push(`Missing SKUs: ${groupSkus.filter(sku => !shopifySkus.has(sku)).join(', ')}`);
              
              console.log(`   🆕 CREATE: Partial SKU match - some SKUs not in existing product`);
              console.log(`      Missing SKUs: ${groupSkus.filter(sku => !shopifySkus.has(sku)).join(', ')}`);
              results.toCreate.push(unleashedProductData);
              
            } else {
              // All our SKUs are in the product, but product has extra SKUs
              logEntry.decision = 'UPDATE';
              logEntry.reasoning.push('All group SKUs found in existing product');
              logEntry.reasoning.push(`Product has extra SKUs that will be removed: ${extraSkusInProduct.join(', ')}`);
              
              console.log(`   🔄 UPDATE: All SKUs found but product has extras`);
              console.log(`      Extra SKUs to remove: ${extraSkusInProduct.join(', ')}`);
              
              unleashedProductData.id = shopifyProduct.id;
              unleashedProductData.variantsToRemove = shopifyProduct.variants
                .filter(v => extraSkusInProduct.includes(v.sku))
                .map(v => v.id);
              
              results.toUpdate.push(unleashedProductData);
            }
          }
          
        } else {
          // Multiple related products - complex scenario
          logEntry.decision = 'ERROR';
          logEntry.reasoning.push(`SKUs are spread across ${relatedProducts.length} different Shopify products`);
          logEntry.reasoning.push('Manual review required');
          
          console.log(`   ❌ ERROR: SKUs spread across ${relatedProducts.length} products - manual review needed`);
          relatedProducts.forEach((p, i) => {
            const matchingSku = groupSkus.filter(sku => p.variants.some(v => v.sku === sku));
            console.log(`      Product ${i + 1}: "${p.title}" (${p.id}) has SKUs: [${matchingSku.join(', ')}]`);
          });
          
          results.errors.push({
            groupKey,
            skus: groupSkus,
            error: `SKUs are spread across multiple Shopify products`,
            relatedProducts: relatedProducts.map(p => ({ id: p.id, title: p.title }))
          });
        }

        logEntry.unleashed.productData = unleashedProductData;
        results.mappingLog.push(logEntry);
        results.processed++;

      } catch (error) {
        console.error(`❌ Error processing group ${groupKey}:`, error);
        logEntry.decision = 'ERROR';
        logEntry.reasoning.push(`Processing error: ${error.message}`);
        results.mappingLog.push(logEntry);
        
        results.errors.push({
          groupKey,
          skus: groupSkus,
          error: error.message
                  });
                }
              }

    // Step 4: Find products to archive
    console.log('\n📋 Step 4: Finding products to archive...');
    const unleashedSkuSet = new Set(unleashedProducts.map(p => p.ProductCode));
    
    shopifyProducts.forEach(shopifyProduct => {
      if (shopifyProduct.status.includes('ARCHIVED')) return;
      
      const productSkus = shopifyProduct.variants.map(v => v.sku).filter(Boolean);
      const hasAnyUnleashedSku = productSkus.some(sku => unleashedSkuSet.has(sku));
      
      if (!hasAnyUnleashedSku && productSkus.length > 0) {
        console.log(`   🗄️ ARCHIVE: Product "${shopifyProduct.title}" - no SKUs found in Unleashed`);
        console.log(`      Product SKUs: [${productSkus.join(', ')}]`);
        
        results.toArchive.push({
          id: shopifyProduct.id,
          title: shopifyProduct.title,
          status: 'ARCHIVED'
        });
        
        results.mappingLog.push({
          groupKey: `ARCHIVE-${shopifyProduct.id}`,
          shopify: {
            product: {
              id: shopifyProduct.id,
              title: shopifyProduct.title,
              skus: productSkus
            }
          },
          decision: 'ARCHIVE',
          reasoning: ['No SKUs from this product found in current Unleashed dataset']
        });
      }
    });

    // Final summary with comprehensive logging
    console.log('\n🎯 === MAPPING SUMMARY ===');
    console.log(`✅ Total groups processed: ${results.processed}`);
    console.log(`🆕 Products to CREATE: ${results.toCreate.length}`);
    console.log(`🔄 Products to UPDATE: ${results.toUpdate.length}`);
    console.log(`🗄️ Products to ARCHIVE: ${results.toArchive.length}`);
    console.log(`⏭️ Products SKIPPED: ${results.skipped.length}`);
    console.log(`❌ ERRORS: ${results.errors.length}`);

    // Log the full mapping analysis in JSON format for debugging
    console.log('\n📊 === DETAILED MAPPING LOG (JSON) ===');
    console.log(JSON.stringify({
      summary: {
        totalGroups: results.processed,
        toCreate: results.toCreate.length,
        toUpdate: results.toUpdate.length,
        toArchive: results.toArchive.length,
        skipped: results.skipped.length,
        errors: results.errors.length
      },
      decisions: results.mappingLog
    }, null, 2));

  } catch (error) {
    console.error('❌ Error in product mapping:', error);
    results.errors.push({
      error: error.message
    });
  }

  return results;
}

// Helper function to build Unleashed product data
function buildUnleashedProductData(group, shopifyLocations, defaultWarehouseCode) {
  const mainProduct = group[0];

  // CRITICAL FIX: Deduplicate the group by SKU first to handle duplicate SKUs in Unleashed
  const uniqueProductsMap = new Map();
  group.forEach(product => {
    const sku = product.ProductCode;
    if (!uniqueProductsMap.has(sku)) {
      uniqueProductsMap.set(sku, product);
    } else {
      // If we have a duplicate SKU, merge the inventory data
      const existing = uniqueProductsMap.get(sku);
      
      // Merge stock data if both have stock
      if (product.StockOnHand && existing.StockOnHand) {
        const mergedStock = [...existing.StockOnHand];
        
        product.StockOnHand.forEach(newStock => {
          const existingStockIndex = mergedStock.findIndex(s => 
            (s.WarehouseCode || s.Warehouse?.WarehouseCode) === 
            (newStock.WarehouseCode || newStock.Warehouse?.WarehouseCode)
          );
          
          if (existingStockIndex >= 0) {
            // Add quantities together
            const currentQty = parseInt(
              mergedStock[existingStockIndex].QuantityAvailable ?? 
              mergedStock[existingStockIndex].QtyAvailable ?? 
              mergedStock[existingStockIndex].AvailableQty ??
              mergedStock[existingStockIndex].QuantityOnHand ?? 
              mergedStock[existingStockIndex].QtyOnHand ?? 0
            );
            const newQty = parseInt(
              newStock.QuantityAvailable ?? newStock.QtyAvailable ?? newStock.AvailableQty ??
              newStock.QuantityOnHand ?? newStock.QtyOnHand ?? 0
            );
            
            mergedStock[existingStockIndex].QuantityAvailable = currentQty + newQty;
              } else {
            mergedStock.push(newStock);
          }
        });
        
        existing.StockOnHand = mergedStock;
      } else if (product.StockOnHand && !existing.StockOnHand) {
        existing.StockOnHand = product.StockOnHand;
      }
      
      console.log(`🔄 Merged duplicate SKU "${sku}" inventory data`);
    }
  });

  const deduplicatedGroup = Array.from(uniqueProductsMap.values());
  const isMultiVariant = deduplicatedGroup.length > 1;

  console.log(`📦 Group processed: ${group.length} raw products → ${deduplicatedGroup.length} unique SKUs`);

  const productTitle = (
    getAttributeValue(mainProduct.AttributeSet, 'Product Title')
    || mainProduct.ProductDescription
    || mainProduct.ProductName
    || mainProduct.ProductCode
  ).toString().trim();

  const handle = slugify(productTitle);

  // Get option names from the first product with AttributeSet
  const productWithOptions = deduplicatedGroup.find(p => p.AttributeSet && getAttributeValue(p.AttributeSet, 'Option Names'));
  const optionNames = productWithOptions ? 
    parseOptionNames(getAttributeValue(productWithOptions.AttributeSet, 'Option Names')) :
    [];

  // Build variants from deduplicated group
  const variants = deduplicatedGroup.map(product => {
              const variantOptions = extractVariantOptions(product.AttributeSet);

    // Calculate inventory quantities
              const inventoryQuantities = [];
              if (product.StockOnHand && product.StockOnHand.length > 0) {
                console.log(`📦 Processing inventory for ${product.ProductCode}:`, product.StockOnHand);
                
                product.StockOnHand.forEach(stock => {
                  let warehouseCode = stock.WarehouseCode || stock.Warehouse?.WarehouseCode;
                  if (!warehouseCode || warehouseCode.trim() === '') {
                    warehouseCode = defaultWarehouseCode;
                    console.log(`  🏭 Using default warehouse code: ${warehouseCode}`);
          if (!warehouseCode) return;
                  }

                  let matchingLocation = shopifyLocations.find(loc => loc?.metafields?.["custom.warehouse_code"] === warehouseCode);
        if (!matchingLocation && shopifyLocations.length > 0) {
          matchingLocation = shopifyLocations[0];
          console.log(`  📍 No location matched warehouse ${warehouseCode}, using first location: ${matchingLocation.name}`);
        }

        if (matchingLocation) {
                  const qty = parseInt(
                    stock.QuantityAvailable ?? stock.QtyAvailable ?? stock.AvailableQty ??
                    stock.QuantityOnHand ?? stock.QtyOnHand ?? 0
                  );

                    console.log(`  ➕ Adding inventory: ${qty} units to location ${matchingLocation.name} (${matchingLocation.id})`);
                  inventoryQuantities.push({
                    locationId: matchingLocation.id,
                    name: "available",
                    quantity: isNaN(qty) ? 0 : qty
                  });
                } else {
                  console.log(`  ⚠️ No matching location found for warehouse: ${warehouseCode}`);
        }
      });
    } else {
      console.log(`📦 No stock data for ${product.ProductCode}`);
    }

    // Generate unique variant title to avoid "Default Title" conflicts
    let variantTitle;
    if (isMultiVariant) {
      variantTitle = generateVariantTitle(product.AttributeSet);
                  } else {
      // For single variants, use a more specific title than "Default Title"
      variantTitle = product.ProductCode; // Use SKU as variant title to ensure uniqueness
                  }

    return {
                  sku: product.ProductCode,
      title: variantTitle,
                  price: product.DefaultSellPrice,
                  compare_at_price: null,
                  weight: product.Weight || 0,
                  weight_unit: 'KILOGRAMS',
                  inventory_management: product.IsSellable ? 'shopify' : null,
                  inventoryItem: {
                    tracked: product.IsSellable,
                    measurement: {
                      weight: {
                        value: parseFloat(product.Weight) || 0,
                        unit: 'KILOGRAMS'
                      }
                    }
                  },
                  inventoryQuantities: inventoryQuantities,
      inventory_levels: inventoryQuantities,
                  option1: variantOptions.option1,
                  option2: variantOptions.option2,
                  option3: variantOptions.option3,
                  metafields: Array.from({ length: 10 }, (_, i) => {
                    const rawVal = product[`SellPriceTier${i + 1}`]?.Value;
                    const num = rawVal === undefined || rawVal === null ? NaN : parseFloat(rawVal);
                    if (isNaN(num) || num === 0) return null;
                    return {
                      namespace: 'custom',
                      key: `price_tier_${i + 1}`,
                      value: String(num),
                      type: 'money'
                    };
                  }).filter(Boolean)
    };
  });

  return {
    handle,
    title: productTitle,
    description: mainProduct.ProductDescription,
    product_type: mainProduct.ProductGroup?.GroupName || '',
    vendor: mainProduct.ProductBrand?.BrandName || 'Default',
    status: mainProduct.Obsolete ? 'ARCHIVED' : 'ACTIVE',
    tags: [
      mainProduct.ProductSubGroup?.GroupName,
      mainProduct.ProductGroup?.GroupName
    ].filter(Boolean),
    options: isMultiVariant ? 
      optionNames.map(name => ({ name })) :
      [{ name: 'Title' }],
    variants: variants,
    images: buildProductImages(deduplicatedGroup)
  };
}

// Helper function to build product images
function buildProductImages(group) {
  const allImages = [];
  
  // Note: group should already be deduplicated by SKU
  group.forEach(product => {
    // 1. Unleashed Images array (preferred)
    if (product.Images && product.Images.length > 0) {
      const primary = product.Images.find(img => img.IsDefault) || product.Images[0];
      if (primary && primary.Url) {
        allImages.push({
          src: primary.Url,
          alt: `Image for ${product.ProductCode}`,
          variantSkus: [product.ProductCode]
        });
      }
    }

    // 2. Fallback to ImageUrl field
    if (product.ImageUrl) {
      allImages.push({
        src: product.ImageUrl,
        alt: `Image for ${product.ProductCode}`,
        variantSkus: [product.ProductCode]
      });
    }

    // 3. Legacy Attachments array
    if (product.Attachments && product.Attachments.length > 0) {
      const primaryAtt = product.Attachments[0];
      allImages.push({
        src: primaryAtt.DownloadUrl || primaryAtt.Url,
        alt: primaryAtt.Description || `Image for ${product.ProductCode}`,
        variantSkus: [product.ProductCode]
      });
    }
  });

  // Deduplicate by canonical key
  const baseKey = (url) => {
    if (!url) return '';
    try {
      const u = new URL(url);
      return u.pathname.split('/').pop().split('?')[0].toLowerCase();
    } catch {
      return url.split('/').pop().split('?')[0].toLowerCase();
    }
  };

  const mapByKey = new Map();
  allImages.forEach(img => {
    const key = baseKey(img.src);
    if (!mapByKey.has(key)) {
      mapByKey.set(key, { ...img, variantSkus: new Set(img.variantSkus || []) });
    } else {
      const existing = mapByKey.get(key);
      (img.variantSkus || []).forEach(sku => existing.variantSkus.add(sku));
    }
  });

  return Array.from(mapByKey.values()).map(img => ({
    src: img.src,
    alt: img.alt,
    variantSkus: Array.from(img.variantSkus)
  }));
}

export {
  mapProducts,
  generateVariantTitle,
  groupUnleashedProducts,
  parseOptionNames,
  extractVariantOptions,
  extractProductOptions
};
