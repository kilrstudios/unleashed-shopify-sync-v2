function slugify(text) {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')           // Replace spaces with -
    .replace(/[^\w\-]+/g, '')       // Remove all non-word chars
    .replace(/\-\-+/g, '-')         // Replace multiple - with single -
    .replace(/^-+/, '')             // Trim - from start of text
    .replace(/-+$/, '');            // Trim - from end of text
}

function validateEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (emailRegex.test(email)) {
    return email;
  }
  throw new Error(`Invalid email format: ${email}`);
}

// Returns the tenant-wide default warehouse code following a best-effort strategy.
// 1. Warehouse object explicitly flagged with IsDefault === true (preferred)
// 2. Warehouse whose WarehouseCode === "MAIN" (commonly used)
// 3. Fallback to the first warehouse in the list
// If no warehouses are supplied, returns null.
function getDefaultWarehouseCode(warehouses = []) {
  if (!Array.isArray(warehouses) || warehouses.length === 0) return null;

  const defaultWarehouse =
    warehouses.find(w => w.IsDefault) ||
    warehouses.find(w => (w.WarehouseCode || '').toUpperCase() === 'MAIN') ||
    warehouses[0];

  return defaultWarehouse?.WarehouseCode || null;
}

export { slugify, validateEmail, getDefaultWarehouseCode }; 