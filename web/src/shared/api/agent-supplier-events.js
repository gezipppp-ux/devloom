const subscribers = new Set();
export function suppliersChanged() { for (const subscriber of subscribers) subscriber(); }
export function subscribeSuppliers(callback) { subscribers.add(callback); return () => subscribers.delete(callback); }
