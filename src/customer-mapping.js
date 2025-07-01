import { slugify, validateEmail } from './helpers.js';

async function mapCustomers(unleashedCustomers, shopifyCustomers) {
  const results = {
    toCreate: [],
    toUpdate: [],
    processed: 0,
    errors: []
  };

  try {
    for (const unleashedCustomer of unleashedCustomers) {
      try {
        // Extract primary matching fields
        const email = unleashedCustomer.Email || `${unleashedCustomer.CustomerCode}@placeholder.com`;
        const firstName = unleashedCustomer.ContactFirstName || unleashedCustomer.CustomerName.split(' ')[0];
        const lastName = unleashedCustomer.ContactLastName || unleashedCustomer.CustomerName.split(' ').slice(1).join(' ');

        // Find matching Shopify customer
        const matchingCustomer = shopifyCustomers.find(sc => 
          sc.email.toLowerCase() === email.toLowerCase() ||
          (sc.firstName + ' ' + sc.lastName).toLowerCase() === (firstName + ' ' + lastName).toLowerCase() ||
          sc.metafields?.find(m => m.key === 'unleashed_customer_code' && m.value === unleashedCustomer.CustomerCode)
        );

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
      } catch (error) {
        results.errors.push({
          customerCode: unleashedCustomer.CustomerCode,
          error: error.message
        });
      }
    }
  } catch (error) {
    throw new Error(`Customer mapping failed: ${error.message}`);
  }

  return results;
}

export { mapCustomers }; 