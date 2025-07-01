/**
 * Shopify Customer Mutations Handler
 * Efficiently creates and updates customers using GraphQL mutations with batching
 */

const MAX_BATCH_SIZE = 10; // GraphQL batch limit for customer operations
const MUTATION_DELAY = 100; // Small delay between batches to avoid rate limits

// GraphQL mutation for creating/updating a customer using customerSet
const CUSTOMER_SET_MUTATION = `
  mutation customerSet($identifier: CustomerSetIdentifierInput, $input: CustomerInput!) {
    customerSet(identifier: $identifier, input: $input) {
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

        // Use email as identifier for customerSet (will create if doesn't exist)
        const identifier = {
          email: customerData.email
        };

        const mutationResult = await executeMutation(
          baseUrl,
          headers,
          CUSTOMER_SET_MUTATION,
          { 
            identifier,
            input: customerInput 
          }
        );

        if (mutationResult.customerSet.userErrors.length > 0) {
          const errors = mutationResult.customerSet.userErrors;
          console.error(`❌ Failed to create customer "${customerData.firstName} ${customerData.lastName}":`, errors);
          results.failed.push({
            customerData,
            errors: errors.map(e => `${e.field}: ${e.message}`)
          });
        } else {
          const createdCustomer = mutationResult.customerSet.customer;
          console.log(`✅ Successfully created customer: "${createdCustomer.firstName} ${createdCustomer.lastName}" (ID: ${createdCustomer.id})`);
          results.successful.push({
            originalData: customerData,
            shopifyCustomer: createdCustomer
          });
        }

        results.totalProcessed++;
      } catch (error) {
        console.error(`❌ Error creating customer "${customerData.firstName} ${customerData.lastName}":`, error.message);
        results.failed.push({
          customerData,
          errors: [error.message]
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

        // Use email as identifier for customerSet (will update if exists)
        const identifier = {
          email: customerData.email
        };

        const mutationResult = await executeMutation(
          baseUrl,
          headers,
          CUSTOMER_SET_MUTATION,
          { 
            identifier,
            input: customerInput 
          }
        );

        if (mutationResult.customerSet.userErrors.length > 0) {
          const errors = mutationResult.customerSet.userErrors;
          console.error(`❌ Failed to update customer "${customerData.firstName} ${customerData.lastName}":`, errors);
          results.failed.push({
            customerData,
            errors: errors.map(e => `${e.field}: ${e.message}`)
          });
        } else {
          const updatedCustomer = mutationResult.customerSet.customer;
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

    // Prepare the base URL and headers
    const baseUrl = `https://${authData.domain}.myshopify.com/admin/api/2023-10`;
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

    return results;
  } catch (error) {
    console.error('🚨 Customer mutations failed:', error);
    throw new Error(`Customer mutations failed: ${error.message}`);
  }
}

module.exports = {
  mutateCustomers,
  createCustomersBatch,
  updateCustomersBatch
}; 