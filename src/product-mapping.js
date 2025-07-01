const { slugify } = require('./helpers');

function generateVariantTitle(options) {
  if (!options || !options.length) return 'Default Title';
  return options.map(opt => opt.value).join(' / ');
}

function groupUnleashedProducts(products) {
  const groups = new Map();
  
  for (const product of products) {
    // Skip products that shouldn't be synced
    if (product.IsComponent || !product.IsSellable) continue;

    const groupKey = product.AttributeSet?.ProductTitle || product.ProductDescription;
    if (!groups.has(groupKey)) {
      groups.set(groupKey, []);
    }
    groups.get(groupKey).push(product);
  }

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
          variants: group.map(product => ({
            sku: product.ProductCode,
            title: isMultiVariant 
              ? generateVariantTitle(product.AttributeSet?.Options)
              : 'Default Title',
            price: product.DefaultSellPrice,
            compare_at_price: null,
            weight: product.Weight || 0,
            weight_unit: 'g',
            inventory_management: (!product.NeverDiminishing && product.IsSellable) ? 'shopify' : null,
            inventory_policy: 'deny',
            option1: product.AttributeSet?.Options?.[0]?.value,
            option2: product.AttributeSet?.Options?.[1]?.value,
            option3: product.AttributeSet?.Options?.[2]?.value,
            metafields: Array.from({ length: 10 }, (_, i) => ({
              namespace: 'custom',
              key: `price_tier_${i + 1}`,
              value: product[`SellPriceTier${i + 1}`]?.Value || ''
            }))
          })),
          options: isMultiVariant ? 
            Array.from(new Set(group.flatMap(p => 
              p.AttributeSet?.Options?.map(o => o.name) || []
            ))).slice(0, 3).map(name => ({ name })) : 
            [{ name: 'Title' }]
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

module.exports = {
  mapProducts,
  generateVariantTitle,
  groupUnleashedProducts
}; 