const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8020';

async function request(path) {
  const response = await fetch(`${API_BASE_URL}${path}`);
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return response.json();
}

export function fetchProducts() {
  return request('/api/products');
}

export function fetchHealth() {
  return request('/api/health');
}

export function fetchCartSummary() {
  return request('/api/cart/summary');
}
