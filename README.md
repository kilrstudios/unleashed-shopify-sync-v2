# Unleashed-Shopify Sync V2

A Cloudflare Workers-based system designed to sync data between Unleashed Software and Shopify, with intelligent data mapping and automated mutations.

## 🎯 **Current Status: Location Sync System (✅ FULLY WORKING)**

The system currently provides **complete location synchronization** between Unleashed warehouses and Shopify locations, with intelligent mapping and automated mutations.

### ✅ **Features Implemented:**

- **✅ Complete Location Sync Workflow**: Map Unleashed warehouses to Shopify locations and execute mutations
- **✅ Intelligent Warehouse Code Matching**: Uses metafields for reliable location matching
- **✅ Clean Location Names**: Stores warehouse names without codes for better UX
- **✅ Comprehensive Data Mapping**: Country codes, province codes, and address normalization
- **✅ Batched GraphQL Mutations**: Efficient creation and updates with rate limiting
- **✅ Detailed Logging**: Step-by-step progress tracking with emojis and summaries
- **✅ Multiple Integration Options**: Various API endpoints for different use cases

---

## 🏗️ **System Architecture**

### **Core Components:**

1. **Data Pull Layer** (`src/data_pull.js`)
   - Fetches data from both Unleashed and Shopify APIs
   - Handles authentication and pagination
   - Includes warehouse metafield fetching

2. **Mapping Layer** (`src/location-mapping.js`)
   - Maps Unleashed warehouses to Shopify location data
   - Handles country/province code mapping
   - Determines create vs. update operations

3. **Mutation Layer** (`src/location-mutations.js`)
   - Executes GraphQL mutations for creating/updating locations
   - Batched operations with rate limiting
   - Comprehensive error handling

4. **Workflow Handler** (`src/location-mutation-handler.js`)
   - Orchestrates the complete sync workflow
   - Provides multiple API endpoints
   - Returns detailed operation results

---

## 🔄 **How Location Sync Works**

### **Step 1: Data Fetching**
The system fetches:
- **Unleashed Warehouses**: All warehouse data including addresses and contact info
- **Shopify Locations**: All locations with their metafields, specifically `custom.warehouse_code`

### **Step 2: Intelligent Mapping**
For each Unleashed warehouse:
1. **Generate clean location name**: Uses warehouse name only (e.g., "Main Warehouse", "Head Office")
2. **Map geographic data**: 
   - Country codes (e.g., "Australia" → "AU")
   - Province codes (e.g., "Victoria" → "VIC")
   - Default missing data appropriately
3. **Find matching Shopify location**: Matches by `custom.warehouse_code` metafield
4. **Determine action**: CREATE new location or UPDATE existing one

### **Step 3: Execute Mutations**
- **Create**: New Shopify locations for warehouses without matches
- **Update**: Existing locations with new address/name data
- **Metafield Management**: Sets `custom.warehouse_code` for reliable future matching

---

## 📊 **JSON Data Mapping Reference**

### **Unleashed Warehouse Data Structure:**
```json
{
  "WarehouseCode": "MAIN",
  "WarehouseName": "Main Warehouse", 
  "AddressLine1": "3/97 Monash Dr",
  "AddressLine2": null,
  "City": "Dandenong South",
  "Region": "VIC",
  "Country": "Australia",
  "PostCode": "3175",
  "PhoneNumber": null
}
```

### **Shopify Location Data Structure:**
```json
{
  "id": "gid://shopify/Location/105213002032",
  "name": "Main Warehouse",
  "address": {
    "address1": "3/97 Monash Dr",
    "address2": "",
    "city": "Dandenong South", 
    "provinceCode": "VIC",
    "countryCode": "AU",
    "zip": "3175",
    "phone": ""
  },
  "metafields": {
    "custom.warehouse_code": "MAIN"
  }
}
```

### **Mapping Transformations:**

| Unleashed Field | Shopify Field | Transformation |
|----------------|---------------|----------------|
| `WarehouseName` | `name` | Direct mapping |
| `WarehouseCode` | `metafields.custom.warehouse_code` | Stored as metafield |
| `AddressLine1` | `address.address1` | Default: "Not specified" |
| `AddressLine2` | `address.address2` | Default: "" |
| `City` | `address.city` | Default: "Not specified" |
| `Region` | `address.provinceCode` | Province code mapping |
| `Country` | `address.countryCode` | Country code mapping |
| `PostCode` | `address.zip` | Default: "00000" |
| `PhoneNumber` | `address.phone` | Default: "" |

### **Country Code Mappings:**
```json
{
  "Australia": "AU",
  "United States": "US", 
  "Canada": "CA",
  "United Kingdom": "GB",
  "New Zealand": "NZ"
}
```

### **Province Code Mappings:**
```json
{
  "New South Wales": "NSW",
  "Victoria": "VIC",
  "Queensland": "QLD", 
  "Western Australia": "WA",
  "South Australia": "SA",
  "Tasmania": "TAS"
  // ... includes US states and Canadian provinces
}
```

---

## 🚀 **API Endpoints**

### **1. Complete Location Sync** (Recommended)
**Endpoint**: `/api/v2/sync-locations`
**Method**: POST
**Description**: Full workflow - fetches data, maps locations, and executes mutations

```javascript
// Request
{
  "domain": "your-shop.myshopify.com"
}

// Response
{
  "success": true,
  "domain": "your-shop.myshopify.com",
  "workflow": "complete-sync",
  "mappingResults": {
    "toCreate": 1,
    "toUpdate": 2, 
    "errors": 0,
    "processed": 3
  },
  "mutationResults": {
    "created": { "successful": 1, "failed": 0 },
    "updated": { "successful": 2, "failed": 0 },
    "summary": {
      "totalLocationsProcessed": 3,
      "totalSuccessful": 3,
      "totalFailed": 0,
      "createdCount": 1,
      "updatedCount": 2,
      "duration": "1.49s"
    }
  }
}
```

### **2. Location Mapping Only**
**Endpoint**: `/api/v2/data-fetch`
**Method**: POST
**Description**: Fetches and maps data without executing mutations

### **3. Mutations Only**
**Endpoint**: `/api/v2/mutate-locations`
**Method**: POST
**Description**: Executes mutations on pre-mapped data

---

## 🔧 **Client-Side Integration**

### **Option 1: Automatic Button Detection**
```html
<!-- The script automatically detects buttons with these attributes -->
<button kilr-unleashed-sync>Complete Location Sync</button>
<button kilr-unleashed-mutate-locations>Mutations Only</button>
<button kilr-unleashed-sync-locations>Complete Sync (Alternative)</button>

<script src="https://unleashed-shopify-sync-v2.adrian-b0e.workers.dev/client-script.js"></script>
```

### **Option 2: Manual Integration**
```javascript
// Manual API call
fetch('https://unleashed-shopify-sync-v2.adrian-b0e.workers.dev/api/v2/sync-locations', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ domain: window.location.hostname })
})
.then(response => response.json())
.then(data => console.log('Sync completed:', data));
```

### **Button States & Feedback:**
The client script provides visual feedback:
- **Loading State**: "Syncing Locations..." with loading class
- **Success State**: Green notification with summary
- **Error State**: Red notification with error details
- **Detailed Logging**: Console logs for debugging

---

## ⚙️ **Configuration**

### **Authentication Setup**
Store authentication data in Cloudflare KV with your domain as the key:

**KV Key**: `your-shop.myshopify.com`
**KV Value**:
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

### **Required Shopify Permissions**
Your Shopify app needs these permissions:
- `read_locations` - Read existing locations
- `write_locations` - Create and update locations 
- `read_metafields` - Read location metafields
- `write_metafields` - Write warehouse code metafields

### **Required Unleashed Permissions**
Your Unleashed API user needs:
- `Warehouses` - Read warehouse data
- Standard API access for product/customer sync (future phases)

---

## 🔍 **Detailed Logging Example**

The system provides comprehensive logging for debugging and monitoring:

```
🔄 Starting complete location sync workflow for domain: your-shop.myshopify.com
📊 Step 1: Fetching data from Unleashed and Shopify...
Data pulled successfully: { unleashed: { warehouses: 3 }, shopify: { locations: 7 } }

🗺️ Step 2: Mapping locations...
📍 Existing Shopify locations:
   1. "Head Office" (ID: 105433268528) - Warehouse Code: HQ
   2. "Main Warehouse" (ID: 105213002032) - Warehouse Code: MAIN
   3. "Melbourne" (ID: 105557918000) - Warehouse Code: None

📦 Processing warehouse: MAIN
   🔍 Searching for matching Shopify location with warehouse code: "MAIN"
   ✅ Match found! Existing location: "Main Warehouse" (ID: 105213002032)
   🔄 Will UPDATE existing location

🚀 Step 3: Executing location mutations...
🏗️ Creating location: "Head Office"
✅ Successfully created location: "Head Office" (ID: gid://shopify/Location/105557983536)

🎯 === LOCATION MUTATIONS COMPLETE ===
📊 Total Processed: 3
✅ Successful: 3 (1 created, 2 updated)
❌ Failed: 0
⏱️ Duration: 1.49s
```

---

## 🛠️ **Development & Deployment**

### **Local Development:**
```bash
npm install
npm run dev
```

### **Production Deployment:**
```bash
npm run deploy
```

### **Debug with Tail:**
```bash
npm run deploy && wrangler tail
```

---

## 🔮 **Roadmap - Future Phases**

### **Phase 2: Product Sync** (Coming Next)
- Multi-variant product creation from Unleashed products
- Attribute-based variant mapping
- Image synchronization
- Price tier metafield mapping

### **Phase 3: Customer Sync**
- Customer contact mapping
- Metafield synchronization
- Price tier assignment

### **Phase 4: Inventory Sync**
- Real-time inventory level updates
- Location-specific inventory tracking
- Stock movement synchronization

---

## 📞 **Support & Troubleshooting**

### **Common Issues:**

1. **Authentication Errors**: Verify KV store contains correct auth data for your domain
2. **Missing Metafields**: Ensure Shopify app has metafield read/write permissions
3. **GraphQL Errors**: Check that location data meets Shopify's validation requirements
4. **Rate Limiting**: System includes automatic batching and delays

### **Debug Information:**
Enable detailed logging by monitoring the worker logs with `wrangler tail` during sync operations.

---

**Worker URL**: `https://unleashed-shopify-sync-v2.adrian-b0e.workers.dev`
**KV Namespace**: `f561e9dfc8774ea4bb5fc9a877bbb8c4`
**Version**: 2.0 - Location Sync Complete 