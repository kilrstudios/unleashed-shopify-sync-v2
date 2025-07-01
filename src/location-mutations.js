/**
 * Shopify Location Mutations Handler
 * Efficiently creates and updates locations using GraphQL mutations with batching
 */

const MAX_BATCH_SIZE = 10; // GraphQL batch limit for location operations
const MUTATION_DELAY = 100; // Small delay between batches to avoid rate limits

// GraphQL mutation for creating a location
const CREATE_LOCATION_MUTATION = `
  mutation locationAdd($input: LocationAddInput!) {
    locationAdd(input: $input) {
      location {
        id
        name
        address {
          address1
          address2
          city
          provinceCode
          countryCode
          zip
          phone
        }
        fulfillsOnlineOrders
        shipsInventory
      }
      userErrors {
        field
        message
      }
    }
  }
`;

// GraphQL mutation for updating a location
const UPDATE_LOCATION_MUTATION = `
  mutation locationEdit($id: ID!, $input: LocationEditInput!) {
    locationEdit(id: $id, input: $input) {
      location {
        id
        name
        address {
          address1
          address2
          city
          provinceCode
          countryCode
          zip
          phone
        }
        fulfillsOnlineOrders
        shipsInventory
      }
      userErrors {
        field
        message
      }
    }
  }
`;

/**
 * Execute a single GraphQL mutation
 */
async function executeMutation(baseUrl, headers, mutation, variables) {
  try {
    const response = await fetch(`${baseUrl}/graphql.json`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        query: mutation,
        variables
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    
    if (result.errors) {
      throw new Error(`GraphQL errors: ${JSON.stringify(result.errors)}`);
    }

    return result.data;
  } catch (error) {
    console.error('Mutation execution failed:', error);
    throw error;
  }
}

/**
 * Create locations in batches
 */
async function createLocationsBatch(baseUrl, headers, locationsToCreate) {
  const results = {
    successful: [],
    failed: [],
    totalProcessed: 0
  };

  console.log(`📍 Starting creation of ${locationsToCreate.length} locations in batches of ${MAX_BATCH_SIZE}`);

  // Process in batches
  for (let i = 0; i < locationsToCreate.length; i += MAX_BATCH_SIZE) {
    const batch = locationsToCreate.slice(i, i + MAX_BATCH_SIZE);
    console.log(`📦 Processing batch ${Math.floor(i / MAX_BATCH_SIZE) + 1} with ${batch.length} locations`);

    // Process each location in the current batch
    for (const locationData of batch) {
      try {
        console.log(`🏗️ Creating location: "${locationData.name}"`);
        console.log(`   Address: ${locationData.address1}, ${locationData.city}, ${locationData.provinceCode}, ${locationData.countryCode}`);

        // Prepare the location input for Shopify
        const locationInput = {
          name: locationData.name,
          address: {
            address1: locationData.address1,
            address2: locationData.address2 || "",
            city: locationData.city,
            provinceCode: locationData.provinceCode,
            countryCode: locationData.countryCode,
            zip: locationData.zip,
            phone: locationData.phone || ""
          },
          fulfillsOnlineOrders: true,
          shipsInventory: true
        };

        // Add metafields if we have unleashed warehouse data
        if (locationData.warehouseCode) {
          locationInput.metafields = [
            {
              namespace: "unleashed",
              key: "warehouse_code",
              value: locationData.warehouseCode,
              type: "single_line_text_field"
            }
          ];
        }

        const mutationResult = await executeMutation(
          baseUrl,
          headers,
          CREATE_LOCATION_MUTATION,
          { input: locationInput }
        );

        if (mutationResult.locationAdd.userErrors.length > 0) {
          const errors = mutationResult.locationAdd.userErrors;
          console.error(`❌ Failed to create location "${locationData.name}":`, errors);
          results.failed.push({
            locationData,
            errors: errors.map(e => `${e.field}: ${e.message}`)
          });
        } else {
          const createdLocation = mutationResult.locationAdd.location;
          console.log(`✅ Successfully created location: "${createdLocation.name}" (ID: ${createdLocation.id})`);
          results.successful.push({
            originalData: locationData,
            shopifyLocation: createdLocation
          });
        }

        results.totalProcessed++;
      } catch (error) {
        console.error(`❌ Error creating location "${locationData.name}":`, error.message);
        results.failed.push({
          locationData,
          errors: [error.message]
        });
        results.totalProcessed++;
      }
    }

    // Add delay between batches to respect rate limits
    if (i + MAX_BATCH_SIZE < locationsToCreate.length) {
      console.log(`⏳ Waiting ${MUTATION_DELAY}ms before next batch...`);
      await new Promise(resolve => setTimeout(resolve, MUTATION_DELAY));
    }
  }

  return results;
}

/**
 * Update locations in batches
 */
async function updateLocationsBatch(baseUrl, headers, locationsToUpdate) {
  const results = {
    successful: [],
    failed: [],
    totalProcessed: 0
  };

  console.log(`📍 Starting update of ${locationsToUpdate.length} locations in batches of ${MAX_BATCH_SIZE}`);

  // Process in batches
  for (let i = 0; i < locationsToUpdate.length; i += MAX_BATCH_SIZE) {
    const batch = locationsToUpdate.slice(i, i + MAX_BATCH_SIZE);
    console.log(`📦 Processing batch ${Math.floor(i / MAX_BATCH_SIZE) + 1} with ${batch.length} locations`);

    // Process each location in the current batch
    for (const locationData of batch) {
      try {
        console.log(`🔄 Updating location: "${locationData.name}" (ID: ${locationData.id})`);
        console.log(`   New Address: ${locationData.address1}, ${locationData.city}, ${locationData.provinceCode}, ${locationData.countryCode}`);

        // Prepare the location input for Shopify
        const locationInput = {
          name: locationData.name,
          address: {
            address1: locationData.address1,
            address2: locationData.address2 || "",
            city: locationData.city,
            provinceCode: locationData.provinceCode,
            countryCode: locationData.countryCode,
            zip: locationData.zip,
            phone: locationData.phone || ""
          },
          fulfillsOnlineOrders: true,
          shipsInventory: true
        };

        // Add metafields if we have unleashed warehouse data
        if (locationData.warehouseCode) {
          locationInput.metafields = [
            {
              namespace: "unleashed",
              key: "warehouse_code",
              value: locationData.warehouseCode,
              type: "single_line_text_field"
            }
          ];
        }

        const mutationResult = await executeMutation(
          baseUrl,
          headers,
          UPDATE_LOCATION_MUTATION,
          { 
            id: locationData.id,
            input: locationInput 
          }
        );

        if (mutationResult.locationEdit.userErrors.length > 0) {
          const errors = mutationResult.locationEdit.userErrors;
          console.error(`❌ Failed to update location "${locationData.name}" (ID: ${locationData.id}):`, errors);
          results.failed.push({
            locationData,
            errors: errors.map(e => `${e.field}: ${e.message}`)
          });
        } else {
          const updatedLocation = mutationResult.locationEdit.location;
          console.log(`✅ Successfully updated location: "${updatedLocation.name}" (ID: ${updatedLocation.id})`);
          results.successful.push({
            originalData: locationData,
            shopifyLocation: updatedLocation
          });
        }

        results.totalProcessed++;
      } catch (error) {
        console.error(`❌ Error updating location "${locationData.name}" (ID: ${locationData.id}):`, error.message);
        results.failed.push({
          locationData,
          errors: [error.message]
        });
        results.totalProcessed++;
      }
    }

    // Add delay between batches to respect rate limits
    if (i + MAX_BATCH_SIZE < locationsToUpdate.length) {
      console.log(`⏳ Waiting ${MUTATION_DELAY}ms before next batch...`);
      await new Promise(resolve => setTimeout(resolve, MUTATION_DELAY));
    }
  }

  return results;
}

/**
 * Main function to mutate locations (create and update)
 */
async function mutateLocations(authData, mappingResults) {
  const { accessToken, shopDomain } = authData;
  const baseUrl = `https://${shopDomain}/admin/api/2025-04`;
  const headers = {
    'Content-Type': 'application/json',
    'X-Shopify-Access-Token': accessToken
  };

  const results = {
    created: { successful: [], failed: [], totalProcessed: 0 },
    updated: { successful: [], failed: [], totalProcessed: 0 },
    summary: {
      totalLocationsProcessed: 0,
      totalSuccessful: 0,
      totalFailed: 0,
      createdCount: 0,
      updatedCount: 0,
      startTime: new Date().toISOString(),
      endTime: null,
      duration: null
    }
  };

  const startTime = Date.now();

  try {
    console.log('🚀 Starting location mutations...');
    console.log(`📊 Summary: ${mappingResults.toCreate.length} to create, ${mappingResults.toUpdate.length} to update`);

    // Create new locations
    if (mappingResults.toCreate.length > 0) {
      console.log('\n🏗️ === CREATING NEW LOCATIONS ===');
      results.created = await createLocationsBatch(baseUrl, headers, mappingResults.toCreate);
    } else {
      console.log('\n🏗️ === NO NEW LOCATIONS TO CREATE ===');
    }

    // Update existing locations
    if (mappingResults.toUpdate.length > 0) {
      console.log('\n🔄 === UPDATING EXISTING LOCATIONS ===');
      results.updated = await updateLocationsBatch(baseUrl, headers, mappingResults.toUpdate);
    } else {
      console.log('\n🔄 === NO EXISTING LOCATIONS TO UPDATE ===');
    }

    // Calculate final summary
    const endTime = Date.now();
    results.summary.totalLocationsProcessed = results.created.totalProcessed + results.updated.totalProcessed;
    results.summary.totalSuccessful = results.created.successful.length + results.updated.successful.length;
    results.summary.totalFailed = results.created.failed.length + results.updated.failed.length;
    results.summary.createdCount = results.created.successful.length;
    results.summary.updatedCount = results.updated.successful.length;
    results.summary.endTime = new Date().toISOString();
    results.summary.duration = `${((endTime - startTime) / 1000).toFixed(2)}s`;

    console.log('\n🎯 === LOCATION MUTATIONS COMPLETE ===');
    console.log(`📊 Total Processed: ${results.summary.totalLocationsProcessed}`);
    console.log(`✅ Successful: ${results.summary.totalSuccessful} (${results.summary.createdCount} created, ${results.summary.updatedCount} updated)`);
    console.log(`❌ Failed: ${results.summary.totalFailed}`);
    console.log(`⏱️ Duration: ${results.summary.duration}`);

    if (results.summary.totalFailed > 0) {
      console.log('\n❌ Failed Operations:');
      results.created.failed.forEach(failure => {
        console.log(`   Create "${failure.locationData.name}": ${failure.errors.join(', ')}`);
      });
      results.updated.failed.forEach(failure => {
        console.log(`   Update "${failure.locationData.name}": ${failure.errors.join(', ')}`);
      });
    }

  } catch (error) {
    console.error('🚨 Critical error during location mutations:', error);
    throw error;
  }

  return results;
}

export { mutateLocations }; 