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
// Main function: Decides between bulk operations and individual batch processing
async function mutateCustomers(authData, mappingResults, useBulk = true) {
  const totalOperations = mappingResults.toCreate.length + mappingResults.toUpdate.length;
  
  console.log(`📊 Customer mutations strategy: ${totalOperations} total operations`);
  
  // Use bulk operations for large datasets (recommended for 10+ operations)
  if (useBulk && totalOperations >= 10) {
    console.log(`🚀 Using bulk operations for ${totalOperations} customer operations`);
    return await mutateCustomersBulk(authData, mappingResults);
  }
  
  // Use individual batch processing for smaller datasets or when bulk is disabled
  console.log(`🔄 Using individual batch processing for ${totalOperations} customer operations`);
  return await mutateCustomersIndividual(authData, mappingResults);
}

// Individual customer mutations (original implementation)
async function mutateCustomersIndividual(authData, mappingResults) {
  try {
    console.log('🔄 Starting individual customer mutations...');
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

// === QUEUE-BASED CUSTOMER MUTATIONS ===
async function mutateCustomersViaQueue(env, shopDomain, mappingResults, originalDomain) {
  console.log('🚀 Queueing customer mutations via CUSTOMER_QUEUE');
  const syncId = crypto.randomUUID();
  const results = {
    method: 'queue_based',
    syncId,
    queued: { creates: 0, updates: 0 },
    summary: '',
    errors: []
  };

  try {
    for (const cust of mappingResults.toCreate) {
      await env.CUSTOMER_QUEUE.send({
        type: 'CREATE_CUSTOMER',
        syncId,
        originalDomain,
        shopDomain,
        customerData: cust,
        timestamp: new Date().toISOString()
      });
      results.queued.creates++;
    }
    for (const cust of mappingResults.toUpdate) {
      await env.CUSTOMER_QUEUE.send({
        type: 'UPDATE_CUSTOMER',
        syncId,
        originalDomain,
        shopDomain,
        customerData: cust,
        timestamp: new Date().toISOString()
      });
      results.queued.updates++;
    }
    const total = results.queued.creates + results.queued.updates;
    results.summary = `Queued ${total} customer operations (${results.queued.creates} creates, ${results.queued.updates} updates)`;
    console.log(`✅ ${results.summary} – Sync ID: ${syncId}`);
  } catch (err) {
    console.error('🚨 Failed to queue customer operations', err);
    results.errors.push(err.message);
  }
  return results;
}

// Process individual customer queue messages
async function handleCustomerQueueMessage(message, env) {
  console.log(`👥 Handling CUSTOMER_QUEUE message: ${message.type}`);
  try {
    // Fetch auth
    const authString = await env.AUTH_STORE.get(message.originalDomain);
    if (!authString) throw new Error(`Auth not found for domain ${message.originalDomain}`);
    const authData = JSON.parse(authString);
    const baseUrl = `https://${message.shopDomain}/admin/api/2025-04`;
    const headers = {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': authData.shopify.accessToken
    };

    const cust = message.customerData;

    const buildInput = () => ({
      firstName: cust.firstName,
      lastName: cust.lastName,
      email: cust.email,
      phone: cust.phone || null,
      metafields: (cust.metafields || []).map(mf => ({
        namespace: mf.namespace,
        key: mf.key,
        value: mf.value,
        type: 'single_line_text_field'
      }))
    });

    if (message.type === 'CREATE_CUSTOMER') {
      await executeMutation(baseUrl, headers, CUSTOMER_CREATE_MUTATION, { input: buildInput() });
    } else if (message.type === 'UPDATE_CUSTOMER') {
      await executeMutation(baseUrl, headers, CUSTOMER_UPDATE_MUTATION, { input: { id: cust.id, ...buildInput() } });
    } else {
      throw new Error(`Unknown customer queue message type: ${message.type}`);
    }
    return { success: true };
  } catch (error) {
    console.error('🚨 CUSTOMER_QUEUE message failed:', error);
    return { success: false, error: error.message };
  }
}

// Create JSONL content for bulk customer operations
function createCustomerBulkOperationJsonl(customersToCreate, customersToUpdate) {
  const lines = [];
  
  // Add creates
  customersToCreate.forEach(customer => {
    const customerInput = {
      firstName: customer.firstName,
      lastName: customer.lastName,
      email: customer.email,
      phone: customer.phone || null,
      metafields: customer.metafields.map(metafield => ({
        namespace: metafield.namespace || 'unleashed',
        key: metafield.key,
        value: metafield.value,
        type: "single_line_text_field"
      }))
    };
    const jsonLine = JSON.stringify({ input: customerInput });
    lines.push(jsonLine);
  });

  // Add updates
  customersToUpdate.forEach(customer => {
    const customerInput = {
      id: customer.id, // Required for updates
      firstName: customer.firstName,
      lastName: customer.lastName,
      email: customer.email,
      phone: customer.phone || null,
      metafields: customer.metafields.map(metafield => ({
        namespace: metafield.namespace || 'unleashed',
        key: metafield.key,
        value: metafield.value,
        type: "single_line_text_field"
      }))
    };
    const jsonLine = JSON.stringify({ input: customerInput });
    lines.push(jsonLine);
  });

  return lines.join('\n');
}

// Upload JSONL to Shopify's staged upload for customers
async function uploadCustomerJsonlFile(baseUrl, headers, jsonlContent) {
  // First, get a staged upload URL
  const stagedUploadMutation = `
    mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
      stagedUploadsCreate(input: $input) {
        stagedTargets {
          url
          resourceUrl
          parameters {
            name
            value
          }
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const stagedUploadVariables = {
    input: [{
      resource: 'BULK_MUTATION_VARIABLES',
      filename: 'bulk_customer_operations.jsonl',
      mimeType: 'text/plain',
      httpMethod: 'POST'
    }]
  };

  console.log('📤 Requesting staged upload URL for customers...');
  const stagedResponse = await fetch(`${baseUrl}/graphql.json`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      query: stagedUploadMutation,
      variables: stagedUploadVariables
    })
  });

  const stagedData = await stagedResponse.json();
  if (stagedData.errors) {
    throw new Error(`Customer staged upload request failed: ${JSON.stringify(stagedData.errors)}`);
  }

  const stagedTarget = stagedData.data.stagedUploadsCreate.stagedTargets[0];
  if (!stagedTarget) {
    throw new Error('No staged upload target received for customers');
  }

  console.log('📤 Uploading customer JSONL file to staged URL...');
  
  // Prepare form data for upload
  const formData = new FormData();
  
  // Add parameters from Shopify
  stagedTarget.parameters.forEach(param => {
    formData.append(param.name, param.value);
  });
  
  // Add the file content
  const blob = new Blob([jsonlContent], { type: 'text/plain' });
  formData.append('file', blob, 'bulk_customer_operations.jsonl');

  const uploadResponse = await fetch(stagedTarget.url, {
    method: 'POST',
    body: formData
  });

  if (!uploadResponse.ok) {
    throw new Error(`Customer file upload failed: ${uploadResponse.status} ${uploadResponse.statusText}`);
  }

  console.log('✅ Customer JSONL file uploaded successfully');
  return stagedTarget.resourceUrl;
}

// Start bulk customer operation
async function startCustomerBulkOperation(baseUrl, headers, stagedUploadUrl) {
  const bulkMutation = `
    mutation bulkOperationRunMutation($mutation: String!, $stagedUploadPath: String!) {
      bulkOperationRunMutation(mutation: $mutation, stagedUploadPath: $stagedUploadPath) {
        bulkOperation {
          id
          status
          createdAt
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const customerCreateMutation = `
    mutation customerCreate($input: CustomerInput!) {
      customerCreate(input: $input) {
        customer {
          id
          firstName
          lastName
          email
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  console.log('🚀 Starting customer bulk operation...');
  const response = await fetch(`${baseUrl}/graphql.json`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      query: bulkMutation,
      variables: {
        mutation: customerCreateMutation,
        stagedUploadPath: stagedUploadUrl
      }
    })
  });

  const data = await response.json();
  if (data.errors) {
    throw new Error(`Customer bulk operation start failed: ${JSON.stringify(data.errors)}`);
  }

  if (data.data.bulkOperationRunMutation.userErrors.length > 0) {
    throw new Error(`Customer bulk operation errors: ${JSON.stringify(data.data.bulkOperationRunMutation.userErrors)}`);
  }

  const bulkOperation = data.data.bulkOperationRunMutation.bulkOperation;
  console.log(`✅ Customer bulk operation started: ${bulkOperation.id}`);
  
  return bulkOperation;
}

// Monitor bulk operation status (reuse from products)
async function monitorCustomerBulkOperation(baseUrl, headers, operationId, maxWaitTime = 300000) { // 5 minutes max
  const statusQuery = `
    query {
      currentBulkOperation {
        id
        status
        errorCode
        createdAt
        completedAt
        objectCount
        fileSize
        url
        partialDataUrl
      }
    }
  `;

  const startTime = Date.now();
  let lastStatus = null;

  console.log(`⏳ Monitoring customer bulk operation ${operationId}...`);

  while (Date.now() - startTime < maxWaitTime) {
    await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds between checks

    const response = await fetch(`${baseUrl}/graphql.json`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query: statusQuery })
    });

    const data = await response.json();
    if (data.errors) {
      console.error('Error checking customer bulk operation status:', data.errors);
      continue;
    }

    const operation = data.data.currentBulkOperation;
    if (!operation || operation.id !== operationId) {
      console.log('No current customer bulk operation or different operation running');
      continue;
    }

    if (operation.status !== lastStatus) {
      console.log(`📊 Customer bulk operation status: ${operation.status} (${operation.objectCount || 0} objects processed)`);
      lastStatus = operation.status;
    }

    if (operation.status === 'COMPLETED') {
      console.log('✅ Customer bulk operation completed successfully');
      return {
        success: true,
        operation,
        resultUrl: operation.url
      };
    }

    if (operation.status === 'FAILED' || operation.status === 'CANCELED') {
      console.error(`❌ Customer bulk operation ${operation.status.toLowerCase()}: ${operation.errorCode || 'Unknown error'}`);
      return {
        success: false,
        operation,
        error: operation.errorCode || `Operation ${operation.status.toLowerCase()}`
      };
    }
  }

  console.error('⏰ Customer bulk operation timed out');
  return {
    success: false,
    error: 'Operation timed out',
    operation: null
  };
}

// Download and parse customer bulk operation results
async function parseCustomerBulkOperationResults(resultUrl) {
  if (!resultUrl) {
    console.log('No customer result URL provided - bulk operation may have had no results');
    return [];
  }

  try {
    console.log('📥 Downloading customer bulk operation results...');
    const response = await fetch(resultUrl);
    
    if (!response.ok) {
      throw new Error(`Failed to download customer results: ${response.status} ${response.statusText}`);
    }

    const jsonlContent = await response.text();
    const lines = jsonlContent.trim().split('\n').filter(line => line.trim());
    
    console.log(`📊 Processing ${lines.length} customer result lines...`);
    
    const results = lines.map(line => {
      try {
        return JSON.parse(line);
      } catch (error) {
        console.error('Error parsing customer result line:', line, error);
        return null;
      }
    }).filter(Boolean);

    return results;
  } catch (error) {
    console.error('Error parsing customer bulk operation results:', error);
    return [];
  }
}

// Bulk customer mutations (primary method for large datasets)
async function mutateCustomersBulk(shopifyAuth, mappingResults) {
  console.log('🚀 === STARTING BULK CUSTOMER MUTATIONS ===');
  
  const { accessToken, shopDomain } = shopifyAuth;
  const baseUrl = `https://${shopDomain}/admin/api/2025-04`;
  console.log(`🔗 Using Shopify API base URL: ${baseUrl}`);
  const headers = {
    'Content-Type': 'application/json',
    'X-Shopify-Access-Token': accessToken
  };

  const results = {
    method: 'bulk_operation',
    bulkOperation: { success: false, operation: null, error: null },
    created: { successful: [], failed: [] },
    updated: { successful: [], failed: [] },
    summary: '',
    errors: []
  };

  try {
    const totalOperations = mappingResults.toCreate.length + mappingResults.toUpdate.length;
    
    if (totalOperations === 0) {
      console.log('📭 No customer operations to process');
      results.summary = 'No operations to process';
      return results;
    }

    console.log(`📊 Customer bulk operation summary: ${mappingResults.toCreate.length} creates, ${mappingResults.toUpdate.length} updates (${totalOperations} total)`);

    // Step 1: Create JSONL content for bulk operation
    console.log('📝 Creating customer JSONL content for bulk operation...');
    const jsonlContent = createCustomerBulkOperationJsonl(mappingResults.toCreate, mappingResults.toUpdate);
    
    if (!jsonlContent || jsonlContent.trim() === '') {
      console.log('📭 No customer creates/updates to process via bulk operation');
      results.summary = 'No operations to process';
      return results;
    }

    console.log(`📄 Customer JSONL content created: ${jsonlContent.split('\n').length} operations`);

    // Step 2: Upload JSONL file to staged upload
    const stagedUploadUrl = await uploadCustomerJsonlFile(baseUrl, headers, jsonlContent);

    // Step 3: Start bulk operation
    const bulkOperation = await startCustomerBulkOperation(baseUrl, headers, stagedUploadUrl);

    // Step 4: Monitor bulk operation
    const operationResult = await monitorCustomerBulkOperation(baseUrl, headers, bulkOperation.id, 600000); // 10 minutes max

    results.bulkOperation = operationResult;

    if (operationResult.success) {
      console.log('✅ Customer bulk operation completed successfully');
      
      // Step 5: Parse results
      if (operationResult.resultUrl) {
        const bulkResults = await parseCustomerBulkOperationResults(operationResult.resultUrl);
        console.log(`📊 Customer bulk operation processed ${bulkResults.length} items`);
        
        // Categorize results by operation type
        bulkResults.forEach(result => {
          const isCreate = !result.customer?.id?.includes('gid://shopify/Customer/');
          const hasErrors = result.userErrors && result.userErrors.length > 0;
          
          if (hasErrors) {
            console.error(`❌ Customer bulk operation error:`, result.userErrors);
            results.errors.push({
              operation: isCreate ? 'create' : 'update',
              errors: result.userErrors
            });
          } else if (isCreate) {
            results.created.successful.push(result);
          } else {
            results.updated.successful.push(result);
          }
        });
      }

      results.summary = `Customer bulk operation: ${results.created.successful.length} created, ${results.updated.successful.length} updated. Errors: ${results.errors.length}`;
      
    } else {
      console.error('❌ Customer bulk operation failed:', operationResult.error);
      results.errors.push({
        operation: 'bulk',
        error: operationResult.error
      });
      results.summary = `Customer bulk operation failed: ${operationResult.error}`;
    }

  } catch (error) {
    console.error('❌ Customer bulk mutation error:', error);
    results.errors.push({
      operation: 'bulk_setup',
      error: error.message
    });
    results.summary = `Customer bulk operation setup failed: ${error.message}`;
  }

  console.log('✅ Bulk customer mutations completed');
  return results;
}

export {
  mutateCustomers,
  mutateCustomersIndividual,
  createCustomersBatch,
  updateCustomersBatch,
  mutateCustomersViaQueue,
  handleCustomerQueueMessage,
  mutateCustomersBulk
}; 