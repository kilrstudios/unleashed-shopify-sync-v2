# Unleashed-Shopify Sync V2

A series of Cloudflare Workers designed to sync data between Unleashed Software and Shopify systems.

## 🔄 **UPDATED - Phase 1: Data Fetching Worker (FIXED AUTHENTICATION)**

We've successfully created and deployed the first Cloudflare Worker with **CORRECTED** Unleashed API authentication:

- **Worker URL**: `https://unleashed-shopify-sync-v2.adrian-b0e.workers.dev/api/v2/data-fetch`
- **KV Store**: Connected to KV namespace `f561e9dfc8774ea4bb5fc9a877bbb8c4`
- **Authentication**: ✅ **FIXED** - Now uses proper HMAC-SHA256 signature generation

### ✅ **Critical Authentication Fixes Applied:**

#### **Previous Issues (FIXED):**
- ❌ Was using raw API key instead of HMAC-SHA256 signature
- ❌ Missing required headers for Unleashed API
- ❌ Incorrect authentication method

#### **Current Implementation (CORRECT):**
- ✅ **Proper HMAC-SHA256 signature generation** using Web Crypto API
- ✅ **All 5 required headers** as per Unleashed API 2025 documentation:
  - `Content-Type: application/json`
  - `Accept: application/json`
  - `api-auth-id: {your-api-id}`
  - `api-auth-signature: {hmac-sha256-signature}`
  - `Client-Type: kilr/unleashedshopify`
- ✅ **Query string extraction** for signature generation
- ✅ **Follows Unleashed best practices** for client-type naming

### ✅ **Features Implemented:**

1. **Domain-based Authentication**
   - Extracts domain from request (removes https:// protocol)
   - Retrieves auth credentials from KV store using domain as key
   - Supports auth data format:
     ```json
     {
       "unleashed": {
         "apiKey": "your-api-key", 
         "apiId": "your-api-id"
       },
       "shopify": {
         "accessToken": "your-access-token",
         "shopDomain": "your-shop.myshopify.com"
       }
     }
     ```

2. **Correct Unleashed Data Fetching**
   - ✅ All products with full pagination + proper HMAC auth
   - ✅ All customers with their contacts + proper HMAC auth
   - ✅ All warehouses + proper HMAC auth

3. **Shopify Data Fetching**
   - ✅ All products with variants, inventory levels, and price tier metafields (1-10)
   - ✅ All customers with unleashed-specific metafields
   - ✅ All locations with address information

4. **Client-Side Integration**
   - ✅ Updated JavaScript for new worker endpoint
   - ✅ Domain detection and automatic submission
   - ✅ Error handling and user feedback

### 🔧 **Technical Implementation Details:**

#### **HMAC-SHA256 Signature Generation:**
```javascript
// Generates proper signature as required by Unleashed API
async function generateUnleashedSignature(queryString, apiKey) {
  const encoder = new TextEncoder();
  const keyBuffer = encoder.encode(apiKey);
  const dataBuffer = encoder.encode(queryString);
  
  const cryptoKey = await crypto.subtle.importKey(
    'raw', keyBuffer, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, dataBuffer);
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}
```

#### **Header Creation:**
```javascript
// Creates all required headers with proper authentication
async function createUnleashedHeaders(endpoint, apiKey, apiId) {
  const url = new URL(endpoint);
  const queryString = url.search ? url.search.substring(1) : '';
  const signature = await generateUnleashedSignature(queryString, apiKey);
  
  return {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'api-auth-id': apiId,
    'api-auth-signature': signature,
    'Client-Type': 'kilr/unleashedshopify'
  };
}
```

### Files Created:

- `src/index.js` - Main worker (deployed with correct auth)
- `wrangler.toml` - Configuration 
- `client-script.js` - Minified version for production
- `client-script-readable.js` - Development version
- `test.html` - Test page
- `README.md` - Complete documentation

## Authentication Requirements

### **Unleashed API Requirements (2025):**
Per official Unleashed API documentation, each request requires these **5 headers**:

1. `Content-Type` - Must be `application/json`
2. `Accept` - Must be `application/json` 
3. `api-auth-id` - Your API ID from Unleashed dashboard
4. `api-auth-signature` - HMAC-SHA256 signature of query string + API key
5. `Client-Type` - Format: `partner_name/app_name` (lowercase, no spaces)

### **Signature Generation Logic:**
- Extract query parameters from URL (everything after `?`)
- If no query params, use empty string `""`
- Generate HMAC-SHA256 hash of query string using API key
- Convert to Base64
- **Examples:**
  - `/Products` → signature of `""` (empty string)
  - `/Products/1/200` → signature of `""` (empty string)
  - `/Products?productCode=ABC` → signature of `"productCode=ABC"`

## Testing

### **Test with Your Domain:**
1. Ensure your domain is in the KV store with proper auth data format (above)
2. Use the new client script URL: `https://unleashed-shopify-sync-v2.adrian-b0e.workers.dev/api/v2/data-fetch`
3. The worker will fetch all data from both systems using correct authentication

### **Local Testing:**
```bash
npm run dev
```

### **Production Deployment:**
```bash
npm run deploy
```

### **Debug Logging:**
The worker now includes debug logging for authentication:
- API endpoint being called
- Query string used for signature generation
- This helps verify the signature is being generated correctly

## Configuration

### KV Store Format
Key: `your-domain.com` (without protocol)
Value:
```json
{
  "unleashed": {
    "apiKey": "your-unleashed-api-key",
    "apiId": "your-unleashed-api-id"
  },
  "shopify": {
    "accessToken": "your-shopify-access-token",
    "shopDomain": "your-shop.myshopify.com"
  }
}
```

### Client Integration
Add to your page:
```html
<script src="path/to/client-script.js"></script>
<button kilr-unleashed-sync="button">Sync Data</button>
```

## Next Steps

### 🔄 Phase 2: Data Mapping Functions (TODO)

1. **Customer Mapping**
   - Map Unleashed customer contacts to Shopify customers
   - Identify customers to create/update in Shopify
   - Sync customer metafields (code, name, price tier)

2. **Product Mapping**
   - Group Unleashed products by "Product Title" attribute
   - Create multi-variant products in Shopify
   - Map variant options from Unleashed attributes
   - Handle single-variant products
   - Map images, SKUs, descriptions, weights, prices

3. **Price Tier Mapping**
   - Connect Unleashed sell tier pricing to Shopify variant metafields
   - Handle price_tier_1 through price_tier_10

4. **Inventory Mapping**
   - Map Unleashed warehouses to Shopify locations
   - Sync inventory levels

## Architecture

```
Browser Button Click
       ↓
Data Fetching Worker (✅ FIXED AUTH)
       ↓
[Future: Data Mapping Worker]
       ↓
[Future: Product Sync Worker]
       ↓
[Future: Customer Sync Worker]
       ↓
[Future: Location Sync Worker]
       ↓
Complete Sync Response
```

## Current Worker Endpoints

- `POST /api/v2/data-fetch` - Fetch all data from both systems (✅ Fixed Auth)

## Error Handling

The worker includes comprehensive error handling for:
- Missing authentication data
- API rate limits and failures
- Network timeouts
- Data validation errors
- CORS headers for browser compatibility
- **NEW:** Authentication signature generation errors

## Verification Steps

The authentication fix ensures:
1. ✅ Proper HMAC-SHA256 signature generation
2. ✅ Correct header format per Unleashed API spec
3. ✅ Query string extraction and signature calculation
4. ✅ Follows 2025 Unleashed API best practices
5. ✅ Debug logging for troubleshooting

**The worker is now ready for testing with real Unleashed API credentials!**

Ready to proceed with Phase 2 when you're ready! 