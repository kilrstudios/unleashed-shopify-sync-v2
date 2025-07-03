import { getProductById } from './product-mutations';

async function uploadAndLinkProductImages(shopifyClient, productId, variantIds, images) {
  if (images.length === 0) return { uploaded: [], linked: [], mediaUserErrors: [] };

  // 1) Upload images via productCreateMedia
  const uploadMutation = `
    mutation ProductCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
      productCreateMedia(productId: $productId, media: $media) {
        media {
          ... on MediaImage { id alt image { url } }
        }
        mediaUserErrors { field message }
      }
    }
  `;

  const mediaInputs = images.map(img => ({
    mediaContentType: "IMAGE",
    originalSource: img.url,
    alt: img.alt || ''
  }));

  const uploadRes = await shopifyClient.request(uploadMutation, {
    productId,
    media: mediaInputs
  });

  const uploadErrors = uploadRes.productCreateMedia.mediaUserErrors || [];
  const uploadedMedia = uploadRes.productCreateMedia.media || [];

  // Wait until all media are READY (Shopify returns MEDIA_PROCESSING initially)
  async function waitForMediaReady(id, maxAttempts = 10, delayMs = 1000) {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const statusQuery = `
        query MediaStatus($id: ID!) {
          node(id: $id) {
            ... on MediaImage { id status }
          }
        }
      `;
      const res = await shopifyClient.request(statusQuery, { id });
      const status = res.node?.status || 'READY';
      if (status === 'READY') return true;
      await new Promise(r => setTimeout(r, delayMs));
    }
    return false;
  }

  for (const m of uploadedMedia) {
    await waitForMediaReady(m.id, 10, 1000);
  }

  // Map media to variants
  if (uploadedMedia.length === 0) {
    return { uploaded: uploadedMedia, linked: [], mediaUserErrors: uploadErrors };
  }

  const variantMediaInputs = [];
  if (variantIds.length === uploadedMedia.length) {
    // one-to-one by index
    variantIds.forEach((vId, idx) => {
      variantMediaInputs.push({ variantId: vId, mediaIds: [uploadedMedia[idx].id] });
    });
  } else {
    // Shopify only allows ONE mediaId per input → choose the first uploaded media for all variants
    const primaryMediaId = uploadedMedia[0].id;
    variantIds.forEach(vId => {
      variantMediaInputs.push({ variantId: vId, mediaIds: [primaryMediaId] });
    });
  }

  // 2) Link media to variants
  const linkMutation = `
    mutation ProductVariantAppendMedia($productId: ID!, $variantMedia: [ProductVariantAppendMediaInput!]!) {
      productVariantAppendMedia(productId: $productId, variantMedia: $variantMedia) {
        productVariants {
          id
          image { url }
        }
        userErrors { field message }
      }
    }
  `;

  const linkRes = await shopifyClient.request(linkMutation, {
    productId,
    variantMedia: variantMediaInputs
  });

  return {
    uploaded: uploadedMedia,
    linked: linkRes.productVariantAppendMedia.productVariants,
    mediaUserErrors: [...uploadErrors, ...(linkRes.productVariantAppendMedia.userErrors || [])]
  };
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

        try {
          const variantIds = shopifyProduct.variants.map(v => v.id);
          const uploadResult = await uploadAndLinkProductImages(
            shopifyClient,
            shopifyProduct.id,
            variantIds,
            imageSources
          );

          if (uploadResult.mediaUserErrors.length > 0) {
            console.error('❌ Image processing errors:', uploadResult.mediaUserErrors);
            results.images.failed.push({
              productCode: unleashedProduct.ProductCode,
              errors: uploadResult.mediaUserErrors
            });
          } else {
            console.log('✅ Images uploaded & linked');
            results.images.successful.push({
              productCode: unleashedProduct.ProductCode,
              uploaded: uploadResult.uploaded.length,
              linked: uploadResult.linked.length
            });
          }
        } catch (error) {
          console.error(`❌ Image processing failed for ${unleashedProduct.ProductCode}:`, error);
          results.images.failed.push({
            productCode: unleashedProduct.ProductCode,
            error: error.message
          });
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