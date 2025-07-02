import { getProductById } from './product-mutations';

async function updateProductInventory(shopifyClient, productId, locationId, quantity) {
  try {
    const mutation = `
      mutation inventoryAdjustQuantity($input: InventoryAdjustQuantityInput!) {
        inventoryAdjustQuantity(input: $input) {
          inventoryLevel {
            id
            available
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const variables = {
      input: {
        inventoryItemId: productId,
        locationId: locationId,
        availableDelta: quantity
      }
    };

    const response = await shopifyClient.request(mutation, variables);
    return response.inventoryAdjustQuantity;
  } catch (error) {
    console.error('Error updating inventory:', error);
    throw error;
  }
}

async function updateProductImage(shopifyClient, productId, imageUrl) {
  try {
    const mutation = `
      mutation productImageCreate($input: ProductImageInput!) {
        productImageCreate(input: $input) {
          image {
            id
            url
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const variables = {
      input: {
        productId: productId,
        src: imageUrl
      }
    };

    const response = await shopifyClient.request(mutation, variables);
    return response.productImageCreate;
  } catch (error) {
    console.error('Error updating product image:', error);
    throw error;
  }
}

async function handlePostSyncOperations(shopifyClient, unleashedProducts, shopifyProducts, locations) {
  const results = {
    inventory: {
      successful: [],
      failed: []
    },
    images: {
      successful: [],
      failed: []
    }
  };

  try {
    console.log(`\n📦 Starting post-sync operations...`);

    // Process each product
    for (const unleashedProduct of unleashedProducts) {
      const shopifyProduct = shopifyProducts.find(sp => 
        sp.variants.some(v => v.sku === unleashedProduct.ProductCode)
      );

      if (!shopifyProduct) {
        console.log(`⚠️ No matching Shopify product found for ${unleashedProduct.ProductCode} - skipping post-sync operations`);
        continue;
      }

      // Get the variant ID for inventory updates
      const variant = shopifyProduct.variants.find(v => v.sku === unleashedProduct.ProductCode);
      if (!variant) continue;

      // Update inventory for each location
      console.log(`\n🏢 Updating inventory for product ${unleashedProduct.ProductCode} across locations...`);
      for (const location of locations) {
        try {
          // Find warehouse code in location metafields
          const warehouseCode = location.metafields?.find(m => 
            m.namespace === 'unleashed' && m.key === 'warehouse_code'
          )?.value;

          if (!warehouseCode) {
            console.log(`⚠️ No warehouse code found for location ${location.name} - skipping`);
            continue;
          }

          // Find stock on hand for this warehouse
          const warehouseStock = unleashedProduct.Warehouses?.find(w => 
            w.WarehouseCode === warehouseCode
          );

          if (!warehouseStock) {
            console.log(`⚠️ No stock data found for warehouse ${warehouseCode} - skipping`);
            continue;
          }

          console.log(`📊 Updating inventory for location ${location.name} (${warehouseCode}): ${warehouseStock.QtyOnHand} units`);
          
          const response = await updateProductInventory(
            shopifyClient,
            variant.inventoryItemId,
            location.id,
            warehouseStock.QtyOnHand
          );

          if (response.userErrors?.length > 0) {
            console.error(`❌ Failed to update inventory:`, response.userErrors);
            results.inventory.failed.push({
              productCode: unleashedProduct.ProductCode,
              location: location.name,
              errors: response.userErrors
            });
          } else {
            console.log(`✅ Successfully updated inventory`);
            results.inventory.successful.push({
              productCode: unleashedProduct.ProductCode,
              location: location.name,
              quantity: warehouseStock.QtyOnHand
            });
          }
        } catch (error) {
          console.error(`❌ Error updating inventory for ${unleashedProduct.ProductCode} at ${location.name}:`, error);
          results.inventory.failed.push({
            productCode: unleashedProduct.ProductCode,
            location: location.name,
            error: error.message
          });
        }
      }

      // Update images
      if (unleashedProduct.ImageUrl || (unleashedProduct.Images && unleashedProduct.Images.length > 0)) {
        console.log(`\n🖼️ Updating images for product ${unleashedProduct.ProductCode}...`);
        
        try {
          // Get all image URLs
          const imageUrls = [
            unleashedProduct.ImageUrl,
            ...(unleashedProduct.Images || []).map(img => img.Url)
          ].filter(Boolean);

          for (const imageUrl of imageUrls) {
            const response = await updateProductImage(
              shopifyClient,
              shopifyProduct.id,
              imageUrl
            );

            if (response.userErrors?.length > 0) {
              console.error(`❌ Failed to update image:`, response.userErrors);
              results.images.failed.push({
                productCode: unleashedProduct.ProductCode,
                imageUrl,
                errors: response.userErrors
              });
            } else {
              console.log(`✅ Successfully updated image`);
              results.images.successful.push({
                productCode: unleashedProduct.ProductCode,
                imageUrl,
                imageId: response.image.id
              });
            }
          }
        } catch (error) {
          console.error(`❌ Error updating images for ${unleashedProduct.ProductCode}:`, error);
          results.images.failed.push({
            productCode: unleashedProduct.ProductCode,
            error: error.message
          });
        }
      }
    }

    // Log summary
    console.log(`\n📊 Post-sync operations summary:`);
    console.log(`Inventory updates: ${results.inventory.successful.length} successful, ${results.inventory.failed.length} failed`);
    console.log(`Image updates: ${results.images.successful.length} successful, ${results.images.failed.length} failed`);

    return results;
  } catch (error) {
    console.error('Error in post-sync operations:', error);
    throw error;
  }
}

export {
  handlePostSyncOperations
}; 