import { getProductById } from './product-mutations';

async function updateProductInventory(shopifyClient, inventoryItemId, locationId, quantity) {
  try {
    // First get current inventory levels for this inventory item
    const query = `
      query getInventoryLevels($inventoryItemId: ID!) {
        inventoryItem(id: $inventoryItemId) {
          id
          inventoryLevels(first: 50) {
            edges {
              node {
                id
                available
                location {
                  id
                }
              }
            }
          }
        }
      }
    `;

    const levelResponse = await shopifyClient.request(query, {
      inventoryItemId
    });

    // Find the inventory level for the specific location
    const inventoryLevels = levelResponse.inventoryItem?.inventoryLevels?.edges || [];
    const locationLevel = inventoryLevels.find(edge => edge.node.location.id === locationId);
    
    const currentLevel = locationLevel?.node?.available || 0;
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

      // Update inventory for the main location only with total on-hand stock
      console.log(`\n🏢 Updating inventory for product ${unleashedProduct.ProductCode} at main location...`);
      
      // Find the main warehouse location (typically "Main Warehouse" or first location)
      const mainLocation = locations.find(loc => 
        loc.name.toLowerCase().includes('main') || 
        loc.name.toLowerCase().includes('warehouse')
      ) || locations[0]; // Fallback to first location
      
      if (!mainLocation) {
        console.log(`⚠️ No main location found - skipping inventory update`);
      } else {
        try {
          // Calculate total on-hand stock across all warehouses
          const totalOnHand = unleashedProduct.StockOnHand?.reduce((total, stock) => {
            const qty = parseInt(stock.QtyOnHand) || 0;
            console.log(`  📦 Warehouse ${stock.WarehouseCode || 'Unknown'}: ${qty} on hand`);
            return total + qty;
          }, 0) || 0;

          console.log(`📊 Updating inventory for location ${mainLocation.name}: ${totalOnHand} total units on hand`);
          
          const response = await updateProductInventory(
            shopifyClient,
            variant.inventoryItemId,
            mainLocation.id,
            totalOnHand
          );

          if (response.userErrors?.length > 0) {
            console.error(`❌ Failed to update inventory:`, response.userErrors);
            results.inventory.failed.push({
              productCode: unleashedProduct.ProductCode,
              location: mainLocation.name,
              errors: response.userErrors
            });
          } else {
            console.log(`✅ Successfully updated inventory`);
            results.inventory.successful.push({
              productCode: unleashedProduct.ProductCode,
              location: mainLocation.name,
              quantity: totalOnHand
            });
          }
        } catch (error) {
          console.error(`❌ Error updating inventory for ${unleashedProduct.ProductCode} at ${mainLocation.name}:`, error);
          results.inventory.failed.push({
            productCode: unleashedProduct.ProductCode,
            location: mainLocation.name,
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
    const baseUrl = `https://${shopDomain}/admin/api/2024-01`;
    const headers = {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': accessToken
    };

    // Process inventory updates
    const results = { successful: [], failed: [] };
    
    for (const variant of variants) {
      try {
        console.log(`  📝 Processing variant ${variant.id}`);
        
        // First get current inventory levels
        const queryLevels = `
          query getInventoryLevels($variantId: ID!) {
            productVariant(id: $variantId) {
              inventoryItem {
                id
                inventoryLevels(first: 50) {
                  edges {
                    node {
                      id
                      available
                      location {
                        id
                      }
                    }
                  }
                }
              }
            }
          }
        `;

        const levelsResponse = await fetch(`${baseUrl}/graphql.json`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            query: queryLevels,
            variables: {
              variantId: variant.id
            }
          })
        });

        const levelsData = await levelsResponse.json();
        
        if (levelsData.errors) {
          throw new Error(`Failed to get inventory levels: ${JSON.stringify(levelsData.errors)}`);
        }

        const inventoryItem = levelsData.data?.productVariant?.inventoryItem;
        if (!inventoryItem) {
          throw new Error('No inventory item found for variant');
        }

        console.log(`  📊 Current inventory levels:`, inventoryItem.inventoryLevels.edges);

        // Update inventory for each location
        for (const edge of inventoryItem.inventoryLevels.edges) {
          const level = edge.node;
          const locationId = level.location.id;
          const currentQty = level.available;
          const desiredQty = variant.quantities[locationId] || 0;
          
          if (currentQty === desiredQty) {
            console.log(`  ✓ Location ${locationId} already at correct quantity (${currentQty})`);
            continue;
          }

          console.log(`  🔄 Updating location ${locationId} from ${currentQty} to ${desiredQty}`);
          
          const mutation = `
            mutation adjustInventoryLevel($input: InventoryAdjustQuantityInput!) {
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

          const adjustmentResponse = await fetch(`${baseUrl}/graphql.json`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              query: mutation,
              variables: {
                input: {
                  inventoryLevelId: level.id,
                  availableDelta: desiredQty - currentQty
                }
              }
            })
          });

          const adjustmentData = await adjustmentResponse.json();
          
          if (adjustmentData.errors || adjustmentData.data?.inventoryAdjustQuantity?.userErrors?.length > 0) {
            throw new Error(`Failed to adjust inventory: ${JSON.stringify(adjustmentData.errors || adjustmentData.data.inventoryAdjustQuantity.userErrors)}`);
          }

          const newLevel = adjustmentData.data.inventoryAdjustQuantity.inventoryLevel;
          console.log(`  ✅ Successfully updated inventory for location ${locationId}:`, newLevel);
          
          results.successful.push({
            variantId: variant.id,
            locationId,
            oldQuantity: currentQty,
            newQuantity: newLevel.available
          });
        }
      } catch (error) {
        console.error(`  ❌ Error updating inventory for variant ${variant.id}:`, error);
        results.failed.push({
          variantId: variant.id,
          error: error.message
        });
      }
    }

    return new Response(JSON.stringify(results), {
      status: results.failed.length === 0 ? 200 : 207,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('❌ Error in handleInventoryUpdate:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

export {
  handlePostSyncOperations
}; 