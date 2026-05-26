// Cloudflare Pages Functions: /api/listings
const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json"
};

// Handle CORS preflight
export async function onRequestOptions() {
    return new Response(null, {
        status: 204,
        headers: CORS_HEADERS
    });
}

// GET all listings
export async function onRequestGet(context) {
    try {
        const { env } = context;
        if (!env.DB) {
            return new Response(JSON.stringify({ error: "D1 Database binding 'DB' is missing. Please bind a database." }), {
                status: 500,
                headers: CORS_HEADERS
            });
        }

        // Query all listings ordered by the scan date (newest first)
        const { results } = await env.DB.prepare(
            `SELECT zpid, url, address, price, zestimate, taxAssessedValue, beds, baths, sqft, pricePerSqft, scannedAt 
             FROM listings ORDER BY scannedAt DESC`
        ).all();

        return new Response(JSON.stringify(results), {
            status: 200,
            headers: CORS_HEADERS
        });
    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
            status: 500,
            headers: CORS_HEADERS
        });
    }
}

// POST new/updated listings (Upsert)
export async function onRequestPost(context) {
    try {
        const { env, request } = context;
        if (!env.DB) {
            return new Response(JSON.stringify({ error: "D1 Database binding 'DB' is missing." }), {
                status: 500,
                headers: CORS_HEADERS
            });
        }

        const body = await request.json();
        const listings = Array.isArray(body) ? body : (body.properties || []);

        if (listings.length === 0) {
            return new Response(JSON.stringify({ success: true, count: 0, message: "No listings received." }), {
                status: 200,
                headers: CORS_HEADERS
            });
        }

        // Prepare the upsert statement
        const stmt = env.DB.prepare(
            `INSERT OR REPLACE INTO listings (zpid, url, address, price, zestimate, taxAssessedValue, beds, baths, sqft, pricePerSqft, scannedAt)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))`
        );

        // Run batch query for maximum performance on multiple properties
        const batchStatements = listings.map(p => {
            // Normalize values
            const cleanPrice = p.price ? parseFloat(String(p.price).replace(/[^0-9.]/g, '')) : null;
            const cleanZestimate = p.zestimate ? parseFloat(String(p.zestimate).replace(/[^0-9.]/g, '')) : null;
            const cleanTaxVal = p.taxAssessedValue ? parseFloat(String(p.taxAssessedValue).replace(/[^0-9.]/g, '')) : null;
            const cleanBeds = p.beds !== undefined && p.beds !== null ? parseInt(String(p.beds).replace(/[^0-9]/g, '')) : null;
            const cleanBaths = p.baths !== undefined && p.baths !== null ? parseFloat(String(p.baths).replace(/[^0-9.]/g, '')) : null;
            const cleanSqft = p.sqft !== undefined && p.sqft !== null ? parseInt(String(p.sqft).replace(/[^0-9]/g, '')) : null;
            const cleanPricePerSqft = p.pricePerSqft !== undefined && p.pricePerSqft !== null ? parseFloat(String(p.pricePerSqft).replace(/[^0-9.]/g, '')) : null;
            
            return stmt.bind(
                String(p.zpid),
                p.url || null,
                p.address || null,
                isNaN(cleanPrice) ? null : cleanPrice,
                isNaN(cleanZestimate) ? null : cleanZestimate,
                isNaN(cleanTaxVal) ? null : cleanTaxVal,
                isNaN(cleanBeds) ? null : cleanBeds,
                isNaN(cleanBaths) ? null : cleanBaths,
                isNaN(cleanSqft) ? null : cleanSqft,
                isNaN(cleanPricePerSqft) ? null : cleanPricePerSqft
            );
        });

        await env.DB.batch(batchStatements);

        return new Response(JSON.stringify({ success: true, count: listings.length, message: `Successfully synced ${listings.length} listings.` }), {
            status: 201,
            headers: CORS_HEADERS
        });
    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
            status: 500,
            headers: CORS_HEADERS
        });
    }
}

// DELETE listing(s)
export async function onRequestDelete(context) {
    try {
        const { env, request } = context;
        if (!env.DB) {
            return new Response(JSON.stringify({ error: "D1 Database binding 'DB' is missing." }), {
                status: 500,
                headers: CORS_HEADERS
            });
        }

        const url = new URL(request.url);
        const zpid = url.searchParams.get("zpid");

        if (zpid) {
            // Delete specific listing
            await env.DB.prepare("DELETE FROM listings WHERE zpid = ?").bind(zpid).run();
            return new Response(JSON.stringify({ success: true, message: `Listing ${zpid} deleted.` }), {
                status: 200,
                headers: CORS_HEADERS
            });
        } else {
            // Clear entire database
            await env.DB.prepare("DELETE FROM listings").run();
            return new Response(JSON.stringify({ success: true, message: "All listings cleared." }), {
                status: 200,
                headers: CORS_HEADERS
            });
        }
    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
            status: 500,
            headers: CORS_HEADERS
        });
    }
}
