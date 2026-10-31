# Palengke Express — Working 3-role delivery prototype

A rebuilt version of the supplied Palengke Express HTML. It includes a responsive Customer POV, Seller POV, Driver POV, a live order queue, driver booking workflow, real-time status and location broadcasts, and a map from Tanauan Public Market to the customer's destination.

## Quick start (Node.js 18+; no npm install required)

1. Extract the ZIP.
2. Open a terminal in the `palengke-express` folder.
3. Run `node server.js`.
4. Visit **http://localhost:3000**.
5. Open the same URL in three browser tabs and choose **Customer**, **Seller**, and **Driver** respectively. All tabs will update automatically.

For another phone/computer on the **same Wi-Fi**, start with `HOST=0.0.0.0 node server.js` on the host computer and open `http://<host-computer-IP>:3000` on the other device. The demo has **no authentication** and should NOT be exposed to the public internet.

## Try an end-to-end order

1. **Customer:** add products → View Cart → set your name and drop-off area → Place order.
2. **Seller:** new order automatically appears → Accept → Mark Ready → Book Driver Marco.
3. **Driver:** the booking appears automatically → Accept Delivery → Confirm Pickup → Start Delivery.
4. **Driver:** press **Simulate route** to see an explicitly labeled demo rider moving along the market-to-customer route, or **Share real GPS** to send permitted device coordinates.
5. **Customer / Seller:** select that order to see its current status and moving rider icon in the map. **Driver:** Mark as Delivered at the end.

## Files

- `index.html`: responsive, 3-role application shell
- `style.css`: all page styles and responsive mobile layouts
- `app.js`: front-end shopping, booking, and map logic
- `server.js`: dependency-free Node.js API, order persistence, and real-time Server-Sent Events (SSE)
- `data/orders.json`: automatically created on first order; holds orders for restart persistence

## Technical details and limitations

- **Live across tabs/devices:** Server-Sent Events keeps all open views synced. This is real state synchronization, not just a visual mockup.
- **Location:** Leaflet and OpenStreetMap tiles show the map. The public OSRM routing demo is queried for a road route; if it is down, the app shows a straight-line fallback. An internet connection is necessary for map tiles and road routing.
- **Real GPS:** A driver actively enables device location sharing through the browser. Browser GPS typically requires HTTPS or `localhost`, and must be explicitly permitted by the device user. Another device on `http://LAN-IP` may have GPS blocked because it is not a secure context; use HTTPS for that scenario.
- **Simulation:** A driver can start a **simulated** rider marker, visible as simulated in customer and seller views. It is not actual device location.
- **Delivery pins:** Predefined barangay coordinates are *illustrative sample pins*, not actual individual street addresses. For real deliveries, select real, verified addresses/geocoded coordinates.
- **Market pin:** Uses a published Tanauan City Public Market approximate coordinate (14.08204, 121.14672).
- **Security:** This is a **class/demo prototype only**. Role switching has no authentication. The server accepts user-selected roles, so anyone with access to this local server can modify orders. Do not use it for real customers or public deployment until proper login, role permissions, authentication, database, security protections, consent, and privacy policies are implemented.
- **Passwords:** The original uploaded HTML posted plaintext passwords to an external Google Apps Script endpoint. This version completely **removes** that endpoint and does not ask for or transmit passwords.
- **Pricing/products, COD, rider name, and drop-off areas are illustrative.**
- **Only one seeded delivery rider (`Marco Santos`)** is provided for this demo; booking assigns a request to that rider and the rider explicitly accepts. A production system should implement multiple verified riders and dispatch selection.

## Sources for map/location references

- Tanauan City Public Market sample coordinates: https://philippines.worldplaces.me/shopping-and-retail-in-tanauan/46690791-tanauan-city-public-market.html
- Leaflet: https://leafletjs.com/
- OpenStreetMap: https://www.openstreetmap.org/
- OSRM public routing service: https://project-osrm.org/

## Login and signup (Customer, Seller, Driver)

Every role has its own **Log in** and **Sign up** screen. Create one account for each role (different email addresses) to test on separate tabs. Session tokens are stored per browser tab using sessionStorage; if you refresh, you remain logged in until the server restarts. Accounts are stored locally in `data/users.json` with PBKDF2 salted password hashes (never plaintext passwords). Login is required for ordering, seller order actions, driver booking acceptance and location sharing. The server checks roles and driver assignment. Use the **Log out** button to leave your account.

**This is a local learning prototype**, not a hardened public deployment. Before using real customers, implement persistent secure sessions, rate limiting, TLS, audited account recovery, admin approval for sellers/drivers, and a database with appropriate data-retention rules. Any signup can currently choose Seller/Driver; do not expose this system publicly as-is.

## Send account and order events to YOUR Google Sheet

The Google Sheet is an **activity log**, not the app's primary database. The local Node.js server remains necessary for live order updates and rider GPS.

1. Use your Google Sheet: **https://docs.google.com/spreadsheets/d/1vXrp5mgSnwYKKQtb9GzKIp0QWT3PN6zgDCqMwQ8i7_o/edit**. The included `GoogleSheets.gs` is already configured for spreadsheet ID `1vXrp5mgSnwYKKQtb9GzKIp0QWT3PN6zgDCqMwQ8i7_o`.
2. In that sheet, open **Extensions → Apps Script**. Replace the script with the included `GoogleSheets.gs`.
3. In Apps Script, open **Project Settings → Script Properties** and add `PX_WEBHOOK_SECRET` with a long random value (at least 32 characters). Copy this value for step 5.
4. Click **Deploy → New deployment → Web app**, set **Execute as: Me**, **Who has access: Anyone**, authorize, deploy, and copy its `/exec` web app URL. The endpoint will reject posts without the matching secret. **Keep the URL and secret private.**
5. Configure the following two environment variables **before** starting `node server.js`:

   macOS/Linux (Terminal):
   ```sh
   export GOOGLE_SHEET_WEBHOOK_URL='https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec'
   export GOOGLE_SHEET_WEBHOOK_SECRET='YOUR_LONG_RANDOM_SECRET'
   node server.js
   ```

   Windows PowerShell:
   ```powershell
   $env:GOOGLE_SHEET_WEBHOOK_URL='https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec'
   $env:GOOGLE_SHEET_WEBHOOK_SECRET='YOUR_LONG_RANDOM_SECRET'
   node server.js
   ```

6. Register and log in to accounts, submit orders, accept orders and book deliveries. The sheet's **Activity Log** will record the date, event, account role/name/email, order ID, status, action and total.

**Never put your webhook secret in `app.js`, HTML, or public source control.** No passwords, password hashes, session tokens, or GPS coordinates are sent to Google Sheets. If the webhook cannot be reached, app activities still proceed; check your server terminal for webhook errors. Apps Script deploys may need an updated deployment after you change the script.

**Privacy note:** Customer names, emails and purchase records can be personal data. Control access to the sheet and retain only the data you need; get any necessary user consent.


## Expanded registration credentials
Seller signup now requires: full name, mobile, store/stall name and location, business registration type and number, BIR TIN, mayor's/business permit number, and government-issued ID type/number.

Driver signup now requires: full name, mobile, driver's license number/type/expiry, motorcycle type, make/model, plate number, and OR/CR reference number.

For privacy, passwords, password hashes, TIN, government ID numbers, license numbers, permit numbers, and OR/CR numbers are **not** sent to Google Sheets. They remain in the local prototype user database (`data/users.json`). The Activity Log only receives non-secret profile fields such as role, phone, store name/location, license type, motorcycle type/model, and plate number.

This is still a prototype. For production, credential documents should be uploaded to private object storage and reviewed by an administrator instead of being stored as plain JSON.


## Admin approval workflow

This version includes an **Admin POV**. Customers are approved immediately. Seller and driver signups are created with `pending` status and cannot log in until an admin approves them. The Admin POV lists all registered customer, seller, driver, and admin accounts and can approve or reject pending seller/driver accounts. Approval decisions are also sent to the Google Sheets Activity Log when the webhook is configured.

### Demo admin login

- Email: `admin@palengkeexpress.local`
- Password: `Admin12345!`

For anything beyond local testing, change these before starting the server:

```bash
ADMIN_EMAIL="your-admin@example.com" ADMIN_PASSWORD="use-a-long-unique-password" node server.js
```

On Windows PowerShell:

```powershell
$env:ADMIN_EMAIL="your-admin@example.com"
$env:ADMIN_PASSWORD="use-a-long-unique-password"
node server.js
```

If `data/users.json` already contains an admin, changing the environment variables does not replace that existing admin automatically. Delete the demo data only in a disposable test environment or create a proper admin-management flow before production use.


## Built-in Admin account sheet
The Admin POV includes a spreadsheet-style account database for Customer, Seller, Driver and Admin accounts. It shows account ID, role, name, email, phone, approval status, safe credential summaries and registration date. Passwords are intentionally **not readable** because the server stores only salted PBKDF2 password hashes. Admins can use **Reset** to set a new temporary password for a user. The previous password cannot be recovered.

## Admin password and account controls

The Admin POV can approve/reject seller and driver registrations, reset any non-admin user's password, and delete Customer/Seller/Driver accounts.

For security, the original password is **not** stored in readable form and therefore cannot be viewed. When the admin resets a password, the new temporary password is returned and displayed **once** so the admin can copy it and give it to the account owner. Only its secure hash is stored afterward.

Deleting an account removes it from the local account database and invalidates any active login sessions for that user. The deletion is also sent to the configured Google Sheets activity webhook as `account_deleted_by_admin` (without passwords or password hashes).

## Tester accounts

These development tester accounts are recreated when the server starts and are already approved:

- Customer: `customer@example.test` / `Abc123!`
- Seller: `seller@example.test` / `Abc123!`
- Driver: `driver@example.test` / `Abc123!`

They are for local/demo testing only. Do not use these fixed credentials in production.

## Customer seller stores
The Customer POV now lists every **approved Seller account as a store**. Customers select one store before shopping. New orders are saved with that seller/store ID, so only the selected seller receives and manages that order. Switching stores clears the cart to prevent mixing products from different sellers in one order.

## Dynamic approved seller stores and seller inventory

The Customer POV now lists **every approved seller as a separate store**. If 3 seller accounts are approved, customers see 3 stores; if 10 are approved, customers see 10. Selecting a store filters the catalog so the customer sees only products owned by that seller.

Each Seller POV now includes:

- Add product/item
- Edit product name, price, unit, and stock
- Remove product
- Live stock quantity shown to customers
- Manual Open/Closed control
- Automatic opening schedule with selected days, opening time, and closing time (Asia/Manila / Philippine time)

A closed store still appears in the Customer POV so buyers can browse it, but checkout is disabled by the server until the store is open. Orders are also validated against that seller's own inventory, and stock is reduced when an order is successfully placed.

## Customer account settings
Customers now have a **Settings** button in the Customer POV. They can update their email address, mobile number, and default delivery address. They can also change their password after entering the current password. The saved default address is prefilled during checkout.

For security, passwords are stored only as one-way hashes and are not written to Google Sheets.

## Clean UI refresh
- The old dark-green left sidebar was replaced with a white brand/navigation area for a cleaner full-page look.
- The duplicate left-side Log out button was removed. Logout remains in the profile-circle menu.
- The duplicate Customer Settings buttons were removed. Settings remains in the profile-circle menu.
- Approved seller stores are now selected from a compact dropdown instead of large store cards.
- The selected store's open/closed state, location, owner and item count remain visible before browsing its catalog.


## Live GPS delivery tracking update

- Sellers should open their Seller dashboard once at the physical stall and click **Use this device location** to save the exact pickup GPS.
- Drivers can share **real GPS** immediately after accepting a delivery. The app uses `navigator.geolocation.watchPosition()` with high accuracy and sends live coordinates to the backend.
- Before pickup, the active route is rider → seller. After **Start Delivery**, it switches to rider → customer.
- Customers receive in-app status alerts for seller confirmation, driver request/assignment, pickup, on-the-way, nearby, and delivered. If browser notification permission is enabled, the same alerts can appear as browser notifications while the app is active/backgrounded.
- The nearby alert is triggered once when live rider GPS is within about **500 m** of the customer's GPS destination.
- Accurate tracking requires HTTPS, location permission, Location Services enabled, and a customer checkout destination captured with **Use my exact GPS location**. Typed addresses alone do not automatically become exact coordinates in this prototype.
- This prototype does not provide true background push notifications when the web app is fully terminated; that requires a push service/APNs or a native notification backend.
