import { slugify, validateEmail } from './helpers.js';

async function mapCustomers(unleashedCustomers, shopifyCustomers) {
  console.log('👥 === STARTING CUSTOMER MAPPING ===');
  console.log(`📊 Input data: ${unleashedCustomers.length} Unleashed customers, ${shopifyCustomers.length} Shopify customers`);

  const results = {
    toCreate: [],
    toUpdate: [],
    processed: 0,
    errors: []
  };

  // Log all existing Shopify customers for reference
  console.log('👥 Existing Shopify customers:');
  shopifyCustomers.forEach((customer, index) => {
    const customerCode = customer.metafields?.['unleashed.unleashed_customer_code'];
    console.log(`   ${index + 1}. "${customer.firstName} ${customer.lastName}" (${customer.email}) (ID: ${customer.id}) - Customer Code: ${customerCode || 'None'}`);
  });

  try {
    console.log('\n🔄 Processing Unleashed customers...');
    
    for (const unleashedCustomer of unleashedCustomers) {
      try {
        console.log(`\n👤 Processing customer: ${unleashedCustomer.CustomerCode}`);
        console.log(`   Original data:`, {
          CustomerCode: unleashedCustomer.CustomerCode,
          CustomerName: unleashedCustomer.CustomerName,
          Email: unleashedCustomer.Email,
          ContactFirstName: unleashedCustomer.ContactFirstName,
          ContactLastName: unleashedCustomer.ContactLastName,
          PhoneNumber: unleashedCustomer.PhoneNumber,
          MobileNumber: unleashedCustomer.MobileNumber,
          SellPriceTier: unleashedCustomer.SellPriceTier
        });

        // Extract primary matching fields
        const email = unleashedCustomer.Email || `${unleashedCustomer.CustomerCode}@placeholder.com`;
        const firstName = unleashedCustomer.ContactFirstName || unleashedCustomer.CustomerName.split(' ')[0];
        const lastName = unleashedCustomer.ContactLastName || unleashedCustomer.CustomerName.split(' ').slice(1).join(' ');

        console.log(`   📧 Generated email: "${email}"`);
        console.log(`   👤 Generated name: "${firstName} ${lastName}"`);
        console.log(`   🔍 Searching for matching Shopify customer...`);

        // Find matching Shopify customer
        const matchingCustomer = shopifyCustomers.find(sc => 
          sc.email.toLowerCase() === email.toLowerCase() ||
          (sc.firstName + ' ' + sc.lastName).toLowerCase() === (firstName + ' ' + lastName).toLowerCase() ||
          sc.metafields?.['unleashed.unleashed_customer_code'] === unleashedCustomer.CustomerCode
        );

        if (matchingCustomer) {
          console.log(`   ✅ Match found! Existing customer: "${matchingCustomer.firstName} ${matchingCustomer.lastName}" (${matchingCustomer.email}) (ID: ${matchingCustomer.id})`);
          console.log(`   🔄 Will UPDATE existing customer`);
        } else {
          console.log(`   ❌ No match found for customer "${unleashedCustomer.CustomerCode}"`);
          console.log(`   🆕 Will CREATE new customer`);
        }

        // Prepare customer data
        const customerData = {
          firstName,
          lastName,
          email: validateEmail(email),
          phone: unleashedCustomer.PhoneNumber || unleashedCustomer.MobileNumber,
          metafields: [
            {
              namespace: 'unleashed',
              key: 'unleashed_customer_code',
              value: unleashedCustomer.CustomerCode,
              type: 'single_line_text_field'
            },
            {
              namespace: 'unleashed',
              key: 'unleashed_customer_name',
              value: unleashedCustomer.CustomerName,
              type: 'single_line_text_field'
            },
            {
              namespace: 'unleashed',
              key: 'unleashed_sell_price_tier',
              value: unleashedCustomer.SellPriceTier || 'Default',
              type: 'single_line_text_field'
            }
          ]
        };

        if (matchingCustomer) {
          // Update existing customer
          customerData.id = matchingCustomer.id;
          results.toUpdate.push(customerData);
        } else {
          // Create new customer
          results.toCreate.push(customerData);
        }

        results.processed++;
        console.log(`   ✅ Customer "${unleashedCustomer.CustomerCode}" processed successfully`);
        
      } catch (error) {
        console.error(`   ❌ Error processing customer "${unleashedCustomer.CustomerCode}":`, error.message);
        results.errors.push({
          customerCode: unleashedCustomer.CustomerCode,
          error: error.message
        });
      }
    }

    // Final summary logging
    console.log('\n🎯 === CUSTOMER MAPPING SUMMARY ===');
    console.log(`📊 Total processed: ${results.processed}/${unleashedCustomers.length}`);
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
        console.log(`   ${index + 1}. Customer "${error.customerCode}": ${error.error}`);
      });
    }

  } catch (error) {
    console.error('🚨 Critical error in customer mapping:', error);
    throw new Error(`Customer mapping failed: ${error.message}`);
  }

  console.log('👥 === CUSTOMER MAPPING COMPLETE ===\n');
  return results;
}

export { mapCustomers }; 