import React, { useState, useEffect } from 'react';

// Helper to check if the installed extension version is strictly older than the latest version
function isOutOfDate(installed, latest) {
  if (!installed || !latest) return false;
  const instParts = installed.split('.').map(Number);
  const latParts = latest.split('.').map(Number);
  for (let i = 0; i < Math.max(instParts.length, latParts.length); i++) {
    const instVal = instParts[i] || 0;
    const latVal = latParts[i] || 0;
    if (instVal < latVal) return true;
    if (instVal > latVal) return false;
  }
  return false;
}

export default function App() {
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [priceFilter, setPriceFilter] = useState('all');
  const [bedsFilter, setBedsFilter] = useState('all');
  const [dealFilter, setDealFilter] = useState('all');
  const [sortOrder, setSortOrder] = useState('newest');
  const [showConfigGuide, setShowConfigGuide] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [extensionInstalled, setExtensionInstalled] = useState(false);
  const [extensionVersion, setExtensionVersion] = useState(null);
  const [latestVersion, setLatestVersion] = useState("1.1");
  const [showFilterSidebar, setShowFilterSidebar] = useState(false);

  // Fetch the latest version dynamically from the extension's raw GitHub manifest on mount
  useEffect(() => {
    const fetchLatestVersion = async () => {
      try {
        // Append a timestamp to bypass GitHub's 5-minute raw file CDN cache!
        const res = await fetch(`https://raw.githubusercontent.com/yajinni/ZillowExportExtention/main/manifest.json?t=${Date.now()}`);
        if (res.ok) {
          const data = await res.json();
          if (data.version) {
            setLatestVersion(data.version);
          }
        }
      } catch (err) {
        console.error("Failed to fetch latest extension version:", err);
      }
    };
    fetchLatestVersion();
  }, []);

  // Check for the extension's injected version attributes periodically
  useEffect(() => {
    const checkExtension = () => {
      const installed = document.documentElement.getAttribute('data-zillow-extension-installed') === 'true';
      const version = document.documentElement.getAttribute('data-zillow-extension-version');
      if (installed) {
        setExtensionInstalled(true);
        setExtensionVersion(version);
      }
    };

    checkExtension();
    const interval = setInterval(checkExtension, 1500);
    return () => clearInterval(interval);
  }, []);

  // Dynamic API base URL detection
  const apiBase = window.location.origin;

  // Fetch listings from backend
  const fetchListings = async (showLoader = false) => {
    if (showLoader) setLoading(true);
    try {
      const res = await fetch(`${apiBase}/api/listings`);
      if (!res.ok) {
        throw new Error(`Server returned status ${res.status}`);
      }
      const data = await res.json();
      setListings(data);
      setError(null);
    } catch (err) {
      console.error("Error fetching listings:", err);
      setError(err.message || "Failed to load database. Ensure wrangler dev/pages is running.");
    } finally {
      if (showLoader) setLoading(false);
    }
  };

  // Poll for new listings automatically every 4 seconds for a "live" feel
  useEffect(() => {
    fetchListings(true);
    const interval = setInterval(() => {
      fetchListings(false);
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  // Format numbers to currency string
  const formatCurrency = (value) => {
    if (value === null || value === undefined || isNaN(value)) return 'N/A';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0
    }).format(value);
  };

  // Format Date String to clean local string
  const formatDate = (dateStr) => {
    if (!dateStr) return 'N/A';
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (e) {
      return dateStr;
    }
  };

  // Handle single listing deletion
  const handleDeleteSingle = async (zpid) => {
    if (!confirm("Are you sure you want to delete this listing from the database?")) return;
    try {
      const res = await fetch(`${apiBase}/api/listings?zpid=${zpid}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        setListings(prev => prev.filter(item => item.zpid !== zpid));
      } else {
        alert("Failed to delete the listing.");
      }
    } catch (err) {
      alert("Error deleting listing: " + err.message);
    }
  };

  // Handle clearing the entire database
  const handleClearAll = async () => {
    if (!confirm("⚠️ WARNING: This will permanently delete ALL listings in your database. Continue?")) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`${apiBase}/api/listings`, {
        method: 'DELETE'
      });
      if (res.ok) {
        setListings([]);
      } else {
        alert("Failed to clear database.");
      }
    } catch (err) {
      alert("Error clearing database: " + err.message);
    } finally {
      setIsDeleting(false);
    }
  };

  // Handle toggling favorite status
  const handleToggleFavorite = async (zpid, currentFavorite) => {
    const newFavorite = currentFavorite === 1 ? 0 : 1;
    
    // Optimistic UI update for instantaneous responsiveness!
    setListings(prev => 
      prev.map(item => 
        item.zpid === zpid ? { ...item, favorite: newFavorite } : item
      )
    );

    try {
      const res = await fetch(`${apiBase}/api/listings?zpid=${zpid}&favorite=${newFavorite}`, {
        method: 'PATCH'
      });
      if (!res.ok) {
        throw new Error("Failed to update favorite on server.");
      }
    } catch (err) {
      console.error(err);
      // Revert if server fails
      setListings(prev => 
        prev.map(item => 
          item.zpid === zpid ? { ...item, favorite: currentFavorite } : item
        )
      );
      alert("Error saving favorite: " + err.message);
    }
  };

  // Sync all favorites in sequence with 1.2 second stagger to be safe and responsive
  const handleSyncAllFavorites = () => {
    const favorites = listings.filter(l => l.favorite === 1);
    if (favorites.length === 0) {
      alert("No favorite properties marked to sync!");
      return;
    }
    if (confirm(`This will open ${favorites.length} Zillow listings in background tabs to refresh their values automatically. Continue?`)) {
      favorites.forEach((prop, index) => {
        setTimeout(() => {
          window.open(prop.url + (prop.url.includes('?') ? '&' : '?') + 'autoSync=true', '_blank');
        }, index * 1200);
      });
    }
  };

  // Export listings to clipboard (TSV format, perfect drop-in for Excel or Sheets)
  const handleClipboardExport = () => {
    if (listings.length === 0) {
      alert("No data available to export.");
      return;
    }
    const headers = ['ZPID', 'Address', 'Beds', 'Baths', 'Sqft', 'Price/Sqft', 'Price', 'Zestimate', 'Tax Assessed Value', 'Tax Delta %', 'Zestimate Delta %', 'Link', 'Scanned At'];
    const rows = filteredAndSortedListings.map(p => {
      const diffPct = p.price && p.zestimate 
        ? (((p.price - p.zestimate) / p.zestimate) * 100).toFixed(1) 
        : 'N/A';
      const taxPct = p.price && p.taxAssessedValue
        ? (((p.price - p.taxAssessedValue) / p.taxAssessedValue) * 100).toFixed(1)
        : 'N/A';
      return [
        p.zpid,
        p.address || '',
        p.beds || '',
        p.baths || '',
        p.sqft || '',
        p.pricePerSqft || '',
        p.price || '',
        p.zestimate || '',
        p.taxAssessedValue || '',
        taxPct + '%',
        diffPct + '%',
        p.url || '',
        p.scannedAt || ''
      ];
    });

    const content = [headers.join('\t'), ...rows.map(r => r.join('\t'))].join('\n');
    navigator.clipboard.writeText(content)
      .then(() => alert("📋 Copied all filtered data! Go to Google Sheets or Excel and press Ctrl+V / Cmd+V."))
      .catch(() => alert("Failed to copy to clipboard. Try standard CSV export."));
  };

  // Calculate live statistics
  const totalCount = listings.length;
  const pricedListings = listings.filter(l => l.price > 0);
  const avgPrice = pricedListings.length > 0 
    ? Math.round(pricedListings.reduce((sum, l) => sum + l.price, 0) / pricedListings.length) 
    : 0;

  const discountListings = listings.filter(l => l.price > 0 && l.zestimate > 0);
  const avgDiscount = discountListings.length > 0
    ? (discountListings.reduce((sum, l) => sum + ((l.price - l.zestimate) / l.zestimate), 0) / discountListings.length) * 100
    : 0;

  const listingsWithPricePerSqft = listings.filter(l => l.pricePerSqft > 0);
  const avgPricePerSqft = listingsWithPricePerSqft.length > 0
    ? Math.round(listingsWithPricePerSqft.reduce((sum, l) => sum + l.pricePerSqft, 0) / listingsWithPricePerSqft.length)
    : 0;

  // Filter and Sort Listings logic
  const filteredAndSortedListings = listings
    .filter(item => {
      // Search text filter
      const searchLower = searchTerm.toLowerCase();
      const matchSearch = 
        (item.address && item.address.toLowerCase().includes(searchLower)) ||
        (item.zpid && String(item.zpid).includes(searchLower));
      
      // Price Tier filter
      let matchPrice = true;
      if (priceFilter === 'under300') matchPrice = item.price < 300000;
      else if (priceFilter === '300to500') matchPrice = item.price >= 300000 && item.price <= 500000;
      else if (priceFilter === '500to750') matchPrice = item.price > 500000 && item.price <= 750000;
      else if (priceFilter === '750to1m') matchPrice = item.price > 750000 && item.price <= 1000000;
      else if (priceFilter === 'over1m') matchPrice = item.price > 1000000;

      // Bedrooms filter
      let matchBeds = true;
      if (bedsFilter !== 'all') {
        matchBeds = item.beds !== null && item.beds >= parseInt(bedsFilter);
      }

      // Deal status filter
      let matchDeal = true;
      if (dealFilter === 'discount') matchDeal = item.price > 0 && item.zestimate > 0 && item.price < item.zestimate;
      else if (dealFilter === 'overpriced') matchDeal = item.price > 0 && item.zestimate > 0 && item.price > item.zestimate;
      else if (dealFilter === 'no_zestimate') matchDeal = !item.zestimate;

      // Favorites filter
      let matchFavorite = true;
      if (showFavoritesOnly) {
        matchFavorite = item.favorite === 1;
      }

      return matchSearch && matchPrice && matchBeds && matchDeal && matchFavorite;
    })
    .sort((a, b) => {
      if (sortOrder === 'newest') {
        return new Date(b.scannedAt || 0) - new Date(a.scannedAt || 0);
      } else if (sortOrder === 'price_asc') {
        return (a.price || Infinity) - (b.price || Infinity);
      } else if (sortOrder === 'price_desc') {
        return (b.price || 0) - (a.price || 0);
      } else if (sortOrder === 'discount_desc') {
        const getDisc = (x) => x.price && x.zestimate ? (x.zestimate - x.price) / x.zestimate : -Infinity;
        return getDisc(b) - getDisc(a);
      }
      return 0;
    });

  return (
    <div className="app-container">
      {/* Extension Update Warning Banner */}
      {extensionInstalled && extensionVersion && isOutOfDate(extensionVersion, latestVersion) && (
        <div 
          className="update-banner"
          style={{
            background: 'linear-gradient(135deg, hsla(30, 95%, 50%, 0.95) 0%, hsla(15, 95%, 45%, 0.95) 100%)',
            backdropFilter: 'blur(10px)',
            borderBottom: '1px solid hsla(30, 95%, 55%, 0.3)',
            padding: '0.85rem 1.5rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '1rem',
            color: 'white',
            fontWeight: '600',
            fontSize: '0.92rem',
            textAlign: 'center',
            boxShadow: '0 4px 15px rgba(0,0,0,0.25)',
            position: 'sticky',
            top: 0,
            zIndex: 1000,
            transition: 'all 0.3s',
            borderRadius: '12px',
            marginBottom: '1.5rem',
            border: '1px solid hsla(30, 95%, 55%, 0.2)'
          }}
        >
          <span>⚠️ Your Zillow Data Export extension (v{extensionVersion}) is out of date! A new version (v{latestVersion}) is available.</span>
          <button 
            className="btn btn-primary"
            style={{ 
              background: 'white', 
              color: 'hsl(15, 95%, 40%)', 
              padding: '0.45rem 1rem', 
              fontSize: '0.82rem', 
              borderRadius: '6px',
              border: 'none',
              fontWeight: '700',
              boxShadow: '0 2px 6px rgba(0,0,0,0.15)',
              cursor: 'pointer',
              whiteSpace: 'nowrap'
            }}
            onClick={() => setShowConfigGuide(true)}
          >
            Update Extension
          </button>
        </div>
      )}
      {/* Header */}
      <header className="app-header">
        <div className="brand-section">
          <div className="brand-logo">Z</div>
          <div className="brand-title">
            <h1>Zillow Data Vault</h1>
            <p>Cloud Storage & Analytics for Scanned Listings</p>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <button 
            className="btn btn-secondary" 
            onClick={() => setShowConfigGuide(true)}
            style={{ 
              padding: '0.45rem 1rem', 
              fontSize: '0.85rem', 
              borderRadius: '20px', 
              display: 'flex', 
              alignItems: 'center', 
              gap: '0.4rem',
              height: '34px',
              fontWeight: '600'
            }}
            title="Open Extension Installation & Setup Guide"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
            <span>Extension</span>
          </button>
          <div className="sync-status-indicator" style={{ height: '34px', display: 'flex', alignItems: 'center' }}>
            <span className={`status-dot ${error ? 'offline' : 'online'}`}></span>
            <span>{error ? "Database Disconnected" : "Live Auto-Sync Active"}</span>
          </div>
        </div>
      </header>
      {/* Metrics Grid */}
      <section className="metrics-grid">
        <div className="metric-card">
          <div className="metric-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>
          </div>
          <div className="metric-info">
            <span className="metric-label">Houses Scanned</span>
            <span className="metric-value">{totalCount}</span>
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"></line><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>
          </div>
          <div className="metric-info">
            <span className="metric-label">Average Listing Price</span>
            <span className="metric-value">{formatCurrency(avgPrice)}</span>
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-icon" style={{ color: 'var(--accent-orange)', background: 'hsla(30, 90%, 55%, 0.08)', borderColor: 'hsla(30, 90%, 55%, 0.15)' }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="9" y1="3" x2="9" y2="21"></line><line x1="15" y1="3" x2="15" y2="21"></line><line x1="3" y1="9" x2="21" y2="9"></line><line x1="3" y1="15" x2="21" y2="15"></line></svg>
          </div>
          <div className="metric-info">
            <span className="metric-label">Avg. Price / Sqft</span>
            <span className="metric-value">{avgPricePerSqft > 0 ? `${formatCurrency(avgPricePerSqft)}/sqft` : 'N/A'}</span>
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline><polyline points="17 6 23 6 23 12"></polyline></svg>
          </div>
          <div className="metric-info">
            <span className="metric-label">Avg. Price vs Zestimate</span>
            <span className="metric-value" style={{ color: avgDiscount < 0 ? 'var(--accent-green)' : (avgDiscount > 0 ? 'var(--accent-red)' : 'var(--text-primary)') }}>
              {avgDiscount === 0 ? '0.0%' : `${avgDiscount > 0 ? '+' : ''}${avgDiscount.toFixed(1)}%`}
            </span>
          </div>
        </div>
      </section>



      {/* Main Database Grid Section */}
      <main style={{ marginTop: '1rem' }}>
        <div className="table-header-bar" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '16px 16px 0 0', padding: '1.25rem 1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ fontSize: '1.25rem', fontWeight: '600' }}>Scanned Properties</h2>
          <span className="listings-count">
            Showing {filteredAndSortedListings.length} of {totalCount} listings
          </span>
        </div>

        {error && (
          <div style={{ padding: '3rem 2rem', textAlign: 'center', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderTop: 'none', borderRadius: '0 0 16px 16px', color: 'var(--accent-red)' }}>
            <p>⚠️ Error: {error}</p>
            <button className="btn btn-secondary" style={{ marginTop: '1rem' }} onClick={() => fetchListings(true)}>
              Retry Connection
            </button>
          </div>
        )}

        {!error && loading && listings.length === 0 && (
          <div className="loader-container" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderTop: 'none', borderRadius: '0 0 16px 16px' }}>
            <div className="spinner"></div>
            <p>Connecting to Cloudflare D1 Vault...</p>
          </div>
        )}

        {!error && !loading && filteredAndSortedListings.length === 0 && (
          <div className="empty-state" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderTop: 'none', borderRadius: '0 0 16px 16px' }}>
            <div className="empty-state-icon">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="8" y1="12" x2="16" y2="12"></line></svg>
            </div>
            {totalCount === 0 ? (
              <>
                <h3>No Properties Scanned Yet</h3>
                <p>Use your Chrome extension on Zillow to search or scroll listings. They will appear here automatically!</p>
                <button className="btn btn-primary" onClick={() => setShowConfigGuide(true)}>
                  See Connection Instructions
                </button>
              </>
            ) : (
              <>
                <h3>No Match Found</h3>
                <p>Try adjusting your search query, price tiers, or deal filters.</p>
                <button className="btn btn-secondary" onClick={() => { setSearchTerm(''); setPriceFilter('all'); setBedsFilter('all'); setDealFilter('all'); }}>
                  Reset Filters
                </button>
              </>
            )}
          </div>
        )}

        {!error && filteredAndSortedListings.length > 0 && (
          <div className="listings-cards-grid" style={{ marginTop: '2rem' }}>
            {filteredAndSortedListings.map((prop) => {
              // Calculate comparison discount
              const isDiscount = prop.price > 0 && prop.zestimate > 0 && prop.price < prop.zestimate;
              const isOver = prop.price > 0 && prop.zestimate > 0 && prop.price > prop.zestimate;
              const deltaPct = prop.price > 0 && prop.zestimate > 0
                ? ((prop.price - prop.zestimate) / prop.zestimate) * 100
                : null;

              // Tax comparisons
              const taxDelta = prop.price > 0 && prop.taxAssessedValue > 0
                ? ((prop.price - prop.taxAssessedValue) / prop.taxAssessedValue) * 100
                : null;
              const isGoodTaxDeal = prop.price > 0 && prop.taxAssessedValue > 0 && prop.price <= 1.5 * prop.taxAssessedValue;

              // Flip MAO (Maximum Allowed Offer) calculations
              // Proxy ARV = Zestimate (fallback to price if missing)
              const arv = prop.zestimate || prop.price || 0;
              // Rehab estimate = $30/sqft (fallback to $25,000 if sqft is missing or invalid)
              const estRehab = prop.sqft && prop.sqft > 0 ? prop.sqft * 30 : 25000;
              const flipMao = arv > 0 ? (arv * 0.70) - estRehab : null;
              const maoDelta = flipMao && flipMao > 0 && prop.price > 0
                ? ((prop.price - flipMao) / flipMao) * 100
                : null;
              const isMaoDeal = flipMao && prop.price > 0 && prop.price <= flipMao;

              // Rental Yield & Cap Rate calculations
              // Monthly Rent Estimate = 0.75% of Zestimate (fallback to price if missing)
              const estRent = arv > 0 ? Math.round(arv * 0.0075) : null;
              const annualGrossRent = estRent ? estRent * 12 : 0;
              // Operating Expenses = 35% of Gross Rent (leaving 65% for NOI)
              const netOperatingIncome = annualGrossRent * 0.65;
              const capRate = netOperatingIncome > 0 && prop.price > 0
                ? (netOperatingIncome / prop.price) * 100
                : null;
              const isCapRateGood = capRate !== null && capRate >= 6.0;

              return (
                <article key={prop.zpid} className="house-card">
                  {/* ZPID Badge Overlay */}
                  <span className="card-zpid-subbadge">ZPID: {prop.zpid}</span>

                  {/* Favorite Toggle Button Overlay */}
                  <button 
                    className="card-favorite-btn"
                    onClick={(e) => {
                      e.preventDefault();
                      handleToggleFavorite(prop.zpid, prop.favorite);
                    }}
                    title={prop.favorite === 1 ? "Remove from Favorites" : "Add to Favorites"}
                    style={{
                      position: 'absolute',
                      top: '14px',
                      right: '14px',
                      zIndex: 10,
                      background: 'rgba(15, 23, 42, 0.75)',
                      backdropFilter: 'blur(8px)',
                      WebkitBackdropFilter: 'blur(8px)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '50%',
                      width: '32px',
                      height: '32px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                      color: prop.favorite === 1 ? 'hsl(45, 95%, 55%)' : 'var(--text-secondary)',
                      fontSize: '1.15rem',
                      transition: 'all 0.2s',
                      boxShadow: '0 4px 10px rgba(0, 0, 0, 0.2)'
                    }}
                  >
                    {prop.favorite === 1 ? '★' : '☆'}
                  </button>

                  {/* Card Image */}
                  <div className="card-image-wrapper">
                    {prop.imgSrc ? (
                      <img 
                        src={prop.imgSrc} 
                        alt={prop.address || "Zillow listing image"} 
                        className="card-img" 
                        onError={(e) => { 
                          e.target.style.display = 'none'; 
                          e.target.nextSibling.style.display = 'flex'; 
                        }} 
                      />
                    ) : null}
                    <div className="card-image-placeholder" style={{ display: prop.imgSrc ? 'none' : 'flex' }}>
                      <svg className="placeholder-svg-house" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
                        <polyline points="9 22 9 12 15 12 15 22"></polyline>
                      </svg>
                    </div>
                  </div>

                  {/* Card Content Body */}
                  <div className="card-body">
                    {/* Price Row */}
                    <div className="card-price-row">
                      <span 
                        className="card-price-val"
                        data-tooltip="Listing Price: Current asking price of the property on Zillow."
                      >
                        {formatCurrency(prop.price)}
                      </span>
                      {prop.pricePerSqft ? (
                        <span 
                          className="card-price-sqft-val"
                          data-tooltip="Price per Square Foot: Calculated by dividing Listing Price by finished square footage. Formula: Price / Sqft."
                        >
                          {formatCurrency(prop.pricePerSqft)}/sqft
                        </span>
                      ) : null}
                    </div>

                    {/* Address Text */}
                    <div 
                      className="card-address-text" 
                      title={`Address: ${prop.address || 'Address Hidden/Missing'}`}
                    >
                      {prop.address || 'Address Hidden/Missing'}
                    </div>

                    {/* Specs Row */}
                    <div className="card-specs-container">
                      <div className="card-spec-item" data-tooltip="Bedrooms: Number of bedrooms parsed from Zillow details.">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2 4v16M2 8h20M22 4v16M2 12h20M2 16h20"></path></svg>
                        <span>{prop.beds !== null && prop.beds !== undefined ? `${prop.beds} bd` : '—'}</span>
                      </div>
                      <div className="card-spec-item" data-tooltip="Bathrooms: Number of bathrooms parsed from Zillow details.">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM21 21v-1a4 4 0 0 0-3-3.87m-11 0A4 4 0 0 0 2 20v1"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
                        <span>{prop.baths !== null && prop.baths !== undefined ? `${prop.baths} ba` : '—'}</span>
                      </div>
                      <div className="card-spec-item" data-tooltip="Square Footage: Total interior living area in square feet.">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="9" y1="3" x2="9" y2="21"></line><line x1="15" y1="3" x2="15" y2="21"></line><line x1="3" y1="9" x2="21" y2="9"></line><line x1="3" y1="15" x2="21" y2="15"></line></svg>
                        <span>{prop.sqft ? prop.sqft.toLocaleString() : '—'}</span>
                      </div>
                    </div>

                    {/* Detailed Comparisons Box */}
                    <div className="card-details-comparison">
                      <div className="comparison-box">
                        <span className="comparison-label" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                          Zestimate
                          <span 
                            data-tooltip="Zestimate: Zillow's proprietary market value estimate. A negative delta indicates a listing priced below Zestimate. Formula: ((Price - Zestimate) / Zestimate) * 100."
                            style={{ cursor: 'help', color: 'var(--text-muted)', fontSize: '0.75rem', opacity: 0.7, transition: 'opacity 0.2s' }}
                            className="info-icon"
                          >
                            ⓘ
                          </span>
                        </span>
                        <span className="comparison-value">{formatCurrency(prop.zestimate)}</span>
                        {deltaPct !== null && (
                          <span className="comparison-subvalue" style={{ color: isDiscount ? 'var(--accent-green)' : 'var(--text-secondary)', fontWeight: '600' }}>
                            Price {deltaPct > 0 ? '+' : ''}{deltaPct.toFixed(1)}%
                          </span>
                        )}
                      </div>

                      <div className="comparison-box">
                        <span className="comparison-label" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                          Tax Value
                          <span 
                            data-tooltip="Tax Value: Valuation placed by the county assessor for property tax purposes. Highlighted green if Listing Price is <= 150% of Tax Value. Formula: ((Price - Tax Value) / Tax Value) * 100."
                            style={{ cursor: 'help', color: 'var(--text-muted)', fontSize: '0.75rem', opacity: 0.7, transition: 'opacity 0.2s' }}
                            className="info-icon"
                          >
                            ⓘ
                          </span>
                        </span>
                        <span className="comparison-value">{formatCurrency(prop.taxAssessedValue)}</span>
                        {taxDelta !== null && (
                          <span className="comparison-subvalue" style={{ color: isGoodTaxDeal ? 'var(--accent-green)' : 'var(--text-secondary)', fontWeight: '600' }}>
                            Price {taxDelta > 0 ? '+' : ''}{taxDelta.toFixed(1)}%
                          </span>
                        )}
                      </div>

                      <div className="comparison-box">
                        <span className="comparison-label" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                          Flip MAO
                          <span 
                            data-tooltip="Maximum Allowed Offer (MAO) for Flipping: The purchase limit to secure a 70% return on ARV (using Zestimate as a proxy) after estimated cosmetic rehab ($30/sqft). Formula: (Zestimate * 0.70) - (Sqft * 30). Highlighted green if Listing Price is <= MAO."
                            style={{ cursor: 'help', color: 'var(--text-muted)', fontSize: '0.75rem', opacity: 0.7, transition: 'opacity 0.2s' }}
                            className="info-icon"
                          >
                            ⓘ
                          </span>
                        </span>
                        <span className="comparison-value" style={{ color: isMaoDeal ? 'var(--accent-green)' : 'var(--text-primary)', fontWeight: '700' }}>
                          {flipMao !== null ? formatCurrency(flipMao) : 'N/A'}
                        </span>
                        {maoDelta !== null && (
                          <span className="comparison-subvalue" style={{ color: isMaoDeal ? 'var(--accent-green)' : 'var(--text-secondary)', fontWeight: '600' }}>
                            Price {maoDelta > 0 ? '+' : ''}{maoDelta.toFixed(1)}%
                          </span>
                        )}
                      </div>

                      <div className="comparison-box">
                        <span className="comparison-label" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                          Est. Rent
                          <span 
                            data-tooltip="Estimated Rental Yield: Estimated Cap Rate (Capitalization Rate) and monthly rent. Rent is modeled at 0.75% of Zestimate/month, and Operating Expenses are modeled at 35% of rent (taxes, insurance, maintenance). Formula: (Monthly Rent * 12 * 0.65) / Price. Highlighted green if Cap Rate >= 6%."
                            style={{ cursor: 'help', color: 'var(--text-muted)', fontSize: '0.75rem', opacity: 0.7, transition: 'opacity 0.2s' }}
                            className="info-icon"
                          >
                            ⓘ
                          </span>
                        </span>
                        <span className="comparison-value" style={{ color: isCapRateGood ? 'var(--accent-green)' : 'var(--text-primary)', fontWeight: '700' }}>
                          {estRent !== null ? `${formatCurrency(estRent)}/mo` : 'N/A'}
                        </span>
                        {capRate !== null && (
                          <span className="comparison-subvalue" style={{ color: isCapRateGood ? 'var(--accent-green)' : 'var(--text-secondary)', fontWeight: '600' }}>
                            {capRate.toFixed(1)}% Cap
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Footer Actions */}
                    <div className="card-footer-block">
                      <span className="card-timestamp">{formatDate(prop.scannedAt)}</span>
                      <div className="card-actions-wrapper">
                        <button 
                          className="row-action-btn"
                          style={{ color: 'var(--accent-cyan)' }}
                          onClick={() => window.open(prop.url + (prop.url.includes('?') ? '&' : '?') + 'autoSync=true', '_blank')}
                          title="Sync Fresh Data: Opens this Zillow listing in a background tab to let your Chrome Extension grab the latest values and auto-close the tab."
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M23 4v6h-6"></path><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>
                        </button>
                        <a 
                          href={prop.url} 
                          target="_blank" 
                          rel="noopener noreferrer" 
                          className="view-link"
                          style={{ fontSize: '0.9rem' }}
                          title="Open Listing on Zillow"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
                          <span>Zillow</span>
                        </a>
                        <button 
                          className="row-action-btn"
                          onClick={() => handleDeleteSingle(prop.zpid)}
                          title="Delete listing from Vault"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                        </button>
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </main>

      {/* Integration & Connection Settings Guide Modal */}
      {showConfigGuide && (
        <div className="modal-overlay" onClick={() => setShowConfigGuide(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '580px', width: '100%' }}>
            <div className="modal-header" style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: '1rem', marginBottom: '1.25rem' }}>
              <h3 style={{ margin: 0 }}>Extension Installation & Setup Guide</h3>
            </div>
            
            <div className="modal-body" style={{ color: 'var(--text-secondary)', fontSize: '0.92rem', display: 'flex', flexDirection: 'column', gap: '1.25rem', maxHeight: '70vh', overflowY: 'auto', paddingRight: '0.5rem' }}>
              
              {/* Step 1: Download Zip */}
              <div style={{ background: 'hsla(180, 85%, 45%, 0.05)', border: '1px solid hsla(180, 85%, 45%, 0.15)', borderRadius: '12px', padding: '1.25rem' }}>
                <h4 style={{ color: 'var(--text-primary)', margin: '0 0 0.5rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '1rem' }}>
                  <span style={{ background: 'var(--accent-cyan)', color: 'var(--bg-primary)', borderRadius: '50%', width: '22px', height: '22px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.85rem', fontWeight: 'bold' }}>1</span>
                  Download the Extension Package
                </h4>
                <p style={{ margin: '0 0 1rem 0', fontSize: '0.88rem', lineHieght: '1.4' }}>
                  Get the latest, pre-compiled version of the Zillow Data Export Chrome extension.
                </p>
                <a 
                  href="https://github.com/yajinni/ZillowExportExtention/raw/main/zillow-data-export.zip" 
                  download="zillow-data-export.zip"
                  className="btn btn-primary"
                  style={{ textDecoration: 'none', display: 'inline-flex', padding: '0.65rem 1.25rem', fontSize: '0.9rem', width: '100%', justifyContent: 'center' }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '6px' }}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                  Download Extension (.ZIP)
                </a>
              </div>

              {/* Step 2: Install in Chrome */}
              <div>
                <h4 style={{ color: 'var(--text-primary)', margin: '0 0 0.75rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '1rem' }}>
                  <span style={{ background: 'var(--accent-cyan)', color: 'var(--bg-primary)', borderRadius: '50%', width: '22px', height: '22px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.85rem', fontWeight: 'bold' }}>2</span>
                  Install & Activate in Chrome
                </h4>
                <ol style={{ paddingLeft: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', margin: 0, fontSize: '0.88rem' }}>
                  <li>Locate the downloaded <code>zillow-data-export.zip</code> file and **extract it** to a folder on your computer.</li>
                  <li>Open Google Chrome and type **<code>chrome://extensions/</code>** into the URL search bar.</li>
                  <li>In the top-right corner of the Extensions page, switch the toggle for **Developer mode** to **ON**.</li>
                  <li>Click the **Load unpacked** button in the top-left corner.</li>
                  <li>Select the extracted folder containing the extension files (which includes <code>manifest.json</code>).</li>
                  <li>Navigate to any page on <a href="https://www.zillow.com" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-cyan)', textDecoration: 'none', fontWeight: 'bold' }}>Zillow.com</a>. The extension will automatically connect to your vault and start synchronizing your scans instantly!</li>
                </ol>
              </div>

            </div>
            
            <div className="modal-footer" style={{ borderTop: '1px solid var(--border-color)', paddingTop: '1rem', marginTop: '1rem' }}>
              <button className="btn btn-primary" onClick={() => setShowConfigGuide(false)}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Collapsible Filters & Actions Sidebar */}
      <div 
        className={`sidebar-overlay ${showFilterSidebar ? 'active' : ''}`}
        onClick={() => setShowFilterSidebar(false)}
      />
      <div className={`filters-sidebar ${showFilterSidebar ? 'active' : ''}`}>
        <div className="sidebar-header">
          <h3>Filters & Actions</h3>
          <button 
            className="hamburger-btn"
            onClick={() => setShowFilterSidebar(!showFilterSidebar)}
            title={showFilterSidebar ? "Collapse Sidebar" : "Expand Sidebar"}
          >
            {showFilterSidebar ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="3" y1="12" x2="21" y2="12"></line>
                <line x1="3" y1="6" x2="21" y2="6"></line>
                <line x1="3" y1="18" x2="21" y2="18"></line>
              </svg>
            )}
          </button>
        </div>
        
        <div className="sidebar-body">
          {/* Section: Search & Filters */}
          <div>
            <div className="sidebar-section-title">Search & Filters</div>
            <div className="sidebar-control-group">
              {/* Search Box */}
              <div className="search-box-wrapper">
                <svg className="search-icon-svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                <input 
                  type="text" 
                  placeholder="Search by Address or ZPID..." 
                  className="search-input"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>

              {/* Price Range Filter */}
              <select 
                className="filter-select"
                value={priceFilter}
                onChange={(e) => setPriceFilter(e.target.value)}
              >
                <option value="all">All Prices</option>
                <option value="under300">Under $300,000</option>
                <option value="300to500">$300k - $500k</option>
                <option value="500to750">$500k - $750k</option>
                <option value="750to1m">$750k - $1M</option>
                <option value="over1m">$1M+</option>
              </select>

              {/* Beds filter */}
              <select 
                className="filter-select"
                value={bedsFilter}
                onChange={(e) => setBedsFilter(e.target.value)}
              >
                <option value="all">Any Bedrooms</option>
                <option value="1">1+ Beds</option>
                <option value="2">2+ Beds</option>
                <option value="3">3+ Beds</option>
                <option value="4">4+ Beds</option>
              </select>

              {/* Deal status filter */}
              <select 
                className="filter-select"
                value={dealFilter}
                onChange={(e) => setDealFilter(e.target.value)}
              >
                <option value="all">All Deals</option>
                <option value="discount">🟢 Priced below Zestimate</option>
                <option value="overpriced">🔴 Priced above Zestimate</option>
                <option value="no_zestimate">⚪ No Zestimate info</option>
              </select>

              {/* Sort order filter */}
              <select 
                className="filter-select"
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value)}
              >
                <option value="newest">Newest Scanned</option>
                <option value="price_asc">Price: Low to High</option>
                <option value="price_desc">Price: High to Low</option>
                <option value="discount_desc">Biggest Discount %</option>
              </select>

              {/* Favorites filter button */}
              <button 
                type="button"
                className={`filter-select ${showFavoritesOnly ? 'active-favorite' : ''}`}
                style={{ 
                  display: 'inline-flex', 
                  alignItems: 'center', 
                  justifyContent: 'flex-start', 
                  paddingLeft: '1.25rem',
                  gap: '0.5rem', 
                  background: showFavoritesOnly ? 'hsla(50, 95%, 55%, 0.12)' : 'var(--bg-tertiary)',
                  borderColor: showFavoritesOnly ? 'hsl(45, 95%, 55%)' : 'var(--border-color)',
                  color: showFavoritesOnly ? 'hsl(45, 95%, 65%)' : 'var(--text-primary)',
                  fontWeight: '600',
                  width: '100%'
                }}
                onClick={() => setShowFavoritesOnly(!showFavoritesOnly)}
              >
                <span>{showFavoritesOnly ? '★ Show Favorites' : '☆ Show Favorites'}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Sidebar Footer: Database & Guide Actions */}
        <div className="sidebar-footer">
          {listings.some(l => l.favorite === 1) && (
            <button 
              className="btn btn-secondary" 
              onClick={() => { handleSyncAllFavorites(); setShowFilterSidebar(false); }}
              style={{ color: 'var(--accent-cyan)' }}
              title="Sync All Favorites"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M23 4v6h-6"></path><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>
              <span>Sync Favorites</span>
            </button>
          )}
          <button className="btn btn-primary" onClick={() => { handleClipboardExport(); setShowFilterSidebar(false); }} disabled={filteredAndSortedListings.length === 0}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect></svg>
            <span>Export to Sheets</span>
          </button>
          {listings.length > 0 && (
            <button className="btn btn-danger" onClick={() => { handleClearAll(); setShowFilterSidebar(false); }} disabled={isDeleting}>
              <span>{isDeleting ? "Clearing..." : "Clear Vault"}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

