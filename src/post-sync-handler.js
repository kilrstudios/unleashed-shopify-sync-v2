import { getProductById } from './product-mutations';

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
      mutation productCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
        productCreateMedia(productId: $productId, media: $media) {
          media {
            ... on MediaImage {
              id
              image {
                url
                altText
              }
            }
          }
          mediaUserErrors {
            field
            message
          }
        }
      }
    `;

    const variables = {
      productId,
      media: [{
        originalSource: imageUrl,
        alt: altText || ''
      }]
    };

    console.log(`Uploading product image via productCreateMedia: ${imageUrl}`);
    const response = await shopifyClient.request(mutation, variables);
    return response.productCreateMedia;
  } catch (error) {
    console.error('Error updating product image:', error);
    throw error;
  }
}

async function handlePostSyncOperations(shopifyClient, unleashedProducts, shopifyProducts) {
  const results = {
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

      // Collect image sources from Images, ImageUrl, and Attachments
      const imageSources = [];
      if (unleashedProduct.Images && unleashedProduct.Images.length > 0) {
        imageSources.push(...unleashedProduct.Images.map(img => ({
          url: img.Url,
          alt: unleashedProduct.ProductDescription
        })));
      }
      if (unleashedProduct.ImageUrl) {
        imageSources.push({
          url: unleashedProduct.ImageUrl,
          alt: unleashedProduct.ProductDescription
        });
      }
      if (unleashedProduct.Attachments && unleashedProduct.Attachments.length > 0) {
        imageSources.push(...unleashedProduct.Attachments.map(att => ({
          url: att.DownloadUrl || att.Url,
          alt: att.Description || unleashedProduct.ProductDescription
        })));
      }

      if (imageSources.length > 0) {
        console.log(`\n🖼️ Processing images for product ${unleashedProduct.ProductCode}...`);
        for (const img of imageSources) {
          try {
            const response = await updateProductImage(
              shopifyClient,
              shopifyProduct.id,
              img.url,
              img.alt
            );

            if (response.mediaUserErrors?.length > 0) {
              console.error(`❌ Failed to update image:`, response.mediaUserErrors);
              results.images.failed.push({
                productCode: unleashedProduct.ProductCode,
                imageUrl: img.url,
                errors: response.mediaUserErrors
              });
            } else {
              console.log(`✅ Successfully updated image`);
              results.images.successful.push({
                productCode: unleashedProduct.ProductCode,
                imageUrl: img.url,
                imageId: response.media[0].id
              });
            }
          } catch (error) {
            console.error(`❌ Error updating image for ${unleashedProduct.ProductCode}:`, error);
            results.images.failed.push({
              productCode: unleashedProduct.ProductCode,
              imageUrl: img.url,
              error: error.message
            });
          }
        }
      }
    }

    console.log('\n📊 Post-sync operations summary:');
    console.log(`✅ Image updates: ${results.images.successful.length} successful, ${results.images.failed.length} failed`);

    return results;

  } catch (error) {
    console.error('❌ Error in handlePostSyncOperations:', error);
    throw error;
  }
}

export { handlePostSyncOperations }; 