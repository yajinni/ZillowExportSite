# Zillow Data Vault - Companion Site & Auto-Sync Backend

A premium, modern full-stack dashboard for storing and analyzing Zillow house listings. This app works hand-in-hand with the **Zillow Data Export** Chrome extension to store scanned listings in a Cloudflare D1 SQL database and visualize them on an interactive dashboard in real time.

Hosted entirely on **Cloudflare Pages** utilizing **Cloudflare D1** serverless SQLite at the edge.

---

## Features

- **Live Auto-Syncing**: Scanned houses load onto the site in real time as you browse Zillow, powered by automatic background extension syncing.
- **Dynamic Metrics Engine**: Computes total listing counts, average asking price, and real-time deal ratio margins compared to Zestimates.
- **Ratio Discount Badges**: Automatically flags deals with visual badges:
  - 🟢 **Discount** (Priced below Zestimate)
  - 🟡 **Fair Value** (Priced matching Zestimate)
  - 🔴 **Premium** (Priced above Zestimate)
- **Advanced Filtering**: Search by Address/ZPID, or filter by price tiers and deal classifications.
- **Multi-Sort Sorting**: Order listings by newest scanned, lowest price, highest price, or largest percent discount.
- **Direct Export**: Copy filtered tabular listings as a TSV string in one click, ready to be pasted directly into Google Sheets or Microsoft Excel.
- **Glassmorphic UI**: High-fidelity dark mode styling, animated state loaders, and glowing transition panels.

---

## Technology Stack

- **Frontend**: React + Vite (Vanilla CSS)
- **Serverless API**: Cloudflare Pages Functions
- **Database**: Cloudflare D1 (SQLite Edge Database)
- **Deployment**: Wrangler CLI / Cloudflare Dashboard

---

## Local Development Setup

To test the frontend, backend API, and extension locally:

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Initialize Local Database Schema**:
   This sets up the SQLite database locally inside Wrangler's state folder.
   ```bash
   npx wrangler d1 execute zillow_export_db --local --file=./schema.sql
   ```

3. **Start the Wrangler Dev Server**:
   This compiles the React code and serves BOTH the frontend dashboard and serverless API endpoints at `http://localhost:8788`.
   ```bash
   npm run build
   npx wrangler pages dev dist
   ```

4. **Connect the Chrome Extension**:
   - Open **Zillow** in your browser.
   - Click the **⚙️ Setup** button in the extension's floating dock.
   - Enter `http://localhost:8788` and click **Save Connection**.
   - Browse listings or click **Scan All Pages**. Watch them populate live on your local dashboard!

---

## Production Deployment to Cloudflare Pages

To host this site for free on Cloudflare:

### 1. Create a Cloudflare D1 Database
Log in to your Cloudflare account via the terminal and create the production SQL database:
```bash
# Log in to Cloudflare (opens browser)
npx wrangler login

# Create D1 database
npx wrangler d1 create zillow_export_db
```

This command will output your database configuration. Example:
```toml
[[d1_databases]]
binding = "DB"
database_name = "zillow_export_db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

### 2. Update `wrangler.json`
Open [wrangler.json](wrangler.json) and replace `"REPLACE_WITH_DATABASE_ID_DURING_DEPLOY"` with your newly created **database_id**:
```json
{
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "zillow_export_db",
      "database_id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
    }
  ]
}
```

### 3. Deploy the SQL Schema to Production
Execute the table creation schema on your live production D1 database:
```bash
npx wrangler d1 execute zillow_export_db --remote --file=./schema.sql
```

### 4. Build and Deploy the Pages Site
Compile and upload the entire project to Cloudflare Pages:
```bash
# Build Vite production bundles
npm run build

# Deploy to Cloudflare Pages
npx wrangler pages deploy dist --project-name=zillow-export-site
```

During the deployment, Wrangler will prompt you to create a project if it doesn't exist. Choose **Yes**, and once completed, it will output your production live URL:
`https://zillow-export-site.pages.dev`

### 5. Sync the Chrome Extension to Production
- Go to Zillow, open **⚙️ Setup** in the extension dock.
- Change the URL to your live URL (e.g. `https://zillow-export-site.pages.dev`).
- Now, no matter where you are browsing, your listings will automatically sync directly to your live production cloud database!
