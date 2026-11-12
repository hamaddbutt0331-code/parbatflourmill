# Parbat Flour Mills – Find a Dealer (free version)

Customers ke liye public dealer locator website (Google Maps ke saath) aur password-protected admin panel.
Yeh version **muft** chalta hai:
- **Hosting:** Render ka free plan. Address `....onrender.com` milta hai.
- **Database:** Neon ka free Postgres database.

## Free version mein kya farq hai
- Website 15 minute tak koi na khole to Render ka free server so jata hai. Phir agla shakhs kholega to page khulne mein **taqreeban aadha se ek minute** lagta hai. Us ke baad sab tez chalta hai.
- Database bhi khaali rehne par so jata hai, aur zaroorat padne par khud jaag jata hai.
- Baad mein kabhi bhi Render ka paid plan le sakte hain. Is ke liye code mein koi tabdeeli nahi chahiye.

## Is mein kya hai
**Public website:**
- Home page par "Find Your Nearest Parbat Dealer", search aur "Near me" button.
- Google Map par har dealer ka pin. Har salesman ka rang alag hai, aur door se dekhne par qareeb ke pins ek group mein aa jate hain. Map aur Satellite dono views hain.
- Shop ka naam, mobile, town, area aur street se search. Filters: 4 salesmen, product (Atta, Maida, Choker, Atta + Maida, All), aur Town, Area, Street. Sab ek saath kaam karte hain.
- Dealer card: naam, contact person, mobile, address, products aur GPS. Saath mein **Call Now**, **WhatsApp** aur **Get Directions** ke buttons.
- Asli Parbat logo header, home page aur footer mein hai, aur browser tab ke icon mein bhi.
- SEO ke liye sitemap aur robots.txt bhi hain.

**Admin panel (`/admin`):**
- Dealer add, edit aur delete karna. Website par dikhana ya chhupana (Publish/Hide). Mobile public par dikhana ya chhupana. Products ke checkbox.
- GPS verify karna: satellite map par pin ko ghaseet kar sahi jagah rakhein, ya Google Maps ka link paste karein.
- Excel/CSV import: columns khud pehchane jate hain. Dealer pehle party code se, phir naam se milaya jata hai, is liye duplicate nahi banta. Milte-julte naam aap se confirm karwaye jate hain.
- Salesman aur town manage karna, website ki settings, activity log, password badalna, Excel export aur poora backup.

**Security:**
- Website ko sirf public fields milti hain. Sales, KG, ranking, party code aur admin ke notes kabhi bahar nahi jate.
- Admin password bcrypt se save hota hai. Login session cookie HttpOnly, Secure aur SameSite=Strict hai. Ghalat login ki koshishon par had hai, aur CSRF protection bhi hai.

**Data:** Pehli dafa chalne par 376 active dealers khud database mein load ho jate hain. In mein se 268 ki GPS hai aur woh website par dikhte hain.

---

## Live karne ka tareeqa (sab free)

### 1) Free database: Neon
1. https://neon.tech par **Sign up** karein (Google ya GitHub account se).
2. **Create project** dabayein. Naam rakhein `parbat`, Postgres version jo pehle se chuna ho wahi rehne dein, aur Region **Asia Pacific (Singapore)** chunein.
3. Project banne ke baad **Connect** button dabayein. Wahan **Connection string** copy karein. Yeh `postgresql://...neon.tech/neondb?sslmode=require` jaisi hoti hai.
4. Is ko sambhal kar rakhein. Yeh aap ke database ki chaabi hai, kisi ko na dein.

### 2) Google Maps key
1. https://console.cloud.google.com par jayein aur naya project banayein.
2. **Billing** mein card laga dein. Google is ke baghair Maps nahi deta. Har mahine kuch istemal muft hota hai.
3. **APIs & Services → Library → Maps JavaScript API → Enable**.
4. **Credentials → Create credentials → API key**. Key copy kar lein.
5. Website ban jane ke baad (Qadam 4) key ko apne address tak restrict karna hai.

### 3) Code GitHub par
1. https://github.com par free account banayein.
2. **New repository** dabayein. Naam `parbat-find-a-dealer` rakhein aur **Private** chunein.
3. Zip file kholein aur andar ki **saari files aur folders** "uploading an existing file" wale hisse mein ghaseet kar daal dein. Phir **Commit changes** dabayein.

### 4) Free hosting: Render
1. https://render.com par **GitHub se sign up** karein.
2. **New + → Blueprint** dabayein aur `parbat-find-a-dealer` repository chunein. Project mein mojood `render.yaml` file Render ko khud bata deti hai ke free plan aur Singapore region chahiye.
3. Render yeh values poochega:
   - `DATABASE_URL`: Neon wali connection string (Qadam 1)
   - `GOOGLE_MAPS_API_KEY`: Google wali key (Qadam 2)
   - `ADMIN_PASSWORD`: admin ka mazboot password, kam az kam 10 harf. Username `admin` hoga.
4. **Apply** dabayein. 3–5 minute mein website ban jayegi, jaise `https://parbat-find-a-dealer.onrender.com`.
5. Ab Google Cloud mein apni key kholein:
   - **Application restrictions:** Websites → `https://parbat-find-a-dealer.onrender.com/*`
   - **API restrictions:** sirf Maps JavaScript API
   - **Save** dabayein.

> Agar Blueprint ka option na mile: **New + → Web Service** chunein, repository chunein, Runtime **Node**, Build command `npm ci --omit=dev`, Start command `node server.js`, Instance **Free**. Phir Environment mein `DATABASE_URL`, `GOOGLE_MAPS_API_KEY`, `ADMIN_USER=admin`, `ADMIN_PASSWORD` aur `NODE_ENV=production` daal dein.

### 5) Pehli dafa admin
1. `https://parbat-find-a-dealer.onrender.com/admin` kholein. Username `admin` hai aur password wahi jo Qadam 4 mein diya tha.
2. **Account** tab mein password badal dein.
3. **Website settings** mein company ka phone, WhatsApp aur email daalein.
4. **Dealers → "GPS not verified"** se 5 dealers ki location satellite par check karein.

### 6) Google par aane ke liye (optional)
https://search.google.com/search-console par apna address add karein aur `sitemap.xml` submit karein.

---

## Baad mein
- **Backup:** Har mahine Admin → **Account → Download full backup** karein.
- **Apna domain:** Jab domain khareedein, Render → Settings → **Custom Domains** mein daal dein. Google key mein naya address bhi add kar dein.
- **Password bhool gaye:** Render → Environment mein `ADMIN_USER=admin`, naya `ADMIN_PASSWORD` aur `ADMIN_RESET_PASSWORD=yes` daalein aur save karein. Website restart hogi aur password badal jayega. Us ke baad `ADMIN_RESET_PASSWORD` mita dein.
- **Apne computer par chalana:** `.env.example` ko `.env` bana kar bharein, phir `npm install` aur `npm start` chalayein.
