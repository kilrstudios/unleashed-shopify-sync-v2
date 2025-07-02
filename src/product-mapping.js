import { slugify } from './helpers.js';

function parseOptionNames(optionNamesString) {
  if (!optionNamesString) return [];
  // Split by comma or pipe and clean up whitespace
  return optionNamesString.split(/[,|]/).map(name => name.trim()).filter(Boolean);
}

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

// Compare product data to determine if update is needed
function compareProductData(unleashedProductData, shopifyProduct) {
  const differences = [];
  
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
  }
  
  // Check for removed variants in Shopify that don't exist in Unleashed
  for (const [sku, shopifyVariant] of shopifyVariants) {
    if (!unleashedVariants.has(sku)) {
      differences.push(`variant: Shopify variant "${sku}" no longer exists in Unleashed`);
    }
  }
  
  return {
    hasChanges: differences.length > 0,
    differences: differences
  };
}

function extractVariantOptions(attributeSet) {
  if (!attributeSet) return { option1: null, option2: null, option3: null };
  
  return {
    option1: attributeSet['Option 1 Value'] || null,
    option2: attributeSet['Option 2 Value'] || null,
    option3: attributeSet['Option 3 Value'] || null
  };
}

function extractProductOptions(attributeSet) {
  if (!attributeSet || !attributeSet['Option Names']) {
    return [{ name: 'Title' }];
  }
  
  const optionNames = parseOptionNames(attributeSet['Option Names']);
  if (!optionNames.length) {
    return [{ name: 'Title' }];
  }
  
  return optionNames.slice(0, 3).map(name => ({ name }));
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
      console.log(`   ProductTitle: "${product.AttributeSet.ProductTitle}"`);
      console.log(`   Option 1 Value: "${product.AttributeSet['Option 1 Value']}"`);
      console.log(`   Option 2 Value: "${product.AttributeSet['Option 2 Value']}"`);
      console.log(`   Option 3 Value: "${product.AttributeSet['Option 3 Value']}"`);
      console.log(`   Option Names: "${product.AttributeSet['Option Names']}"`);
    } else {
      console.log(`   No AttributeSet - will use ProductDescription as groupKey`);
    }

    const groupKey = product.AttributeSet?.ProductTitle || product.ProductDescription;
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

async function mapProducts(unleashedProducts, shopifyProducts) {
  const results = {
    toCreate: [],
    toUpdate: [],
    toArchive: [],
    skipped: [],
    processed: 0,
    errors: []
  };

  // Debug: Log Shopify products for matching analysis
  console.log(`\n🔍 === PRODUCT MATCHING DEBUG ===`);
  console.log(`📊 Available Shopify products for matching: ${shopifyProducts.length}`);
  if (shopifyProducts.length > 0) {
    console.log(`📋 Existing Shopify product handles:`);
    shopifyProducts.forEach((sp, i) => {
      console.log(`   ${i + 1}. "${sp.title}" (handle: "${sp.handle}") - ${sp.variants?.length || 0} variants`);
    });
  } else {
    console.log(`📋 No existing Shopify products found - all will be created`);
  }

  try {
    // Group Unleashed products by AttributeSet.ProductTitle
    const productGroups = groupUnleashedProducts(unleashedProducts);

    // Process each group (or single product)
    for (const group of productGroups) {
      try {
        const mainProduct = group[0];
        const isMultiVariant = group.length > 1;

        // Generate handle based on grouping strategy
        const productTitle = isMultiVariant 
          ? mainProduct.AttributeSet.ProductTitle 
          : mainProduct.ProductDescription;
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

        // Prepare variant options using the new AttributeSet structure
        const variantOptions = extractVariantOptions(mainProduct.AttributeSet);
        const productOptions = extractProductOptions(mainProduct.AttributeSet);

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
          images: [{
            src: mainProduct.ImageUrl || (mainProduct.Images && mainProduct.Images[0]?.Url)
          }].filter(img => img.src),
          variants: group.map(product => {
            const productVariantOptions = extractVariantOptions(product.AttributeSet);
            return {
              sku: product.ProductCode,
              title: isMultiVariant 
                ? generateVariantTitle(product.AttributeSet)
                : 'Default Title',
              price: product.DefaultSellPrice,
              compare_at_price: null,
              weight: product.Weight || 0,
              weight_unit: 'g',
              inventory_management: (!product.NeverDiminishing && product.IsSellable) ? 'shopify' : null,
              inventory_policy: 'deny',
              option1: productVariantOptions.option1,
              option2: productVariantOptions.option2,
              option3: productVariantOptions.option3,
              metafields: Array.from({ length: 10 }, (_, i) => ({
                namespace: 'custom',
                key: `price_tier_${i + 1}`,
                value: product[`SellPriceTier${i + 1}`]?.Value || ''
              }))
            };
          }),
          options: productOptions
        };

        if (matchingProduct) {
          // Debug: Log existing product SKUs
          console.log(`   📦 Existing Shopify product variants:`);
          matchingProduct.variants.forEach((v, i) => {
            console.log(`      ${i + 1}. SKU: "${v.sku}", Title: "${v.title}"`);
          });
          
          console.log(`   📦 Unleashed products in group:`);
          group.forEach((p, i) => {
            console.log(`      ${i + 1}. ProductCode: "${p.ProductCode}", Description: "${p.ProductDescription}"`);
          });

          // Verify SKU connection
          const skusMatch = isMultiVariant
            ? group.some(p => matchingProduct.variants.some(v => v.sku === p.ProductCode))
            : matchingProduct.variants[0]?.sku === mainProduct.ProductCode;

          console.log(`   🔗 SKU verification: ${skusMatch ? 'MATCH' : 'NO MATCH'}`);

          if (skusMatch) {
            // Check if product data has actually changed
            const comparison = compareProductData(productData, matchingProduct);
            
            if (comparison.hasChanges) {
              // Update existing product (has changes)
              console.log(`   🔄 Will UPDATE existing product (changes detected):`);
              comparison.differences.forEach(diff => {
                console.log(`      📝 ${diff}`);
              });
              
              productData.id = matchingProduct.id;
              productData.variants = productData.variants.map(v => {
                const matchingVariant = matchingProduct.variants.find(mv => mv.sku === v.sku);
                if (matchingVariant) {
                  console.log(`      🔗 Variant SKU "${v.sku}" matched to existing variant ID: ${matchingVariant.id}`);
                  v.id = matchingVariant.id;
                }
                return v;
              });
              results.toUpdate.push(productData);
            } else {
              // Product is identical - skip update
              console.log(`   ✅ Product is IDENTICAL to existing Shopify product - SKIPPING update`);
              console.log(`   📊 No changes detected between Unleashed and Shopify data`);
              results.skipped.push({
                title: productData.title,
                handle: productData.handle,
                id: matchingProduct.id,
                variantCount: productData.variants.length,
                reason: 'identical_data'
              });
            }
          } else {
            // Create new product with modified handle
            console.log(`   🆕 Will CREATE new product with modified handle (handle match but SKU mismatch)`);
            productData.handle = `${handle}-${mainProduct.ProductCode}`;
            results.toCreate.push(productData);
          }
        } else {
          // Create new product
          console.log(`   🆕 Will CREATE new product (no handle match)`);
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

    // Find Shopify products to archive (products in Shopify but not in Unleashed)
    const unleashedHandles = new Set(productGroups.map(group => 
      slugify(group[0].AttributeSet?.ProductTitle || group[0].ProductDescription)
    ));
    
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

  } catch (error) {
    throw new Error(`Product mapping failed: ${error.message}`);
  }

  return results;
}

export {
  mapProducts,
  generateVariantTitle,
  groupUnleashedProducts,
  parseOptionNames,
  extractVariantOptions,
  extractProductOptions
}; 