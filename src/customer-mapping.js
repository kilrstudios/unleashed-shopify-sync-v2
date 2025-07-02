import { slugify, validateEmail } from './helpers.js';

async function mapCustomers(unleashedContacts, unleashedCustomers, shopifyCustomers) {
  console.log('👥 === STARTING CUSTOMER MAPPING ===');
  console.log(`📊 Input data: ${unleashedContacts.length} Unleashed contacts, ${unleashedCustomers.length} Unleashed customers, ${shopifyCustomers.length} Shopify customers`);

  const results = {
    toCreate: [],
    toUpdate: [],
    processed: 0,
    errors: []
  };

  // Log all existing Shopify customers for reference
  console.log('👥 Existing Shopify customers:');
  shopifyCustomers.forEach((customer, index) => {
    const customerCode = customer.metafields?.['unleashed.customer_code'];
    console.log(`   ${index + 1}. "${customer.firstName} ${customer.lastName}" (${customer.email}) (ID: ${customer.id}) - Customer Code: ${customerCode || 'None'}`);
  });

  // Create a lookup map for Unleashed customers by their ID/code for efficient lookup
  const customerLookup = new Map();
  unleashedCustomers.forEach(customer => {
    customerLookup.set(customer.Guid, customer);
    customerLookup.set(customer.CustomerCode, customer);
  });

  try {
    console.log('\n🔄 Processing Unleashed contacts...');
    
    for (const unleashedContact of unleashedContacts) {
      try {
        console.log(`\n👤 Processing contact: ${unleashedContact.Guid}`);
        console.log(`   RAW CONTACT DATA:`, JSON.stringify(unleashedContact, null, 2));
        console.log(`   Original contact data:`, {
          Guid: unleashedContact.Guid,
          FirstName: unleashedContact.FirstName,
          LastName: unleashedContact.LastName,
          EmailAddress: unleashedContact.EmailAddress,
          OfficePhone: unleashedContact.OfficePhone,
          MobilePhone: unleashedContact.MobilePhone,
          CustomerGuid: unleashedContact.CustomerGuid,
          CustomerCode: unleashedContact.CustomerCode,
          CustomerName: unleashedContact.CustomerName
        });

        // The associated customer data is already attached to the contact
        console.log(`   🏢 Associated customer: "${unleashedContact.CustomerName}" (${unleashedContact.CustomerCode})`);

        // Extract primary matching fields from contact
        const email = unleashedContact.EmailAddress || `contact-${unleashedContact.Guid}@placeholder.com`;
        const firstName = unleashedContact.FirstName || 'Unknown';
        const lastName = unleashedContact.LastName || 'Contact';

        console.log(`   📧 Generated email: "${email}"`);
        console.log(`   👤 Generated name: "${firstName} ${lastName}"`);
        console.log(`   🔍 Searching for matching Shopify customer...`);

        // Find matching Shopify customer
        const matchingCustomer = shopifyCustomers.find(sc => 
          sc.email.toLowerCase() === email.toLowerCase() ||
          (sc.firstName + ' ' + sc.lastName).toLowerCase() === (firstName + ' ' + lastName).toLowerCase() ||
          sc.metafields?.['unleashed.contact_guid'] === unleashedContact.Guid
        );

        if (matchingCustomer) {
          console.log(`   ✅ Match found! Existing customer: "${matchingCustomer.firstName} ${matchingCustomer.lastName}" (${matchingCustomer.email}) (ID: ${matchingCustomer.id})`);
          console.log(`   🔄 Will UPDATE existing customer`);
        } else {
          console.log(`   ❌ No match found for contact "${unleashedContact.Guid}"`);
          console.log(`   🆕 Will CREATE new customer`);
        }

        // Prepare customer data (from contact + associated customer metafields)
        const customerData = {
          firstName,
          lastName,
          email: validateEmail(email),
          phone: unleashedContact.OfficePhone || unleashedContact.MobilePhone,
          metafields: [
            {
              namespace: 'unleashed',
              key: 'contact_guid',
              value: unleashedContact.Guid,
              type: 'single_line_text_field'
            }
          ]
        };

        // Add associated customer data as metafields if available
        if (unleashedContact.CustomerCode && unleashedContact.CustomerName) {
          customerData.metafields.push(
            {
              namespace: 'unleashed',
              key: 'customer_code',
              value: unleashedContact.CustomerCode,
              type: 'single_line_text_field'
            },
            {
              namespace: 'unleashed',
              key: 'customer_name',
              value: unleashedContact.CustomerName,
              type: 'single_line_text_field'
            }
          );
          
          // Get the full customer data to access SellPriceTier
          const fullCustomerData = customerLookup.get(unleashedContact.CustomerGuid);
          if (fullCustomerData) {
                         customerData.metafields.push({
               namespace: 'unleashed',
               key: 'sell_price_tier',
               value: fullCustomerData.SellPriceTier || 'Default',
               type: 'single_line_text_field'
             });
          }
          
          console.log(`   🏢 Adding customer metafields: ${unleashedContact.CustomerCode} - ${unleashedContact.CustomerName}`);
        }

        if (matchingCustomer) {
          // Check if update is needed
          const comparison = compareCustomerData(customerData, matchingCustomer);
          
          if (comparison.hasChanges) {
            console.log(`   🔄 Changes detected - will UPDATE customer:`);
            comparison.differences.forEach(diff => console.log(`      - ${diff}`));
            
            // Update existing customer
            customerData.id = matchingCustomer.id;
            results.toUpdate.push(customerData);
          } else {
            console.log(`   ✨ No changes needed - skipping update`);
          }
        } else {
          // Create new customer
          results.toCreate.push(customerData);
        }

        results.processed++;
        console.log(`   ✅ Contact "${unleashedContact.Guid}" processed successfully`);
        
      } catch (error) {
        console.error(`   ❌ Error processing contact "${unleashedContact.Guid}":`, error.message);
        results.errors.push({
          contactGuid: unleashedContact.Guid,
          error: error.message
        });
      }
    }

    // Final summary logging
    console.log('\n🎯 === CUSTOMER MAPPING SUMMARY ===');
    console.log(`📊 Total processed: ${results.processed}/${unleashedContacts.length}`);
    console.log(`🆕 Customers to create: ${results.toCreate.length}`);
    console.log(`🔄 Customers to update: ${results.toUpdate.length}`);
    console.log(`❌ Errors encountered: ${results.errors.length}`);

    if (results.toCreate.length > 0) {
      console.log('\n🆕 NEW CUSTOMERS TO CREATE:');
      results.toCreate.forEach((customer, index) => {
        console.log(`   ${index + 1}. "${customer.firstName} ${customer.lastName}" (${customer.email})`);
      });
    }

    if (results.toUpdate.length > 0) {
      console.log('\n🔄 EXISTING CUSTOMERS TO UPDATE:');
      results.toUpdate.forEach((customer, index) => {
        console.log(`   ${index + 1}. "${customer.firstName} ${customer.lastName}" (${customer.email}) (ID: ${customer.id})`);
      });
    }

    if (results.errors.length > 0) {
      console.log('\n❌ ERRORS ENCOUNTERED:');
      results.errors.forEach((error, index) => {
        console.log(`   ${index + 1}. Contact "${error.contactGuid}": ${error.error}`);
      });
    }

  } catch (error) {
    console.error('🚨 Critical error in customer mapping:', error);
    throw new Error(`Customer mapping failed: ${error.message}`);
  }

  console.log('👥 === CUSTOMER MAPPING COMPLETE ===\n');
  return results;
}

// Compare customer data to determine if update is needed
function compareCustomerData(unleashedData, shopifyCustomer) {
  const differences = [];
  
  // Compare basic customer fields
  if (unleashedData.firstName !== shopifyCustomer.firstName) {
    differences.push(`firstName: "${shopifyCustomer.firstName}" → "${unleashedData.firstName}"`);
  }
  
  if (unleashedData.lastName !== shopifyCustomer.lastName) {
    differences.push(`lastName: "${shopifyCustomer.lastName}" → "${unleashedData.lastName}"`);
  }
  
  if (unleashedData.email.toLowerCase() !== shopifyCustomer.email.toLowerCase()) {
    differences.push(`email: "${shopifyCustomer.email}" → "${unleashedData.email}"`);
  }
  
  if (unleashedData.phone !== shopifyCustomer.phone) {
    differences.push(`phone: "${shopifyCustomer.phone}" → "${unleashedData.phone}"`);
  }
  
  // Compare metafields
  const shopifyMetafields = shopifyCustomer.metafields || {};
  for (const metafield of unleashedData.metafields) {
    const currentValue = shopifyMetafields[`${metafield.namespace}.${metafield.key}`];
    if (currentValue !== metafield.value) {
      differences.push(`${metafield.namespace}.${metafield.key}: "${currentValue || 'None'}" → "${metafield.value}"`);
    }
  }
  
  return {
    hasChanges: differences.length > 0,
    differences: differences
  };
}

export { mapCustomers }; 