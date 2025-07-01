const COUNTRY_CODE_MAPPING = {
  'Australia': 'AU',
  'United States': 'US',
  'Canada': 'CA',
  'United Kingdom': 'GB',
  'New Zealand': 'NZ'
};

// Province/State code mappings for major countries
const PROVINCE_CODE_MAPPING = {
  // Australia
  'New South Wales': 'NSW',
  'Victoria': 'VIC', 
  'Queensland': 'QLD',
  'Western Australia': 'WA',
  'South Australia': 'SA',
  'Tasmania': 'TAS',
  'Northern Territory': 'NT',
  'Australian Capital Territory': 'ACT',
  
  // United States
  'Alabama': 'AL', 'Alaska': 'AK', 'Arizona': 'AZ', 'Arkansas': 'AR', 'California': 'CA',
  'Colorado': 'CO', 'Connecticut': 'CT', 'Delaware': 'DE', 'Florida': 'FL', 'Georgia': 'GA',
  'Hawaii': 'HI', 'Idaho': 'ID', 'Illinois': 'IL', 'Indiana': 'IN', 'Iowa': 'IA',
  'Kansas': 'KS', 'Kentucky': 'KY', 'Louisiana': 'LA', 'Maine': 'ME', 'Maryland': 'MD',
  'Massachusetts': 'MA', 'Michigan': 'MI', 'Minnesota': 'MN', 'Mississippi': 'MS', 'Missouri': 'MO',
  'Montana': 'MT', 'Nebraska': 'NE', 'Nevada': 'NV', 'New Hampshire': 'NH', 'New Jersey': 'NJ',
  'New Mexico': 'NM', 'New York': 'NY', 'North Carolina': 'NC', 'North Dakota': 'ND', 'Ohio': 'OH',
  'Oklahoma': 'OK', 'Oregon': 'OR', 'Pennsylvania': 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC',
  'South Dakota': 'SD', 'Tennessee': 'TN', 'Texas': 'TX', 'Utah': 'UT', 'Vermont': 'VT',
  'Virginia': 'VA', 'Washington': 'WA', 'West Virginia': 'WV', 'Wisconsin': 'WI', 'Wyoming': 'WY',
  
  // Canada
  'Alberta': 'AB', 'British Columbia': 'BC', 'Manitoba': 'MB', 'New Brunswick': 'NB',
  'Newfoundland and Labrador': 'NL', 'Northwest Territories': 'NT', 'Nova Scotia': 'NS',
  'Nunavut': 'NU', 'Ontario': 'ON', 'Prince Edward Island': 'PE', 'Quebec': 'QC',
  'Saskatchewan': 'SK', 'Yukon': 'YT'
};

async function mapLocations(unleashedWarehouses, shopifyLocations) {
  console.log('🗺️ === STARTING LOCATION MAPPING ===');
  console.log(`📊 Input data: ${unleashedWarehouses.length} Unleashed warehouses, ${shopifyLocations.length} Shopify locations`);

  const results = {
    toCreate: [],
    toUpdate: [],
    processed: 0,
    errors: [],
    mappingDetails: {
      unleashedWarehouses: unleashedWarehouses.length,
      shopifyLocations: shopifyLocations.length,
      countryMappings: {},
      provinceMappings: {},
      matchingLogic: []
    }
  };

  // Log all existing Shopify locations for reference
  console.log('📍 Existing Shopify locations:');
  shopifyLocations.forEach((loc, index) => {
    const warehouseCode = loc.metafields && loc.metafields['custom.warehouse_code'];
    console.log(`   ${index + 1}. "${loc.name}" (ID: ${loc.id}) - Warehouse Code: ${warehouseCode || 'None'}`);
  });

  try {
    console.log('\n🔄 Processing Unleashed warehouses...');
    
    for (const warehouse of unleashedWarehouses) {
      try {
        console.log(`\n📦 Processing warehouse: ${warehouse.WarehouseCode}`);
        console.log(`   Original data:`, {
          WarehouseCode: warehouse.WarehouseCode,
          WarehouseName: warehouse.WarehouseName,
          AddressLine1: warehouse.AddressLine1,
          AddressLine2: warehouse.AddressLine2,
          City: warehouse.City,
          Region: warehouse.Region,
          Country: warehouse.Country,
          PostCode: warehouse.PostCode,
          PhoneNumber: warehouse.PhoneNumber
        });

        // Generate location name (just the warehouse name)
        const locationName = warehouse.WarehouseName;
        console.log(`   🏷️ Generated location name: "${locationName}"`);

        // Map country code if present
        let mappedCountryCode = null;
        if (warehouse.Country) {
            mappedCountryCode = COUNTRY_CODE_MAPPING[warehouse.Country] || warehouse.Country;
            console.log(`   🌍 Country mapped: "${warehouse.Country}" → "${mappedCountryCode}"`);
        } else {
            console.log(`   🌍 Country unchanged: "null"`);
        }

        // Map province/state code if present
        let mappedProvinceCode = warehouse.Region;
        console.log(`   🏛️ Province unchanged: "${mappedProvinceCode}"`);

        console.log(`   🔍 Searching for matching Shopify location with warehouse code: "${warehouse.WarehouseCode}"`);

        // Match by warehouse code metafield instead of name
        const matchingLocation = shopifyLocations.find(loc => 
          loc.metafields && loc.metafields['custom.warehouse_code'] === warehouse.WarehouseCode
        );

        let matchResult = {
          warehouseCode: warehouse.WarehouseCode,
          generatedName: locationName,
          matchFound: !!matchingLocation,
          action: null
        };

        // Prepare location data
        const locationData = {
          name: locationName,
          address1: warehouse.AddressLine1 || 'Not specified',
          address2: warehouse.AddressLine2 || '',
          city: warehouse.City || 'Not specified',
          provinceCode: mappedProvinceCode,
          countryCode: mappedCountryCode || 'AU', // Default to AU if no country specified
          zip: warehouse.PostCode || '00000',
          phone: warehouse.PhoneNumber || '',
          warehouseCode: warehouse.WarehouseCode // For metafields
        };

        console.log(`   📋 Prepared location data:`, locationData);

        if (matchingLocation) {
          // Update existing location
          console.log(`   ✅ Match found! Existing location: "${matchingLocation.name}" (ID: ${matchingLocation.id})`);
          console.log(`   🔄 Will UPDATE existing location`);
          
          // Ensure location ID has the proper Shopify format
          const idString = String(matchingLocation.id);
          const locationId = idString.startsWith('gid://') 
            ? idString 
            : `gid://shopify/Location/${idString}`;
          
          locationData.id = locationId;
          results.toUpdate.push(locationData);
          matchResult.action = 'update';
          matchResult.existingLocationId = locationId;
          
          // Log the differences for updates
          console.log(`   📝 Comparing current vs new data:`);
          console.log(`      Name: "${matchingLocation.name}" → "${locationData.name}"`);
          if (matchingLocation.address) {
            console.log(`      Address1: "${matchingLocation.address.address1 || 'N/A'}" → "${locationData.address1}"`);
            console.log(`      City: "${matchingLocation.address.city || 'N/A'}" → "${locationData.city}"`);
            console.log(`      Province: "${matchingLocation.address.provinceCode || 'N/A'}" → "${locationData.provinceCode}"`);
            console.log(`      Country: "${matchingLocation.address.countryCode || 'N/A'}" → "${locationData.countryCode}"`);
            console.log(`      Zip: "${matchingLocation.address.zip || 'N/A'}" → "${locationData.zip}"`);
            console.log(`      Phone: "${matchingLocation.address.phone || 'N/A'}" → "${locationData.phone}"`);
          }
        } else {
          // Create new location
          console.log(`   ❌ No match found for warehouse code "${warehouse.WarehouseCode}"`);
          console.log(`   🆕 Will CREATE new location`);
          
          results.toCreate.push(locationData);
          matchResult.action = 'create';
        }

        results.mappingDetails.matchingLogic.push(matchResult);
        results.processed++;
        
        console.log(`   ✅ Warehouse "${warehouse.WarehouseCode}" processed successfully`);
        
      } catch (error) {
        console.error(`   ❌ Error processing warehouse "${warehouse.WarehouseCode}":`, error.message);
        results.errors.push({
          warehouseCode: warehouse.WarehouseCode,
          error: error.message
        });
      }
    }

    // Final summary logging
    console.log('\n🎯 === LOCATION MAPPING SUMMARY ===');
    console.log(`📊 Total processed: ${results.processed}/${unleashedWarehouses.length}`);
    console.log(`🆕 Locations to create: ${results.toCreate.length}`);
    console.log(`🔄 Locations to update: ${results.toUpdate.length}`);
    console.log(`❌ Errors encountered: ${results.errors.length}`);

    if (results.toCreate.length > 0) {
      console.log('\n🆕 NEW LOCATIONS TO CREATE:');
      results.toCreate.forEach((loc, index) => {
        console.log(`   ${index + 1}. "${loc.name}" at ${loc.address1}, ${loc.city}, ${loc.provinceCode}, ${loc.countryCode}`);
      });
    }

    if (results.toUpdate.length > 0) {
      console.log('\n🔄 EXISTING LOCATIONS TO UPDATE:');
      results.toUpdate.forEach((loc, index) => {
        console.log(`   ${index + 1}. "${loc.name}" (ID: ${loc.id}) at ${loc.address1}, ${loc.city}, ${loc.provinceCode}, ${loc.countryCode}`);
      });
    }

    if (results.errors.length > 0) {
      console.log('\n❌ ERRORS ENCOUNTERED:');
      results.errors.forEach((error, index) => {
        console.log(`   ${index + 1}. Warehouse "${error.warehouseCode}": ${error.error}`);
      });
    }

    // Log country mappings used
    const countryMappingsUsed = Object.keys(results.mappingDetails.countryMappings);
    if (countryMappingsUsed.length > 0) {
      console.log('\n🌍 COUNTRY MAPPINGS APPLIED:');
      countryMappingsUsed.forEach(original => {
        console.log(`   "${original}" → "${results.mappingDetails.countryMappings[original]}"`);
      });
    }

    // Log province mappings used
    const provinceMappingsUsed = Object.keys(results.mappingDetails.provinceMappings);
    if (provinceMappingsUsed.length > 0) {
      console.log('\n🏛️ PROVINCE/STATE MAPPINGS APPLIED:');
      provinceMappingsUsed.forEach(original => {
        console.log(`   "${original}" → "${results.mappingDetails.provinceMappings[original]}"`);
      });
    }

  } catch (error) {
    console.error('🚨 Critical error in location mapping:', error);
    throw new Error(`Location mapping failed: ${error.message}`);
  }

  console.log('🗺️ === LOCATION MAPPING COMPLETE ===\n');
  return results;
}

module.exports = {
  mapLocations,
  COUNTRY_CODE_MAPPING,
  PROVINCE_CODE_MAPPING
}; 