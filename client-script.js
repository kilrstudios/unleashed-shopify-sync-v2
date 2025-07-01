!function(e,t){"use strict";
    // Configuration object
    const config = {
        workerUrl: "https://unleashed-shopify-sync-v2.adrian-b0e.workers.dev/api/v2/data-fetch",
        buttonAttribute: "kilr-unleashed-sync",
        loadingClass: "kilr-sync-loading",
        successClass: "kilr-sync-success",
        errorClass: "kilr-sync-error"
    };

    // Create and append styles
    const styleElement = t.createElement("style");
    styleElement.textContent = `
        .${config.loadingClass} {
            opacity: 0.7;
            cursor: not-allowed;
            position: relative;
        }
        .${config.loadingClass}::after {
            content: '';
            position: absolute;
            width: 16px;
            height: 16px;
            top: 50%;
            right: 10px;
            transform: translateY(-50%);
            border: 2px solid #fff;
            border-radius: 50%;
            border-top-color: transparent;
            animation: kilr-spin 1s linear infinite;
        }
        .${config.successClass} {
            background-color: #4CAF50 !important;
            border-color: #45a049 !important;
        }
        .${config.errorClass} {
            background-color: #f44336 !important;
            border-color: #da190b !important;
        }
        @keyframes kilr-spin {
            to { transform: translateY(-50%) rotate(360deg); }
        }
        @keyframes kilr-notification {
            from { opacity: 0; transform: translateX(100%); }
            to { opacity: 1; transform: translateX(0); }
        }
        @keyframes kilr-notification-out {
            from { opacity: 1; transform: translateX(0); }
            to { opacity: 0; transform: translateX(100%); }
        }
    `;
    t.head.appendChild(styleElement);

    // Show notification
    function showNotification(message, type) {
        console.log('Showing notification:', message, type);
        
        if (e.shopify && e.shopify.toast) {
            e.shopify.toast.show(message);
            return;
        }

        const notification = t.createElement("div");
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 16px 24px;
            background: ${type === "error" ? "#f44336" : type === "success" ? "#4CAF50" : "#2196F3"};
            color: white;
            border-radius: 4px;
            box-shadow: 0 2px 5px rgba(0,0,0,0.2);
            z-index: 10000;
            animation: kilr-notification 0.3s ease-out;
        `;
        notification.textContent = message;
        t.body.appendChild(notification);

        setTimeout(() => {
            notification.style.animation = "kilr-notification-out 0.3s ease-in forwards";
            setTimeout(() => notification.remove(), 300);
        }, 5000);
    }

    // Update button state
    function updateButtonState(button, state) {
        console.log('Updating button state:', state);
        
        button.classList.remove(config.loadingClass, config.successClass, config.errorClass);
        const originalText = button.getAttribute("data-original-text");

        switch (state) {
            case "loading":
                if (!originalText) {
                    button.setAttribute("data-original-text", button.textContent);
                }
                button.classList.add(config.loadingClass);
                button.textContent = "Syncing...";
                break;
            case "success":
                button.classList.add(config.successClass);
                button.textContent = "Sync Complete";
                setTimeout(() => {
                    button.classList.remove(config.successClass);
                    button.textContent = originalText;
                }, 2000);
                break;
            case "error":
                button.classList.add(config.errorClass);
                button.textContent = "Sync Failed";
                setTimeout(() => {
                    button.classList.remove(config.errorClass);
                    button.textContent = originalText;
                }, 2000);
                break;
        }
    }

    // Handle sync
    function handleSync(event) {
        event.preventDefault();
        const button = event.currentTarget;
        console.log('Handle sync called for button:', button);
        
        if (button.classList.contains(config.loadingClass)) {
            console.log('Button is already in loading state, ignoring click');
            return;
        }

        // Get the current domain
        const domain = window.location.hostname;
        console.log('Current domain:', domain);

        // Prepare the request data
        const requestData = { domain };
        console.log('Request data:', requestData);

        // Update button state
        updateButtonState(button, "loading");

        // Make the request
        fetch(config.workerUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Accept": "application/json"
            },
            body: JSON.stringify(requestData)
        })
        .then(response => {
            console.log('Response received:', response);
            return response.json().then(data => {
                if (!response.ok) {
                    throw new Error(data.error || 'Sync failed');
                }
                return data;
            });
        })
        .then(data => {
            console.log('Data received:', data);
            if (data.success) {
                const stats = data.data;
                const unleashedStats = {
                    products: stats.unleashed.products.length,
                    customers: stats.unleashed.customers.length,
                    warehouses: stats.unleashed.warehouses.length
                };
                const shopifyStats = {
                    products: stats.shopify.products.length,
                    customers: stats.shopify.customers.length,
                    locations: stats.shopify.locations.length
                };
                showNotification(
                    `Successfully synced data. Unleashed: ${unleashedStats.products} products, ${unleashedStats.customers} customers, ${unleashedStats.warehouses} warehouses. Shopify: ${shopifyStats.products} products, ${shopifyStats.customers} customers, ${shopifyStats.locations} locations.`,
                    "success"
                );
                updateButtonState(button, "success");

                // Log the mapping results
                logMappingResults({
                    customers: stats.unleashed.customers,
                    products: stats.unleashed.products
                });
            } else {
                throw new Error(data.error || 'Sync failed');
            }
        })
        .catch(error => {
            console.error('Sync error:', error);
            showNotification(error.message || "Failed to sync data", "error");
            updateButtonState(button, "error");
        });
    }

    // Initialize buttons
    function initializeButtons() {
        console.log('Initializing sync buttons');
        const buttons = t.querySelectorAll(`[${config.buttonAttribute}="button"]`);
        console.log('Found buttons:', buttons.length);
        
        buttons.forEach(button => {
            if (!button.hasAttribute("data-kilr-initialized")) {
                console.log('Initializing button:', button);
                button.setAttribute("data-kilr-initialized", "true");
                // Remove any existing click handlers
                button.removeEventListener("click", handleSync);
                // Add the click handler
                button.addEventListener("click", handleSync);
            }
        });
    }

    // Initialize on DOM ready and watch for changes
    if (t.readyState === 'loading') {
        t.addEventListener("DOMContentLoaded", initializeButtons);
    } else {
        initializeButtons();
    }

    // Watch for DOM changes
    new MutationObserver(initializeButtons).observe(t.body, {
        childList: true,
        subtree: true
    });

    // Export configuration function
    e.configureUnleashedSync = function(newConfig) {
        Object.assign(config, newConfig);
    };

    function formatCustomerForLog(customer) {
        return {
            action: customer.id ? 'UPDATE' : 'CREATE',
            id: customer.id || 'NEW',
            email: customer.email,
            name: `${customer.firstName} ${customer.lastName}`,
            phone: customer.phone,
            unleashed_code: customer.metafields.find(m => m.key === 'unleashed_customer_code')?.value
        };
    }

    function formatLocationForLog(location) {
        return {
            action: location.id ? 'UPDATE' : 'CREATE',
            id: location.id || 'NEW',
            name: location.name,
            address: `${location.address1}, ${location.city}, ${location.country}`,
            phone: location.phone
        };
    }

    function formatProductForLog(product) {
        return {
            action: product.status === 'ARCHIVED' ? 'ARCHIVE' : (product.id ? 'UPDATE' : 'CREATE'),
            id: product.id || 'NEW',
            handle: product.handle,
            title: product.title,
            variants: product.variants?.map(v => ({
                sku: v.sku,
                title: v.title,
                price: v.price
            })) || [],
            status: product.status
        };
    }

    function logMappingResults(results) {
        // Style definitions for console output
        const styles = {
            create: 'color: #4CAF50; font-weight: bold',  // Green
            update: 'color: #2196F3; font-weight: bold',  // Blue
            archive: 'color: #F44336; font-weight: bold', // Red
            header: 'color: #9C27B0; font-weight: bold'   // Purple
        };

        // Log customers
        if (results.customers) {
            console.group('%cCustomer Mapping Results', styles.header);
            
            if (results.customers.toCreate.length) {
                console.group('%cCustomers to Create:', styles.create);
                results.customers.toCreate.forEach(customer => 
                    console.table([formatCustomerForLog(customer)])
                );
                console.groupEnd();
            }

            if (results.customers.toUpdate.length) {
                console.group('%cCustomers to Update:', styles.update);
                results.customers.toUpdate.forEach(customer => 
                    console.table([formatCustomerForLog(customer)])
                );
                console.groupEnd();
            }

            if (results.customers.errors.length) {
                console.group('%cCustomer Errors:', styles.archive);
                console.table(results.customers.errors);
                console.groupEnd();
            }

            console.groupEnd();
        }

        // Log locations
        if (results.locations) {
            console.group('%cLocation Mapping Results', styles.header);
            
            if (results.locations.toCreate.length) {
                console.group('%cLocations to Create:', styles.create);
                results.locations.toCreate.forEach(location => 
                    console.table([formatLocationForLog(location)])
                );
                console.groupEnd();
            }

            if (results.locations.toUpdate.length) {
                console.group('%cLocations to Update:', styles.update);
                results.locations.toUpdate.forEach(location => 
                    console.table([formatLocationForLog(location)])
                );
                console.groupEnd();
            }

            if (results.locations.errors.length) {
                console.group('%cLocation Errors:', styles.archive);
                console.table(results.locations.errors);
                console.groupEnd();
            }

            console.groupEnd();
        }

        // Log products
        if (results.products) {
            console.group('%cProduct Mapping Results', styles.header);
            
            if (results.products.toCreate.length) {
                console.group('%cProducts to Create:', styles.create);
                results.products.toCreate.forEach(product => {
                    console.group(`%c${product.title}`, styles.create);
                    console.table([formatProductForLog(product)]);
                    console.table(product.variants);
                    console.groupEnd();
                });
                console.groupEnd();
            }

            if (results.products.toUpdate.length) {
                console.group('%cProducts to Update:', styles.update);
                results.products.toUpdate.forEach(product => {
                    console.group(`%c${product.title}`, styles.update);
                    console.table([formatProductForLog(product)]);
                    console.table(product.variants);
                    console.groupEnd();
                });
                console.groupEnd();
            }

            if (results.products.toArchive.length) {
                console.group('%cProducts to Archive:', styles.archive);
                results.products.toArchive.forEach(product => 
                    console.table([formatProductForLog(product)])
                );
                console.groupEnd();
            }

            if (results.products.errors.length) {
                console.group('%cProduct Errors:', styles.archive);
                console.table(results.products.errors);
                console.groupEnd();
            }

            console.groupEnd();
        }

        // Log summary
        console.group('%cSummary', styles.header);
        console.table({
            customers: {
                toCreate: results.customers?.toCreate.length || 0,
                toUpdate: results.customers?.toUpdate.length || 0,
                errors: results.customers?.errors.length || 0
            },
            locations: {
                toCreate: results.locations?.toCreate.length || 0,
                toUpdate: results.locations?.toUpdate.length || 0,
                errors: results.locations?.errors.length || 0
            },
            products: {
                toCreate: results.products?.toCreate.length || 0,
                toUpdate: results.products?.toUpdate.length || 0,
                toArchive: results.products?.toArchive.length || 0,
                errors: results.products?.errors.length || 0
            }
        });
        console.groupEnd();
    }

    // Example usage:
    window.logMappingResults = logMappingResults;

    /* Example format of results object:
    const results = {
        customers: {
            toCreate: [],
            toUpdate: [],
            errors: []
        },
        locations: {
            toCreate: [],
            toUpdate: [],
            errors: []
        },
        products: {
            toCreate: [],
            toUpdate: [],
            toArchive: [],
            errors: []
        }
    };
    */
}(window, document); 