const COUNTRY_CODE_MAPPING = {
  'Australia': 'AU',
  'United States': 'US',
  'Canada': 'CA',
  'United Kingdom': 'GB',
  'New Zealand': 'NZ'
};

async function mapLocations(unleashedWarehouses, shopifyLocations) {
  const results = {
    toCreate: [],
    toUpdate: [],
    processed: 0,
    errors: []
  };

  try {
    for (const warehouse of unleashedWarehouses) {
      try {
        // Generate location name as per mapping rules
        const locationName = `${warehouse.WarehouseCode} - ${warehouse.WarehouseName}`;

        // Find matching Shopify location
        const matchingLocation = shopifyLocations.find(loc => 
          loc.name === locationName
        );

        // Prepare location data
        const locationData = {
          name: locationName,
          address1: warehouse.AddressLine1 || 'Not specified',
          address2: warehouse.AddressLine2 || '',
          city: warehouse.City || 'Not specified',
          province: warehouse.Region || '',
          country: COUNTRY_CODE_MAPPING[warehouse.Country] || warehouse.Country,
          zip: warehouse.PostCode || '00000',
          phone: warehouse.PhoneNumber || ''
        };

        if (matchingLocation) {
          // Update existing location
          locationData.id = matchingLocation.id;
          results.toUpdate.push(locationData);
        } else {
          // Create new location
          results.toCreate.push(locationData);
        }

        results.processed++;
      } catch (error) {
        results.errors.push({
          warehouseCode: warehouse.WarehouseCode,
          error: error.message
        });
      }
    }
  } catch (error) {
    throw new Error(`Location mapping failed: ${error.message}`);
  }

  return results;
}

module.exports = {
  mapLocations,
  COUNTRY_CODE_MAPPING
}; 