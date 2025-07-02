import { getProductById } from './product-mutations';

async function updateProductInventory(shopifyClient, inventoryItemId, locationId, quantity) {
  try {
    // First get current inventory level
    const query = `
      query getInventoryLevel($inventoryItemId: ID!, $locationId: ID!) {
        inventoryLevel(inventoryItemId: $inventoryItemId, locationId: $locationId) {
          id
          available
        }
      }
    `;

    const levelResponse = await shopifyClient.request(query, {
      inventoryItemId,
      locationId
    });

    const currentLevel = levelResponse.inventoryLevel?.available || 0;
    const delta = quantity - currentLevel;

    if (delta === 0) {
      console.log('No inventory adjustment needed - current level matches desired quantity');
      return { success: true, noChangeNeeded: true };
    }

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
        inventoryItemId,
        locationId,
        availableDelta: delta
      }
    };

    console.log(`Adjusting inventory by ${delta} units (current: ${currentLevel}, target: ${quantity})`);
    const response = await shopifyClient.request(mutation, variables);
    return response.inventoryAdjustQuantity;
  } catch (error) {
    console.error('Error updating inventory:', error);
    throw error;
  }
}

async function updateProductImage(shopifyClient, productId, imageUrl, altText) {
  try {
    // First check if image already exists
    const query = `
      query getProductImages($productId: ID!) {
        product(id: $productId) {
          images(first: 50) {
            edges {
              node {
                id
                url
                altText
              }
            }
          }
        }
      }
    `;

    const imagesResponse = await shopifyClient.request(query, { productId });
    const existingImages = imagesResponse.product.images.edges;
    
    // Check if image with same URL already exists
    const existingImage = existingImages.find(edge => edge.node.url === imageUrl);
    if (existingImage) {
      console.log('Image already exists, skipping upload');
      return { success: true, imageExists: true, image: existingImage.node };
    }

    const mutation = `
      mutation productImageCreate($input: ProductImageInput!) {
        productImageCreate(input: $input) {
          image {
            id
            url
            altText
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
        productId,
        src: imageUrl,
        altText: altText || ''
      }
    };

    console.log(`Creating new product image: ${imageUrl}`);
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
          const warehouseCode = location.metafields?.edges?.find(edge => 
            (edge.node.namespace === 'custom' || edge.node.namespace === 'unleashed') && 
            edge.node.key === 'warehouse_code'
          )?.node?.value;

          if (!warehouseCode) {
            console.log(`⚠️ No warehouse code found for location ${location.name} - skipping`);
            continue;
          }

          // Find stock on hand for this warehouse
          const warehouseStock = unleashedProduct.StockOnHand?.find(s => 
            s.WarehouseCode === warehouseCode
          );

          if (!warehouseStock) {
            console.log(`⚠️ No stock data found for warehouse ${warehouseCode} - skipping`);
            continue;
          }

          console.log(`📊 Updating inventory for location ${location.name} (${warehouseCode}): ${warehouseStock.QuantityAvailable} units`);
          
          const response = await updateProductInventory(
            shopifyClient,
            variant.inventoryItemId,
            location.id,
            warehouseStock.QuantityAvailable
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
              quantity: warehouseStock.QuantityAvailable
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
      if (unleashedProduct.Attachments && unleashedProduct.Attachments.length > 0) {
        console.log(`\n🖼️ Updating images for product ${unleashedProduct.ProductCode}...`);
        
        try {
          // Get all image URLs
          const imageUrls = unleashedProduct.Attachments
            .filter(a => a.FileName.match(/\.(jpg|jpeg|png|gif)$/i))
            .map(a => ({
              src: a.DownloadUrl,
              altText: a.Description || `Image for ${unleashedProduct.ProductCode}`
            }));

          for (const imageData of imageUrls) {
            const response = await updateProductImage(
              shopifyClient,
              shopifyProduct.id,
              imageData.src,
              imageData.altText
            );

            if (response.userErrors?.length > 0) {
              console.error(`❌ Failed to update image:`, response.userErrors);
              results.images.failed.push({
                productCode: unleashedProduct.ProductCode,
                imageUrl: imageData.src,
                errors: response.userErrors
              });
            } else {
              console.log(`✅ Successfully updated image`);
              results.images.successful.push({
                productCode: unleashedProduct.ProductCode,
                imageUrl: imageData.src,
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
    console.log(`✅ Inventory updates: ${results.inventory.successful.length} successful, ${results.inventory.failed.length} failed`);
    console.log(`✅ Image updates: ${results.images.successful.length} successful, ${results.images.failed.length} failed`);

    return results;
  } catch (error) {
    console.error('Error in handlePostSyncOperations:', error);
    throw error;
  }
}

async function handleInventoryUpdate(request, env) {
  try {
    const body = await request.json();
    const { originalDomain, shopDomain, productId, variants } = body;

    console.log(`📦 Handling inventory update for product ${productId}`);

    // Get auth data using original domain
    const authData = await getAuthData(env, originalDomain);
    const { accessToken } = authData.shopify;
    
    // Use shopify domain for API calls
    const baseUrl = `https://${shopDomain}/admin/api/2025-04`;
    const headers = {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': accessToken
    };

    // Process inventory updates
    const results = { successful: [], failed: [] };
    
    for (const variant of variants) {
      try {
        // First get the inventory item ID
        const query = `
          query getInventoryItemId($variantId: ID!) {
            productVariant(id: $variantId) {
              inventoryItem {
                id
              }
            }
          }
        `;

        const response = await fetch(`${baseUrl}/graphql.json`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            query,
            variables: {
              variantId: variant.id
            }
          })
        });

        const data = await response.json();
        
        if (data.errors || !data.data.productVariant?.inventoryItem?.id) {
          throw new Error(`Failed to get inventory item ID: ${JSON.stringify(data.errors || 'No inventory item found')}`);
        }

        const inventoryItemId = data.data.productVariant.inventoryItem.id;

        // Now update the inventory level
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

        const updateResponse = await fetch(`${baseUrl}/graphql.json`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            query: mutation,
            variables: {
              input: {
                inventoryLevelId: variant.inventoryLevelId,
                availableDelta: variant.quantityDelta
              }
            }
          })
        });

        const updateData = await updateResponse.json();
        
        if (updateData.errors || updateData.data.inventoryAdjustQuantity.userErrors.length > 0) {
          throw new Error(`Inventory update failed: ${JSON.stringify(updateData.errors || updateData.data.inventoryAdjustQuantity.userErrors)}`);
        }

        results.successful.push({
          variantId: variant.id,
          newQuantity: updateData.data.inventoryAdjustQuantity.inventoryLevel.available
        });

        console.log(`✅ Updated inventory for variant ${variant.id}`);

      } catch (error) {
        console.error(`❌ Failed to update inventory for variant ${variant.id}:`, error.message);
        results.failed.push({
          variantId: variant.id,
          error: error.message
        });
      }
    }

    return new Response(JSON.stringify({
      success: true,
      results,
      summary: `${results.successful.length} successful, ${results.failed.length} failed`
    }), { headers: { 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('❌ Inventory update handler failed:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

export {
  handlePostSyncOperations
}; 