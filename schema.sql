-- Zillow Export Companion Site Database Schema
CREATE TABLE IF NOT EXISTS listings (
    zpid TEXT PRIMARY KEY,
    url TEXT,
    address TEXT,
    price REAL,
    zestimate REAL,
    taxAssessedValue REAL,
    beds INTEGER,
    baths REAL,
    sqft INTEGER,
    pricePerSqft REAL,
    imgSrc TEXT,
    scannedAt TEXT DEFAULT (datetime('now', 'localtime')),
    favorite INTEGER DEFAULT 0
);
