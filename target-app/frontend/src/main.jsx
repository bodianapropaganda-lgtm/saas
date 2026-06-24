import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { fetchCartSummary, fetchHealth, fetchProducts } from './api.js';
import './styles.css';

function App() {
  const [products, setProducts] = useState([]);
  const [health, setHealth] = useState(null);
  const [summary, setSummary] = useState(null);
  const [status, setStatus] = useState('loading');

  useEffect(() => {
    Promise.all([fetchProducts(), fetchHealth(), fetchCartSummary()])
      .then(([productsResponse, healthResponse, summaryResponse]) => {
        setProducts(productsResponse.items);
        setHealth(healthResponse);
        setSummary(summaryResponse);
        setStatus('ready');
      })
      .catch(() => setStatus('failed'));
  }, []);

  const inStockCount = useMemo(
    () => products.filter((product) => product.inStock).length,
    [products],
  );

  if (status === 'loading') {
    return <main className="shell">Loading catalog...</main>;
  }

  if (status === 'failed') {
    return <main className="shell">Catalog is unavailable</main>;
  }

  const isChangedVersion = health?.version === 'v2';

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <h1>{isChangedVersion ? 'Revenue dashboard: catalog overview' : 'Catalog overview'}</h1>
          <p>
            {isChangedVersion
              ? 'Promo threshold changed to 75 USD'
              : 'Promo threshold: free shipping from 50 USD'}
          </p>
        </div>
        <div className="version">Backend version: {health?.version}</div>
      </header>

      <section className="summary">
        <Metric label="Products" value={products.length} />
        <Metric label="In stock" value={inStockCount} />
        <Metric label="Cart total" value={summary?.subtotal} />
      </section>

      <section className="grid" aria-label="Products">
        {products.map((product) => (
          <article className="product-card" data-product-id={product.id} key={product.id}>
            <h2>{product.title}</h2>
            <p className="sku">{product.sku}</p>
            <p className="price">{String(product.price)}</p>
          </article>
        ))}
      </section>
    </main>
  );
}

function Metric({ label, value }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
