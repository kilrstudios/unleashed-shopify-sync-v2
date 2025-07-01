!function(e,t){"use strict";
    // Configuration object
    const config = {
        workerUrl: "https://unleashed-shopify-sync-v2.adrian-b0e.workers.dev/api/v2/sync-locations", // Use sync endpoint by default
        mutationUrl: "https://unleashed-shopify-sync-v2.adrian-b0e.workers.dev/api/v2/mutate-locations",
        syncUrl: "https://unleashed-shopify-sync-v2.adrian-b0e.workers.dev/api/v2/comprehensive-sync",
        buttonAttribute: "kilr-unleashed-sync",
        mutateButtonAttribute: "kilr-unleashed-mutate-locations",
        syncButtonAttribute: "kilr-unleashed-sync-locations",
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
                button.textContent = "Processing...";
                break;
            case "success":
                button.classList.add(config.successClass);
                button.textContent = "Complete";
                setTimeout(() => {
                    button.classList.remove(config.successClass);
                    button.textContent = originalText;
                }, 2000);
                break;
            case "error":
                button.classList.add(config.errorClass);
                button.textContent = "Failed";
                setTimeout(() => {
                    button.classList.remove(config.errorClass);
                    button.textContent = originalText;
                }, 2000);
                break;
        }
    }

    // Handle sync (complete workflow - mapping + mutations)
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

        // Make the request to the complete sync endpoint
        fetch(config.syncUrl, {
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
                // Handle sync response (includes both mapping and mutation results)
                const mapping = data.mappingResults;
                const mutations = data.mutationResults;
                
                showNotification(
                    `Sync complete! Locations: ${mutations.successCount} processed, ${mutations.errors.length} errors`,
                    mutations.errors.length > 0 ? "error" : "success"
                );
                updateButtonState(button, mutations.errors.length > 0 ? "error" : "success");

                // Log the complete sync results
                if (data.mappingResults && data.mutationResults) {
                    logSyncResults(data);
                }
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

    // Handle location mutations
    function handleLocationMutations(event) {
        event.preventDefault();
        const button = event.currentTarget;
        console.log('Handle location mutations called for button:', button);
        
        if (button.classList.contains(config.loadingClass)) {
            console.log('Button is already in loading state, ignoring click');
            return;
        }

        // Get the current domain
        const domain = window.location.hostname;
        console.log('Current domain:', domain);

        // Prepare the request data
        const requestData = { domain };
        console.log('Mutation request data:', requestData);

        // Update button state
        updateButtonState(button, "loading");
        button.textContent = "Mutating Locations...";

        // Make the request
        fetch(config.mutationUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Accept": "application/json"
            },
            body: JSON.stringify(requestData)
        })
        .then(response => {
            console.log('Mutation response received:', response);
            return response.json().then(data => {
                if (!response.ok) {
                    throw new Error(data.error || 'Location mutation failed');
                }
                return data;
            });
        })
        .then(data => {
            console.log('Mutation data received:', data);
            if (data.success) {
                const summary = data.mutationResults.summary;
                const message = `Location mutations completed! ${summary.createdCount} created, ${summary.updatedCount} updated. Total: ${summary.totalSuccessful} successful, ${summary.totalFailed} failed. Duration: ${summary.duration}`;
                
                showNotification(message, "success");
                updateButtonState(button, "success");

                // Log detailed mutation results
                logMutationResults(data);
            } else {
                throw new Error(data.error || 'Location mutation failed');
            }
        })
        .catch(error => {
            console.error('Location mutation error:', error);
            showNotification(error.message || "Failed to mutate locations", "error");
            updateButtonState(button, "error");
        });
    }

    // Handle complete location sync (map + mutate)
    function handleLocationSync(event) {
        event.preventDefault();
        const button = event.currentTarget;
        console.log('Handle location sync called for button:', button);
        
        if (button.classList.contains(config.loadingClass)) {
            console.log('Button is already in loading state, ignoring click');
            return;
        }

        // Get the current domain
        const domain = window.location.hostname;
        console.log('Current domain:', domain);

        // Prepare the request data
        const requestData = { domain };
        console.log('Sync request data:', requestData);

        // Update button state
        updateButtonState(button, "loading");
        button.textContent = "Syncing Locations...";

        // Make the request
        fetch(config.syncUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Accept": "application/json"
            },
            body: JSON.stringify(requestData)
        })
        .then(response => {
            console.log('Sync response received:', response);
            return response.json().then(data => {
                if (!response.ok) {
                    throw new Error(data.error || 'Location sync failed');
                }
                return data;
            });
        })
        .then(data => {
            console.log('Sync data received:', data);
            if (data.success) {
                const summary = data.mutationResults.summary;
                const mappingResults = data.mappingResults;
                
                let message = `Location sync completed! `;
                message += `Mapped: ${mappingResults.toCreate} to create, ${mappingResults.toUpdate} to update. `;
                message += `Executed: ${summary.createdCount} created, ${summary.updatedCount} updated. `;
                message += `Duration: ${summary.duration}`;
                
                showNotification(message, "success");
                updateButtonState(button, "success");

                // Log detailed sync results
                logSyncResults(data);
            } else {
                throw new Error(data.error || 'Location sync failed');
            }
        })
        .catch(error => {
            console.error('Location sync error:', error);
            showNotification(error.message || "Failed to sync locations", "error");
            updateButtonState(button, "error");
        });
    }

    // Log mutation results
    function logMutationResults(data) {
        console.log('🎯 === LOCATION MUTATION RESULTS ===');
        console.log('Mapping Summary:', data.mappingResults);
        console.log('Mutation Summary:', data.mutationResults.summary);
        
        if (data.mutationResults.created.successful > 0) {
            console.log('✅ Successfully created locations:', data.mutationResults.created.successful);
        }
        
        if (data.mutationResults.updated.successful > 0) {
            console.log('🔄 Successfully updated locations:', data.mutationResults.updated.successful);
        }
        
        if (data.mutationResults.created.failed > 0 || data.mutationResults.updated.failed > 0) {
            console.log('❌ Failed operations:', {
                createdFailed: data.mutationResults.created.failed,
                updatedFailed: data.mutationResults.updated.failed
            });
        }
        
        console.log('🎯 === END MUTATION RESULTS ===');
    }

    // Log complete sync results
    function logSyncResults(data) {
        console.log('🔄 === LOCATION SYNC RESULTS ===');
        console.log('Workflow:', data.workflow);
        console.log('Mapping Summary:', data.mappingResults);
        console.log('Mutation Summary:', data.mutationResults.summary);
        
        if (data.mappingResults.details) {
            console.log('📊 Mapping Details:', data.mappingResults.details);
        }
        
        if (data.mutationResults.summary.totalSuccessful > 0) {
            console.log('✅ Total successful operations:', data.mutationResults.summary.totalSuccessful);
            console.log(`   Created: ${data.mutationResults.summary.createdCount}`);
            console.log(`   Updated: ${data.mutationResults.summary.updatedCount}`);
        }
        
        if (data.mutationResults.summary.totalFailed > 0) {
            console.log('❌ Total failed operations:', data.mutationResults.summary.totalFailed);
        }
        
        console.log('🔄 === END SYNC RESULTS ===');
    }

    // Initialize buttons
    function initializeButtons() {
        console.log('Initializing unleashed sync buttons...');
        
        // Initialize sync buttons
        const syncButtons = t.querySelectorAll(`[${config.buttonAttribute}]`);
        console.log('Found sync buttons:', syncButtons.length);
        
        syncButtons.forEach(button => {
            console.log('Setting up sync button:', button);
            button.removeEventListener("click", handleSync);
            button.addEventListener("click", handleSync);
        });

        // Initialize mutation buttons  
        const mutationButtons = t.querySelectorAll(`[${config.mutateButtonAttribute}]`);
        console.log('Found mutation buttons:', mutationButtons.length);
        
        mutationButtons.forEach(button => {
            console.log('Setting up mutation button:', button);
            button.removeEventListener("click", handleLocationMutations);
            button.addEventListener("click", handleLocationMutations);
        });

        // Initialize complete sync buttons  
        const completeButtons = t.querySelectorAll(`[${config.syncButtonAttribute}]`);
        console.log('Found complete sync buttons:', completeButtons.length);
        
        completeButtons.forEach(button => {
            console.log('Setting up complete sync button:', button);
            button.removeEventListener("click", handleLocationSync);
            button.addEventListener("click", handleLocationSync);
        });
    }

    // Initialize on DOM ready and watch for changes
    function init() {
        if (t.readyState === 'loading') {
            t.addEventListener("DOMContentLoaded", initializeButtons);
        } else {
            initializeButtons();
        }

        // Watch for DOM changes - but only for new buttons, not all changes
        const observer = new MutationObserver((mutations) => {
            let shouldReinitialize = false;
            mutations.forEach((mutation) => {
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType === 1) { // Element node
                        // Check if the added node is a button or contains buttons
                        if (node.matches && (
                            node.matches(`[${config.buttonAttribute}]`) || 
                            node.matches(`[${config.mutateButtonAttribute}]`) ||
                            node.matches(`[${config.syncButtonAttribute}]`)
                        )) {
                            shouldReinitialize = true;
                        } else if (node.querySelector) {
                            const hasButtons = node.querySelector(`[${config.buttonAttribute}]`) || 
                                             node.querySelector(`[${config.mutateButtonAttribute}]`) ||
                                             node.querySelector(`[${config.syncButtonAttribute}]`);
                            if (hasButtons) {
                                shouldReinitialize = true;
                            }
                        }
                    }
                });
            });
            
            if (shouldReinitialize) {
                initializeButtons();
            }
        });
        
        observer.observe(t.body, {
            childList: true,
            subtree: true
        });
    }

    // Ensure the environment is ready
    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
        init();
    } else {
        // If window/document not available yet (e.g. in Webstudio), wait for them
        setTimeout(function checkEnvironment() {
            if (typeof window !== 'undefined' && typeof document !== 'undefined') {
                init();
            } else {
                setTimeout(checkEnvironment, 50);
            }
        }, 50);
    }

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
        // Ensure results object has the required structure
        const safeResults = {
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
            },
            ...results
        };

        // Style definitions for console output
        const styles = {
            create: 'color: #4CAF50; font-weight: bold',  // Green
            update: 'color: #2196F3; font-weight: bold',  // Blue
            archive: 'color: #F44336; font-weight: bold', // Red
            header: 'color: #9C27B0; font-weight: bold'   // Purple
        };

        // Log customers
        console.group('%cCustomer Mapping Results', styles.header);
        
        if (safeResults.customers.toCreate?.length) {
            console.group('%cCustomers to Create:', styles.create);
            safeResults.customers.toCreate.forEach(customer => 
                console.table([formatCustomerForLog(customer)])
            );
            console.groupEnd();
        }

        if (safeResults.customers.toUpdate?.length) {
            console.group('%cCustomers to Update:', styles.update);
            safeResults.customers.toUpdate.forEach(customer => 
                console.table([formatCustomerForLog(customer)])
            );
            console.groupEnd();
        }

        if (safeResults.customers.errors?.length) {
            console.group('%cCustomer Errors:', styles.archive);
            console.table(safeResults.customers.errors);
            console.groupEnd();
        }

        console.groupEnd();

        // Log locations
        console.group('%cLocation Mapping Results', styles.header);
        
        if (safeResults.locations.toCreate?.length) {
            console.group('%cLocations to Create:', styles.create);
            safeResults.locations.toCreate.forEach(location => 
                console.table([formatLocationForLog(location)])
            );
            console.groupEnd();
        }

        if (safeResults.locations.toUpdate?.length) {
            console.group('%cLocations to Update:', styles.update);
            safeResults.locations.toUpdate.forEach(location => 
                console.table([formatLocationForLog(location)])
            );
            console.groupEnd();
        }

        if (safeResults.locations.errors?.length) {
            console.group('%cLocation Errors:', styles.archive);
            console.table(safeResults.locations.errors);
            console.groupEnd();
        }

        console.groupEnd();

        // Log products
        console.group('%cProduct Mapping Results', styles.header);
        
        if (safeResults.products.toCreate?.length) {
            console.group('%cProducts to Create:', styles.create);
            safeResults.products.toCreate.forEach(product => 
                console.table([formatProductForLog(product)])
            );
            console.groupEnd();
        }

        if (safeResults.products.toUpdate?.length) {
            console.group('%cProducts to Update:', styles.update);
            safeResults.products.toUpdate.forEach(product => 
                console.table([formatProductForLog(product)])
            );
            console.groupEnd();
        }

        if (safeResults.products.toArchive?.length) {
            console.group('%cProducts to Archive:', styles.archive);
            safeResults.products.toArchive.forEach(product => 
                console.table([formatProductForLog(product)])
            );
            console.groupEnd();
        }

        if (safeResults.products.errors?.length) {
            console.group('%cProduct Errors:', styles.archive);
            console.table(safeResults.products.errors);
            console.groupEnd();
        }

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
}(window, document); // Cache bust: Tue Jul  1 17:05:13 AEST 2025
