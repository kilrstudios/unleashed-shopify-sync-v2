# Separated Worker Architecture Deployment Guide

## Overview

To solve the subrequest limit issue (1000+ subrequests per worker), we've separated the sync process into two dedicated workers:

1. **Main Worker** (`unleashed-shopify-sync-v2`) - Handles data pulling and queueing
2. **Mutation Worker** (`unleashed-shopify-sync-mutation-worker`) - Processes mutations one at a time

## Architecture

```
[Main Worker] → [Queues] → [Mutation Worker]
     ↓             ↓             ↓
  Data Pulling   Queuing    One Mutation
  Data Mapping   Messages   Per Request
```

## Deployment Steps

### 1. Deploy the Main Worker

This is your existing worker that now only handles data pulling and queueing:

```bash
wrangler deploy --config wrangler.toml
```

### 2. Deploy the Mutation Worker

Deploy the new dedicated mutation worker:

```bash
wrangler deploy --config wrangler-mutation-worker.toml
```

### 3. Verify Queue Configuration

The queues are automatically configured to route messages from the main worker to the mutation worker:

- **Main Worker**: Only produces queue messages
- **Mutation Worker**: Only consumes queue messages

### 4. Test the Setup

Test that both workers are working correctly:

```bash
# Test main worker (should queue mutations)
curl -X POST https://your-main-worker.workers.dev/api/v2/comprehensive-sync \
  -H "Content-Type: application/json" \
  -d '{"domain": "your-domain.com"}'

# Test mutation worker health
curl https://your-mutation-worker.workers.dev/health
```

## How It Works

### Main Worker Flow

1. **Data Pulling**: Fetches data from Unleashed and Shopify
2. **Data Mapping**: Determines what needs to be created/updated/archived
3. **Queueing**: Sends individual mutation messages to queues
4. **Response**: Returns immediately with queue status

### Mutation Worker Flow

1. **Queue Processing**: Processes one message at a time
2. **Authentication**: Retrieves Shopify credentials from KV store
3. **Mutation**: Executes single GraphQL mutation
4. **Acknowledgment**: Confirms successful processing

## Benefits

### ✅ Solved Issues
- **Subrequest Limits**: Each mutation worker invocation handles only 1-2 subrequests
- **Reliability**: Failed mutations are retried independently
- **Scalability**: Cloudflare can spawn multiple mutation worker instances
- **Monitoring**: Clear separation of concerns for debugging

### ⚡ Performance
- **Parallel Processing**: Multiple mutations can run simultaneously
- **No Blocking**: Main worker returns immediately after queueing
- **Automatic Scaling**: Cloudflare handles worker scaling

## Queue Configuration

### Main Worker Queues (Producers Only)
```toml
# Product mutations
[[queues.producers]]
queue = "product-mutations"
binding = "PRODUCT_QUEUE"

# Location mutations  
[[queues.producers]]
queue = "location-mutations"
binding = "LOCATION_QUEUE"

# Customer mutations
[[queues.producers]]
queue = "customer-mutations"
binding = "CUSTOMER_QUEUE"
```

### Mutation Worker Queues (Consumers Only)
```toml
# Process one mutation at a time
[[queues.consumers]]
queue = "product-mutations"
max_batch_size = 1
max_batch_timeout = 30

[[queues.consumers]]
queue = "location-mutations"
max_batch_size = 1
max_batch_timeout = 30

[[queues.consumers]]
queue = "customer-mutations"
max_batch_size = 1
max_batch_timeout = 30
```

## Monitoring

### Main Worker Logs
- Data pulling progress
- Mapping results
- Queue message counts
- Overall sync status

### Mutation Worker Logs
- Individual mutation processing
- Success/failure status
- Authentication issues
- GraphQL errors

## Troubleshooting

### Common Issues

1. **Authentication Errors in Mutation Worker**
   - Ensure KV store has correct auth data
   - Check domain mapping is correct

2. **Queue Messages Not Processing**
   - Verify mutation worker is deployed
   - Check queue configuration matches

3. **Mutations Failing**
   - Check Shopify API credentials
   - Verify GraphQL mutation syntax
   - Review rate limiting

### Debug Commands

```bash
# Check main worker deployment
wrangler deployments list --name unleashed-shopify-sync-v2

# Check mutation worker deployment  
wrangler deployments list --name unleashed-shopify-sync-mutation-worker

# Monitor queue status
wrangler queues list

# View worker logs
wrangler tail unleashed-shopify-sync-v2
wrangler tail unleashed-shopify-sync-mutation-worker
```

## API Usage

The API endpoints remain the same, but now they return immediately after queueing:

```bash
# Comprehensive sync (returns after queueing)
POST /api/v2/comprehensive-sync

# Individual sync endpoints
POST /api/v2/sync-products
POST /api/v2/sync-customers  
POST /api/v2/sync-locations
```

### Response Format

```json
{
  "success": true,
  "domain": "example.com",
  "steps": {
    "productSync": {
      "mutations": {
        "method": "queue_based",
        "syncId": "uuid-here",
        "queued": {
          "creates": 50,
          "updates": 100,
          "archives": 25
        }
      }
    }
  }
}
```

## Cost Optimization

### Before (Single Worker)
- 1 worker × 1000+ subrequests = High cost per sync
- Timeout risks with large syncs

### After (Separated Workers)  
- Main worker: ~10 subrequests (data pulling only)
- Mutation worker: 1-2 subrequests per mutation
- Better resource utilization and cost distribution

## Next Steps

1. Deploy both workers using the commands above
2. Test with a small dataset first
3. Monitor logs to ensure proper operation
4. Scale up to full production workload

The separated architecture ensures reliable, scalable syncing without hitting Cloudflare's subrequest limits. 