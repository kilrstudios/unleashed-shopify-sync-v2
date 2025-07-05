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

function extractVariantOptions(attributeSet, fallbackValue) {
  if (!attributeSet) return { option1: fallbackValue || 'Default Title' };
  
  const opt1 = getAttributeValue(attributeSet, 'Option 1 Value');
  const opt2 = getAttributeValue(attributeSet, 'Option 2 Value');
  const opt3 = getAttributeValue(attributeSet, 'Option 3 Value');

  // If *no* option values are present, fall back to a unique identifier (SKU)
  if (!opt1 && !opt2 && !opt3 && fallbackValue) {
    return { option1: fallbackValue };
  }

  return { option1: opt1, option2: opt2, option3: opt3 };
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
  const filterReasons = {
    isComponent: 0,
    notSellable: 0,
    both: 0
  };
  
  console.log(`Processing ${products.length} Unleashed products...`);
  
  for (const product of products) {
    // Skip products that shouldn't be synced
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

    const groupKey = product.AttributeSet ? 
      getAttributeValue(product.AttributeSet, 'Product Title') || product.ProductDescription : 
      product.ProductDescription;
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
  console.log(`- Filtered out: ${filteredCount}`);
  console.log(`  - Components: ${filterReasons.isComponent}`);
  console.log(`  - Not sellable: ${filterReasons.notSellable}`);
  console.log(`  - Both: ${filterReasons.both}`);
  console.log(`- Remaining for sync: ${products.length - filteredCount}`);
  console.log(`- Product groups created: ${groups.size}`);

  return Array.from(groups.values());
}

// defaultWarehouseCode: string | null – the tenant-wide default warehouse code
async function mapProducts(unleashedProducts, shopifyProducts, shopifyLocations = [], defaultWarehouseCode = null) {
  const results = {
    toCreate: [],
    toUpdate: [],
    toArchive: [],
    skipped: [],
    processed: 0,
    errors: []
  };

  try {
    // Group Unleashed products by AttributeSet.ProductTitle
    const productGroups = groupUnleashedProducts(unleashedProducts);

    // Process each group (or single product)
    for (const [groupKey, group] of productGroups.entries()) {
      try {
        const mainProduct = group[0];
        const isMultiVariant = group.length > 1;

        // Determine product title: prefer explicit "Product Title" attribute, otherwise fall back
        // to Unleashed ProductDescription, then ProductName, then finally the SKU / code.
        const productTitle = (
          getAttributeValue(mainProduct.AttributeSet, 'Product Title')
          || mainProduct.ProductDescription
          || mainProduct.ProductName
          || mainProduct.ProductCode
        ).toString().trim();

        // Generate handle based on grouping strategy
        const handle = slugify(productTitle);

        // Debug: Log handle generation and matching attempt
        console.log(`\n🔍 Processing "${productTitle}"`);
        console.log(`   📝 Generated handle: "${handle}"`);
        console.log(`   📊 Is multi-variant: ${isMultiVariant} (${group.length} products in group)`);
        console.log(`   🎯 Searching for existing Shopify product with handle: "${handle}"`);

        // Find matching Shopify product
        const matchingProduct = shopifyProducts.find(sp => sp.handle === handle);
        
        if (matchingProduct) {
          console.log(`   ✅ MATCH FOUND: "${matchingProduct.title}" (ID: ${matchingProduct.id})`);
          console.log(`   🔍 Will verify SKU connection...`);
        } else {
          console.log(`   ❌ NO MATCH: Handle "${handle}" not found in existing Shopify products`);
          console.log(`   🆕 Will CREATE new product`);
        }

        // Get option names from the first product with AttributeSet
        const productWithOptions = group.find(p => p.AttributeSet && getAttributeValue(p.AttributeSet, 'Option Names'));
        let optionNames = productWithOptions ? 
          parseOptionNames(getAttributeValue(productWithOptions.AttributeSet, 'Option Names')) :
          [];

        // If the group is multi-variant but Unleashed has not defined option names, we
        // fall back to a single option "SKU" so each variant can be distinguished.
        if (isMultiVariant && optionNames.length === 0) {
          optionNames = ['SKU'];
        }

        // Prepare product data
        const productData = {
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
          images: (() => {
            const temp = group.reduce((allImages, product) => {
              // 1. Unleashed Images array (preferred)
              if (product.Images && product.Images.length > 0) {
                // Prefer the image marked as IsDefault=true, fallback to the first image in the array.
                const primary = product.Images.find(img => img.IsDefault) || product.Images[0];
                if (primary && primary.Url) {
                  allImages.push({
                    src: primary.Url,
                    alt: `Image for ${product.ProductCode}`,
                    variantSkus: [product.ProductCode]
                  });
                }
              }

              // 2. Fallback to ImageUrl field on the product
              if (product.ImageUrl) {
                allImages.push({
                  src: product.ImageUrl,
                  alt: `Image for ${product.ProductCode}`,
                  variantSkus: [product.ProductCode]
                });
              }

              // 3. Legacy Attachments array (if ever used)
              if (product.Attachments && product.Attachments.length > 0) {
                const primaryAtt = product.Attachments[0];
                allImages.push({
                  src: primaryAtt.DownloadUrl || primaryAtt.Url,
                  alt: primaryAtt.Description || `Image for ${product.ProductCode}`,
                  variantSkus: [product.ProductCode]
                });
              }

              return allImages;
            }, []);

            // Deduplicate by canonical key, merging variantSkus sets
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
            temp.forEach(img => {
              const key = baseKey(img.src);
              if (!mapByKey.has(key)) {
                mapByKey.set(key, { ...img, variantSkus: new Set(img.variantSkus || []) });
              } else {
                const existing = mapByKey.get(key);
                (img.variantSkus || []).forEach(sku => existing.variantSkus.add(sku));
              }
            });

            // Convert Sets back to arrays for output
            const finalImgs = Array.from(mapByKey.values()).map(img => ({
              src: img.src,
              alt: img.alt,
              variantSkus: Array.from(img.variantSkus)
            }));

            // DEBUG: list deduplicated image filenames for this product group
            if (finalImgs.length) {
              console.log(`\n🖼️ UNLEASHED IMAGES for group "${productTitle}" (${handle}):`);
              finalImgs.forEach(i => {
                const fn = (i.src || '').split('/').pop().split('?')[0];
                console.log(`   - ${fn} → variants ${i.variantSkus.join(', ')}`);
              });
            }

            return finalImgs;
          })(),
          options: isMultiVariant ? 
            optionNames.map(name => ({ name })) :
            [{ name: 'Title' }],
          variants: (() => {
            const variantsMap = new Map();

            group.forEach(product => {
              const variantOptions = extractVariantOptions(product.AttributeSet, product.ProductCode);

              // Build a composite key from option values (undefined treated as '')
              const vKey = [variantOptions.option1 || '', variantOptions.option2 || '', variantOptions.option3 || ''].join('|');

              // Calculate inventory quantities for this product row
              const inventoryQuantities = [];
              if (product.StockOnHand && product.StockOnHand.length > 0) {
                product.StockOnHand.forEach(stock => {
                  let warehouseCode = stock.WarehouseCode || stock.Warehouse?.WarehouseCode;
                  if (!warehouseCode || warehouseCode.trim() === '') {
                    warehouseCode = defaultWarehouseCode;
                    if (!warehouseCode) return; // skip if still unknown
                  }

                  let matchingLocation = shopifyLocations.find(loc => loc?.metafields?.["custom.warehouse_code"] === warehouseCode);
                  if (!matchingLocation && shopifyLocations.length > 0) matchingLocation = shopifyLocations[0];

                  const qty = parseInt(
                    stock.QuantityAvailable ?? stock.QtyAvailable ?? stock.AvailableQty ??
                    stock.QuantityOnHand ?? stock.QtyOnHand ?? 0
                  );

                  inventoryQuantities.push({
                    locationId: matchingLocation.id,
                    name: "available",
                    quantity: isNaN(qty) ? 0 : qty
                  });
                });
              }

              if (variantsMap.has(vKey)) {
                // Merge inventories into existing variant entry
                const existing = variantsMap.get(vKey);
                inventoryQuantities.forEach(newRow => {
                  const match = existing.inventoryQuantities.find(r => r.locationId === newRow.locationId);
                  if (match) {
                    match.quantity += newRow.quantity; // accumulate
                  } else {
                    existing.inventoryQuantities.push({ ...newRow });
                  }
                });
              } else {
                variantsMap.set(vKey, {
                  sku: product.ProductCode,
                  title: isMultiVariant ? generateVariantTitle(product.AttributeSet) : 'Default Title',
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
                  inventory_levels: inventoryQuantities, // alias
                  option1: variantOptions.option1 || product.ProductCode,
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
                });
              }
            });

            return Array.from(variantsMap.values());
          })()
        };

        if (matchingProduct) {
          // Verify SKU connection
          console.log(`   📦 Existing Shopify product variants:`);
          matchingProduct.variants.forEach((v, i) => {
            console.log(`      ${i + 1}. SKU: "${v.sku}", Title: "${v.title}"`);
          });
          console.log(`   📦 Unleashed products in group:`);
          group.forEach((p, i) => {
            console.log(`      ${i + 1}. ProductCode: "${p.ProductCode}", Description: "${p.ProductDescription}"`);
          });

          // Check if all SKUs match
          const shopifySkus = new Set(matchingProduct.variants.map(v => v.sku));
          const unleashedSkus = new Set(group.map(p => p.ProductCode));
          const skusMatch = [...shopifySkus].every(sku => unleashedSkus.has(sku)) &&
                          [...unleashedSkus].every(sku => shopifySkus.has(sku));

          if (skusMatch) {
            console.log(`   🔗 SKU verification: MATCH`);
            
            // Compare data to check if update is needed
            const differences = compareProductData(productData, matchingProduct);
            if (differences.hasChanges) {
              console.log(`   🔄 Changes detected - will UPDATE product:`);
              differences.differences.forEach(diff => console.log(`      - ${diff}`));
            productData.id = matchingProduct.id;
            results.toUpdate.push(productData);
            } else {
              console.log(`   ✅ Product is IDENTICAL to existing Shopify product`);
              if (differences.needsPostSync.inventory || differences.needsPostSync.images) {
                console.log(`   🔄 Post-sync operations needed:`);
                if (differences.needsPostSync.inventory) console.log(`      - Inventory updates`);
                if (differences.needsPostSync.images) console.log(`      - Image updates`);
                productData.id = matchingProduct.id;
                productData.needsPostSync = differences.needsPostSync;
                results.skipped.push({
                  title: matchingProduct.title,
                  id: matchingProduct.id,
                  variantCount: matchingProduct.variants.length,
                  reason: 'identical_data',
                  needsPostSync: differences.needsPostSync
                });
              } else {
                console.log(`   📊 No changes or post-sync operations needed - SKIPPING`);
              results.skipped.push({
                  title: matchingProduct.title,
                id: matchingProduct.id,
                  variantCount: matchingProduct.variants.length,
                  reason: 'identical_data',
                  needsPostSync: { inventory: false, images: false }
              });
              }
            }
          } else {
            console.log(`   ❌ SKU verification FAILED - will CREATE new product with modified handle`);
            productData.handle = `${handle}-${Date.now()}`;
            results.toCreate.push(productData);
          }
        } else {
          // Create new product
          console.log(`   🆕 Will CREATE new product (no handle match)`);
          results.toCreate.push(productData);
        }

        results.processed++;
      } catch (error) {
        console.error(`Error processing group ${groupKey}:`, error);
        results.errors.push({
          productCode: group[0].ProductCode,
          error: error.message
        });
      }
    }

    // Find Shopify products to archive
    const unleashedHandles = new Set(Array.from(productGroups.entries()).map(([_, group]) => {
      const mainProduct = group[0];
      const productTitle = group.length > 1 
        ? getAttributeValue(mainProduct.AttributeSet, 'Product Title')
        : mainProduct.ProductDescription;
      return slugify(productTitle);
    }));
    
    const productsToArchive = shopifyProducts
      .filter(sp => !sp.status.includes('ARCHIVED') && !unleashedHandles.has(sp.handle))
      .map(sp => ({
        id: sp.id,
        status: 'ARCHIVED'
      }));

    results.toArchive.push(...productsToArchive);

    // Debug: Final mapping summary
    console.log(`\n🎯 === PRODUCT MAPPING SUMMARY ===`);
    console.log(`📊 Total processed: ${results.processed}`);
    console.log(`🆕 Products to CREATE: ${results.toCreate.length}`);
    if (results.toCreate.length > 0) {
      console.log(`   CREATE list:`);
      results.toCreate.forEach((p, i) => {
        console.log(`      ${i + 1}. "${p.title}" (handle: "${p.handle}") - ${p.variants.length} variants`);
      });
    }
    console.log(`🔄 Products to UPDATE: ${results.toUpdate.length}`);
    if (results.toUpdate.length > 0) {
      console.log(`   UPDATE list:`);
      results.toUpdate.forEach((p, i) => {
        console.log(`      ${i + 1}. "${p.title}" (ID: ${p.id}) - ${p.variants.length} variants`);
      });
    }
    console.log(`⏭️ Products SKIPPED (identical): ${results.skipped.length}`);
    if (results.skipped.length > 0) {
      console.log(`   SKIPPED list:`);
      results.skipped.forEach((p, i) => {
        console.log(`      ${i + 1}. "${p.title}" (ID: ${p.id}) - ${p.variantCount} variants - ${p.reason}`);
      });
    }
    console.log(`🗂️ Products to ARCHIVE: ${results.toArchive.length}`);
    console.log(`❌ Errors: ${results.errors.length}`);

    return results;
  } catch (error) {
    console.error('Error in mapProducts:', error);
    throw error;
  }
}

export {
  mapProducts,
  generateVariantTitle,
  groupUnleashedProducts,
  parseOptionNames,
  extractVariantOptions,
  extractProductOptions
}; 