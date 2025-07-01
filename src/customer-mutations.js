/**
 * Shopify Customer Mutations Handler
 * Efficiently creates and updates customers using GraphQL mutations with batching
 */

const MAX_BATCH_SIZE = 10; // GraphQL batch limit for customer operations
const MUTATION_DELAY = 100; // Small delay between batches to avoid rate limits

// GraphQL mutation for creating customers using standard customerCreate
const CUSTOMER_CREATE_MUTATION = `
  mutation customerCreate($input: CustomerInput!) {
    customerCreate(input: $input) {
      customer {
        id
        firstName
        lastName
        email
        phone
        metafields(first: 10) {
          edges {
            node {
              namespace
              key
              value
              type
            }
          }
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

// GraphQL mutation for updating customers using customerUpdate
const CUSTOMER_UPDATE_MUTATION = `
  mutation customerUpdate($input: CustomerInput!) {
    customerUpdate(input: $input) {
      customer {
        id
        firstName
        lastName
        email
        phone
        metafields(first: 10) {
          edges {
            node {
              namespace
              key
              value
              type
            }
          }
        }
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
    const url = `${baseUrl}/graphql.json`;
    const body = JSON.stringify({
      query: mutation,
      variables
    });
    
    console.log(`Making GraphQL request to: ${url}`);
    console.log(`Request body:`, body);
    
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    
    console.log(`GraphQL Response:`, JSON.stringify(result, null, 2));
    
    if (result.errors) {
      console.error(`GraphQL errors:`, result.errors);
      throw new Error(`GraphQL errors: ${JSON.stringify(result.errors)}`);
    }

    return result.data;
  } catch (error) {
    console.error('Mutation execution failed:', error);
    throw error;
  }
}

/**
 * Create customers in batches using customerSet mutation
 */
async function createCustomersBatch(baseUrl, headers, customersToCreate) {
  const results = {
    successful: [],
    failed: [],
    totalProcessed: 0
  };

  console.log(`👥 Starting creation of ${customersToCreate.length} customers in batches of ${MAX_BATCH_SIZE}`);

  // Process in batches
  for (let i = 0; i < customersToCreate.length; i += MAX_BATCH_SIZE) {
    const batch = customersToCreate.slice(i, i + MAX_BATCH_SIZE);
    console.log(`📦 Processing batch ${Math.floor(i / MAX_BATCH_SIZE) + 1} with ${batch.length} customers`);

    // Process each customer in the current batch
    for (const customerData of batch) {
      try {
        console.log(`🏗️ Creating customer: "${customerData.firstName} ${customerData.lastName}" (${customerData.email})`);
        console.log(`   CUSTOMER DATA TO CREATE:`, JSON.stringify(customerData, null, 2));

        // Prepare the customer input for Shopify using customerSet
        const customerInput = {
          firstName: customerData.firstName,
          lastName: customerData.lastName,
          email: customerData.email,
          phone: customerData.phone || null,
          metafields: customerData.metafields.map(metafield => ({
            namespace: metafield.namespace,
            key: metafield.key,
            value: metafield.value,
            type: "single_line_text_field"
          }))
        };

        const mutationResult = await executeMutation(
          baseUrl,
          headers,
          CUSTOMER_CREATE_MUTATION,
          { input: customerInput }
        );

        if (mutationResult.customerCreate.userErrors.length > 0) {
          const errors = mutationResult.customerCreate.userErrors;
          console.error(`❌ Failed to create customer "${customerData.firstName} ${customerData.lastName}":`, errors);
          results.failed.push({
            customerData,
            errors: errors.map(e => `${e.field}: ${e.message}`)
          });
        } else {
          const createdCustomer = mutationResult.customerCreate.customer;
          console.log(`✅ Successfully created customer: "${createdCustomer.firstName} ${createdCustomer.lastName}" (ID: ${createdCustomer.id})`);
          results.successful.push({
            originalData: customerData,
            shopifyCustomer: createdCustomer
          });
        }

        results.totalProcessed++;
      } catch (error) {
        console.error(`❌ Error creating customer "${customerData.firstName} ${customerData.lastName}":`, error.message);
        console.error(`   Full error:`, error);
        results.failed.push({
          customerData,
          errors: [error.message],
          fullError: error.toString()
        });
        results.totalProcessed++;
      }
    }

    // Add delay between batches to respect rate limits
    if (i + MAX_BATCH_SIZE < customersToCreate.length) {
      console.log(`⏳ Waiting ${MUTATION_DELAY}ms before next batch...`);
      await new Promise(resolve => setTimeout(resolve, MUTATION_DELAY));
    }
  }

  return results;
}

/**
 * Update customers in batches using customerSet mutation
 */
async function updateCustomersBatch(baseUrl, headers, customersToUpdate) {
  const results = {
    successful: [],
    failed: [],
    totalProcessed: 0
  };

  console.log(`👥 Starting update of ${customersToUpdate.length} customers in batches of ${MAX_BATCH_SIZE}`);

  // Process in batches
  for (let i = 0; i < customersToUpdate.length; i += MAX_BATCH_SIZE) {
    const batch = customersToUpdate.slice(i, i + MAX_BATCH_SIZE);
    console.log(`📦 Processing batch ${Math.floor(i / MAX_BATCH_SIZE) + 1} with ${batch.length} customers`);

    // Process each customer in the current batch
    for (const customerData of batch) {
      try {
        console.log(`🔄 Updating customer: "${customerData.firstName} ${customerData.lastName}" (${customerData.email})`);

        // Prepare the customer input for Shopify using customerUpdate (need ID for updates)
        const customerInput = {
          id: customerData.id, // Required for updates
          firstName: customerData.firstName,
          lastName: customerData.lastName,
          email: customerData.email,
          phone: customerData.phone || null,
          metafields: customerData.metafields.map(metafield => ({
            namespace: metafield.namespace,
            key: metafield.key,
            value: metafield.value,
            type: "single_line_text_field"
          }))
        };

        const mutationResult = await executeMutation(
          baseUrl,
          headers,
          CUSTOMER_UPDATE_MUTATION,
          { input: customerInput }
        );

        if (mutationResult.customerUpdate.userErrors.length > 0) {
          const errors = mutationResult.customerUpdate.userErrors;
          console.error(`❌ Failed to update customer "${customerData.firstName} ${customerData.lastName}":`, errors);
          results.failed.push({
            customerData,
            errors: errors.map(e => `${e.field}: ${e.message}`)
          });
        } else {
          const updatedCustomer = mutationResult.customerUpdate.customer;
          console.log(`✅ Successfully updated customer: "${updatedCustomer.firstName} ${updatedCustomer.lastName}" (ID: ${updatedCustomer.id})`);
          results.successful.push({
            originalData: customerData,
            shopifyCustomer: updatedCustomer
          });
        }

        results.totalProcessed++;
      } catch (error) {
        console.error(`❌ Error updating customer "${customerData.firstName} ${customerData.lastName}":`, error.message);
        results.failed.push({
          customerData,
          errors: [error.message]
        });
        results.totalProcessed++;
      }
    }

    // Add delay between batches to respect rate limits
    if (i + MAX_BATCH_SIZE < customersToUpdate.length) {
      console.log(`⏳ Waiting ${MUTATION_DELAY}ms before next batch...`);
      await new Promise(resolve => setTimeout(resolve, MUTATION_DELAY));
    }
  }

  return results;
}

/**
 * Main function to execute customer mutations
 */
async function mutateCustomers(authData, mappingResults) {
  try {
    console.log('🔄 Starting customer mutations...');
    console.log(`📊 Mutation summary: ${mappingResults.toCreate.length} to create, ${mappingResults.toUpdate.length} to update`);

    // Prepare the base URL and headers (using same pattern as working location mutations)
    const baseUrl = `https://${authData.shopDomain}/admin/api/2025-04`;
    const headers = {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': authData.accessToken
    };

    const results = {
      created: { successful: [], failed: [], totalProcessed: 0 },
      updated: { successful: [], failed: [], totalProcessed: 0 },
      summary: {
        totalCreated: 0,
        totalUpdated: 0,
        totalFailed: 0,
        totalProcessed: 0
      }
    };

    // Create new customers
    if (mappingResults.toCreate.length > 0) {
      console.log(`\n🏗️ Creating ${mappingResults.toCreate.length} new customers...`);
      const createResults = await createCustomersBatch(baseUrl, headers, mappingResults.toCreate);
      results.created = createResults;
      results.summary.totalCreated = createResults.successful.length;
    }

    // Update existing customers
    if (mappingResults.toUpdate.length > 0) {
      console.log(`\n🔄 Updating ${mappingResults.toUpdate.length} existing customers...`);
      const updateResults = await updateCustomersBatch(baseUrl, headers, mappingResults.toUpdate);
      results.updated = updateResults;
      results.summary.totalUpdated = updateResults.successful.length;
    }

    // Calculate totals
    results.summary.totalFailed = results.created.failed.length + results.updated.failed.length;
    results.summary.totalProcessed = results.created.totalProcessed + results.updated.totalProcessed;

    console.log('\n✅ Customer mutations completed!');
    console.log(`📊 Final Summary:`);
    console.log(`   Created: ${results.summary.totalCreated}`);
    console.log(`   Updated: ${results.summary.totalUpdated}`);
    console.log(`   Failed: ${results.summary.totalFailed}`);
    console.log(`   Total Processed: ${results.summary.totalProcessed}`);

    // Add detailed error info to results for debugging
    if (results.created.failed.length > 0) {
      console.log(`🚨 Creation failures:`, JSON.stringify(results.created.failed, null, 2));
      results.debugErrors = results.created.failed;
    }

    return results;
  } catch (error) {
    console.error('🚨 Customer mutations failed:', error);
    throw new Error(`Customer mutations failed: ${error.message}`);
  }
}

export {
  mutateCustomers,
  createCustomersBatch,
  updateCustomersBatch
}; 