/**
 * Mutation Worker - Dedicated worker for processing queue messages
 * This worker handles one mutation per request to avoid subrequest limits
 */

import { handleProductQueueMessage, handleInventoryUpdate, handleImageUpdate } from './src/product-mutations.js';
import { handleLocationQueueMessage } from './src/location-mutations.js';
import { handleCustomerQueueMessage } from './src/customer-mutations.js';

// CORS headers for all responses
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept, Accept-Encoding, Accept-Language, Content-Length, Origin, Referer, User-Agent, X-Forwarded-Proto',
  'Access-Control-Max-Age': '86400', // 24 hours cache for preflight
};

// Helper function to create JSON responses
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}

// Log verbosity helper
function applyLogVerbosity(env) {
  const logLevel = env.LOG_LEVEL || 'info';
  if (logLevel === 'debug') {
    console.log('[MUTATION-WORKER] Debug logging enabled');
  } else if (logLevel === 'minimal') {
    // Override console.log for minimal logging
    console.log = () => {};
  }
}

export default {
  async fetch(request, env, ctx) {
    // Apply log verbosity setting for this request
    applyLogVerbosity(env);

    // Handle CORS preflight requests
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders
      });
    }

    const url = new URL(request.url);
    
    // Health check endpoint
    if (url.pathname === '/health' && request.method === 'GET') {
      return jsonResponse({ 
        status: 'healthy',
        worker: 'mutation-worker',
        timestamp: new Date().toISOString()
      });
    }

    // All other requests should be handled by queue processing
    return jsonResponse({ 
      error: 'This worker only processes queue messages',
      details: 'Use the queue system to send mutations to this worker'
    }, 400);
  },

  /**
   * Queue consumer for processing mutations
   */
  async queue(batch, env) {
    console.log(`🔄 [MUTATION-WORKER] Processing batch of ${batch.messages.length} queue messages`);
    
    const results = {
      processed: 0,
      successful: 0,
      failed: 0,
      errors: []
    };

    // Process each message in the batch
    for (const message of batch.messages) {
      try {
        console.log(`📨 [MUTATION-WORKER] Processing message: ${message.body.type}`);
        
        let result;
        
        // Route message to appropriate handler based on type
        switch (message.body.type) {
          case 'CREATE_PRODUCT':
          case 'UPDATE_PRODUCT':
          case 'ARCHIVE_PRODUCT':
            result = await handleProductQueueMessage(message.body, env);
            break;
            
          case 'UPDATE_INVENTORY':
            result = await handleInventoryUpdate(message.body, env);
            break;
            
          case 'UPDATE_IMAGE':
            result = await handleImageUpdate(message.body, env);
            break;
            
          case 'CREATE_LOCATION':
          case 'UPDATE_LOCATION':
            result = await handleLocationQueueMessage(message.body, env);
            break;
            
          case 'CREATE_CUSTOMER':
          case 'UPDATE_CUSTOMER':
            result = await handleCustomerQueueMessage(message.body, env);
            break;
            
          default:
            throw new Error(`Unknown message type: ${message.body.type}`);
        }
        
        if (result.success) {
          results.successful++;
          console.log(`✅ [MUTATION-WORKER] Successfully processed ${message.body.type}`);
        } else {
          results.failed++;
          results.errors.push({
            messageType: message.body.type,
            error: result.error
          });
          console.error(`❌ [MUTATION-WORKER] Failed to process ${message.body.type}: ${result.error}`);
        }
        
        // Acknowledge the message
        message.ack();
        
      } catch (error) {
        console.error(`🚨 [MUTATION-WORKER] Error processing message:`, error);
        results.failed++;
        results.errors.push({
          messageType: message.body?.type || 'unknown',
          error: error.message
        });
        
        // Retry the message (don't ack it)
        message.retry();
      }
      
      results.processed++;
    }
    
    console.log(`📊 [MUTATION-WORKER] Batch processing complete:`, {
      processed: results.processed,
      successful: results.successful,
      failed: results.failed,
      errorCount: results.errors.length
    });
    
    return results;
  }
}; 