import { getProductById } from './product-mutations';

async function uploadAndLinkProductImages(shopifyClient, productId, variantIds, images) {
  if (images.length === 0) return { uploaded: [], linked: [], mediaUserErrors: [] };

  // Deduplicate against existing images on the product first
  const existingImgsRes = await shopifyClient.request(
    `query GetImages($id: ID!) { product(id: $id) { images(first: 100) { edges { node { id originalSrc } } } } }`,
    { id: productId }
  );

  const existingSrcSet = new Set(
    existingImgsRes?.product?.images?.edges?.map(e => e.node.originalSrc) || []
  );

  const imagesToProcess = images.filter(img => !existingSrcSet.has(img.url));

  if (imagesToProcess.length === 0) {
    console.log('🖼️ All images already exist on product – skipping upload');
    return { uploaded: [], linked: [], mediaUserErrors: [] };
  }

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

  const mediaInputs = imagesToProcess.map(img => ({
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

  // Fetch current MEDIA attachments for each variant (2025-04 API)
  const variantsRes = await shopifyClient.request(
    `query VariantMedia($id: ID!) {
       product(id: $id) {
         variants(first: 250) {
           edges {
             node {
               id
               media(first: 10) {
                 edges { node { id mediaContentType } }
               }
             }
           }
         }
       }
     }`,
    { id: productId }
  );

  // Build a map of variantId → array<mediaId>
  const currentMediaMap = new Map();
  variantsRes.product.variants.edges.forEach(edge => {
    const vId = edge.node.id;
    const ids = (edge.node.media?.edges || []).map(me => me.node.id);
    if (ids.length) currentMediaMap.set(vId, ids);
  });

  // Prepare detach inputs – group per variant (variantId must be unique)
  const detachInputs = variantIds
    .map(vId => {
      const existingIds = currentMediaMap.get(vId) || [];
      return existingIds.length ? { variantId: vId, mediaIds: [existingIds[0]] } : null;
    })
    .filter(Boolean);

  if (detachInputs.length) {
    console.log(`🗑️ Detaching media from ${detachInputs.length} variant(s) before append ...`);
    const detachMutation = `
      mutation Detach($productId: ID!, $variantMedia: [ProductVariantDetachMediaInput!]!) {
        productVariantDetachMedia(productId: $productId, variantMedia: $variantMedia) { userErrors { field message } }
      }
    `;
    const detRes = await shopifyClient.request(detachMutation, { productId, variantMedia: detachInputs });
    const detErr = detRes.productVariantDetachMedia.userErrors || [];
    if (detErr.length) {
      console.warn('⚠️ Detach userErrors:', detErr);
    }
  }

  // Build variantMediaInputs
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
  // 🚫 Image post-sync disabled (handled earlier by handleVariantImages). Skip to avoid duplicate uploads.
  console.log('⚠️ Image post-sync disabled – skipping handlePostSyncOperations');
  return {
    images: {
      successful: [],
      failed: []
    }
  };
}

export { handlePostSyncOperations }; 