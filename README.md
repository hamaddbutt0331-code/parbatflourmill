# Parbat Flour Mills – Find a Dealer

Customers ke liye public dealer locator website (Google Maps ke saath) aur ek password-protected admin panel.

## Is mein kya hai

**Public website (`/`, `/contact`)**
- "Find Your Nearest Parbat Dealer" ka home page. Search bar aur "Near me" button (phone ki GPS se qareeb ke dealers).
- Google Map par har dealer ka pin. Har salesman ka rang alag hai, aur door se dekhne par qareeb ke pins ek group mein aa jate hain. Map aur Satellite dono views hain.
- Shop ka naam, mobile, town, area aur street se search. Salesman (4) ke filter, product filter (Atta, Maida, Choker, Atta + Maida, All), aur Town/Area/Street ke filter. Sab filter ek saath kaam karte hain.
- Pin ya list par click karne se dealer card khulta hai: naam, contact person, mobile, address, area, street, town, products aur GPS. Saath mein **Call Now**, **WhatsApp** aur **Get Directions** ke buttons.
- SEO: page titles, description, sitemap.xml, robots.txt, Organization schema, aur saare dealers ki area-wise list HTML mein (Google ke liye).

**Admin panel (`/admin`, sirf password se)**
- Dealer add, edit aur delete karna. Website par dikhana ya chhupana (Publish/Hide). Mobile ko public par dikhana ya chhupana. Products ke checkbox.
- GPS verify karna: satellite map par pin ko ghaseet kar sahi jagah rakhein, ya Google Maps ka link paste karein.
- Excel/CSV import: columns khud pehchane jate hain (aap badal bhi sakte hain). Dealer pehle party code se, phir naam se milaya jata hai, is liye duplicate nahi banta. Milte-julte naam aap se confirm karwaye jate hain. Khaali cell purana data kabhi nahi mitata.
- Salesman add karna, naam ya rang badalna, ya website se band karna. Town add karna.
- Website settings (company address, phone, WhatsApp, email, map ka shuru wala hissa).
- Activity log, password badalna, Excel export, database backup.

**Security**
- Public API (`/api/public/dealers`) sirf yeh fields deti hai: naam, contact person, mobile (agar "show" ho), address, town, area, street, GPS, products aur salesman ka naam. Sales, KG, ranking, purchase history, internal notes, party code aur GPS verification **kabhi bahar nahi jate**. Yeh data na kisi file mein hai na browser ke code mein.
- Admin password bcrypt se save hota hai. Session cookie HttpOnly, SameSite=Strict aur Secure hai. Login par 15 minute mein 6 ghalat koshishon ki had hai. Admin API par CSRF protection hai. Security headers aur CSP lage hue hain.

## Pehle se mojood data

`data/seed-dealers.json` mein 4 salesmen (Zahid Amjad, Zahid Shah, Nadeem Ahmed, Rana Waheed) ke **376 active dealers** hain:
- 268 ki GPS maujood hai, woh website par dikhenge.
- 108 ki GPS abhi nahi hai. Woh admin mein "Missing GPS" ke tehat hain aur GPS daalne ke baad publish ho sakte hain.
- Products (Atta/Maida/Choker) 1 Sep 2026 ke baad ki khareed se tay kiye gaye hain. Sirf "available hai ya nahi" save hai, koi quantity nahi.

---

## Website live karne ka tareeqa

### 1) Google Maps API key banayein (zaroori)
1. https://console.cloud.google.com par jayein aur ek naya project banayein (masalan "Parbat Dealer Map").
2. **Billing** account lagayein. Google is ke baghair Maps nahi chalata. Har mahine kuch free istemal milta hai; mojooda had Google Maps Platform pricing page par dekh lein.
3. **APIs & Services → Library** mein **Maps JavaScript API** enable karein.
4. **APIs & Services → Credentials → Create credentials → API key**.
5. Key ko **restrict** karein:
   - Application restrictions: **Websites**. Is mein `https://aapkadomain.com/*` aur `https://www.aapkadomain.com/*` daalein.
   - API restrictions: sirf **Maps JavaScript API**.
6. Yeh key aage `.env` file mein `GOOGLE_MAPS_API_KEY` mein daalni hai.

### 2) Hosting: teen mein se ek tareeqa

**Tareeqa A: Render.com (sab se aasaan)**
1. Yeh folder GitHub par ek private repository mein upload karein.
2. Render par **New → Web Service** banayein aur repository chunein. Runtime **Docker** rakhein, kyunke Dockerfile project mein maujood hai.
3. **Disk** add karein: Mount path `/data`, size 1 GB. Is ke baghair har deploy par data mit jayega.
4. **Environment** mein yeh values daalein: `NODE_ENV=production`, `BASE_URL=https://aapkadomain.com`, `GOOGLE_MAPS_API_KEY=...`, `ADMIN_USER=...`, `ADMIN_PASSWORD=...` (kam az kam 10 characters), `TRUST_PROXY=true`.
5. Deploy karein. Pehli dafa chalne par dealers khud load ho jayenge.
6. **Settings → Custom Domain** mein apna domain daalein. Domain ki DNS mein Render ka diya hua CNAME record laga dein. HTTPS khud lag jata hai.

**Tareeqa B: Apna VPS (Hostinger VPS, DigitalOcean waghera) aur Docker**
```bash
docker build -t parbat-dealers .
docker run -d --name parbat --restart unless-stopped -p 3000:3000 -v parbat_data:/data \
  -e NODE_ENV=production -e BASE_URL=https://aapkadomain.com -e GOOGLE_MAPS_API_KEY=... \
  -e ADMIN_USER=admin -e ADMIN_PASSWORD='Mazboot-Password-123' -e TRUST_PROXY=true parbat-dealers
```
Is ke aage Nginx ya Caddy laga kar HTTPS aur domain set karein.

**Tareeqa C: Docker ke baghair, sirf Node.js (Node 18 ya naya)**
```bash
cp .env.example .env      # phir .env mein values bharein
npm install --omit=dev
npm run seed              # sirf pehli dafa: 376 dealers load karta hai
npm start
```
Note: `better-sqlite3` ek native library hai. Kuch sasti shared cPanel hosting par yeh install nahi hoti. Aisa ho to Tareeqa A ya B istemal karein.

### 3) Live hone ke baad
- `https://aapkadomain.com/admin` par sign in karein. **Account** tab mein password badal dein.
- **Website settings** mein company ka phone, WhatsApp aur email daalein. Yeh Contact page par nazar aayenge.
- **Dealers → "GPS not verified"** filter se 5 dealers ki location satellite map par check karein.
- **Dealers → "Missing GPS"** mein jo dealers hain, un ki GPS daal kar unhein website par dikhayein.
- Google Search Console mein apna domain add karein aur `https://aapkadomain.com/sitemap.xml` submit karein.

### Backup
- Admin → **Account → Download database backup** (poora database) aur **Download Excel**. Har mahine ek copy sambhal kar rakhein.
- Database ki file `DATA_DIR/parbat.db` mein hai.

### Admin bhool jayein to
Server par yeh command chalayein: `npm run create-admin -- admin NayaMazbootPassword123` (yeh password reset bhi kar deta hai).

## Files
- `server.js`: website, public API, admin API aur security
- `src/db.js`: database tables aur default settings
- `src/importer.js`: Excel/CSV import aur duplicate se bachao
- `views/`: public pages (home, contact, 404)
- `public/assets/`: website ka design, map ka code, logo
- `admin/`: admin login aur panel (sirf sign in ke baad)
- `data/seed-dealers.json`: shuru ka dealer data (sirf public fields aur products)
