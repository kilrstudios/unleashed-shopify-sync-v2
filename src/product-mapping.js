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

async function mapProducts(unleashedProducts, shopifyProducts) {
  const results = {
    toCreate: [],
    toUpdate: [],
    toArchive: [],
    processed: 0,
    errors: []
  };

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

        // Find matching Shopify product
        const matchingProduct = shopifyProducts.find(sp => sp.handle === handle);

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
          // Verify SKU connection
          const skusMatch = isMultiVariant
            ? group.some(p => matchingProduct.variants.some(v => v.sku === p.ProductCode))
            : matchingProduct.variants[0]?.sku === mainProduct.ProductCode;

          if (skusMatch) {
            // Update existing product
            productData.id = matchingProduct.id;
            productData.variants = productData.variants.map(v => {
              const matchingVariant = matchingProduct.variants.find(mv => mv.sku === v.sku);
              if (matchingVariant) v.id = matchingVariant.id;
              return v;
            });
            results.toUpdate.push(productData);
          } else {
            // Create new product with modified handle
            productData.handle = `${handle}-${mainProduct.ProductCode}`;
            results.toCreate.push(productData);
          }
        } else {
          // Create new product
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