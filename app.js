/* =========================================================
   Lisha Studio app.js

   This file controls behavior only:
   - reads Settings / Products / Shipping CSV
   - renders product cards and categories
   - opens product detail modal
   - manages cart in localStorage
   - validates checkout form
   - calls Cloudflare Worker for PayPal payment

   Security rule:
   The browser shows estimated product price and shipping, but it is not trusted.
   On payment, app.js sends only productId / sku / qty / shippingRegion / customer info.
   The Worker must reread Products CSV + Shipping CSV and recalculate the final amount.
   ========================================================= */

/* =========================
   1. Data source settings
   ========================= */

const SETTINGS_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRQ5vcuUBnI85arPNNe2h-aqwqq_9RpCBN0oewhCexPjWd-nX7YW-j3ii_5JlwvZZ7VlyjZ_RSTVwD5/pub?gid=0&single=true&output=csv";
const PRODUCTS_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRQ5vcuUBnI85arPNNe2h-aqwqq_9RpCBN0oewhCexPjWd-nX7YW-j3ii_5JlwvZZ7VlyjZ_RSTVwD5/pub?gid=22339288&single=true&output=csv";
const SHIPPING_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRQ5vcuUBnI85arPNNe2h-aqwqq_9RpCBN0oewhCexPjWd-nX7YW-j3ii_5JlwvZZ7VlyjZ_RSTVwD5/pub?gid=206682554&single=true&output=csv";

const IMAGE_BASE_URL = "https://pub-32f3f529081e4033a9e6ecf3fd1297ae.r2.dev/images/";
const WORKER_PAYMENT_URL = "https://lishastudio-payment.ldeng123.workers.dev";

const CART_STORAGE_KEY = "lisha_studio_cart";
const SHIPPING_REGION_STORAGE_KEY = "lisha_studio_shipping_region";

/* =========================
   2. Runtime state
   ========================= */

let productGroups = [];
let allProductRows = [];
let settings = {};
let cart = [];
let shippingRules = [];
let selectedShippingRegion = localStorage.getItem(SHIPPING_REGION_STORAGE_KEY) || "";
let currentModalImages = [];
let currentModalImageIndex = 0;
let paypalButtonsRendered = false;

/* =========================
   3. CSV helpers
   Google Sheet published tabs are read as CSV.
   ========================= */

function parseCSV(text) {
  const rows = [];
  let row = [];
  let value = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (char === '"' && inQuotes && nextChar === '"') {
      value += '"';
      i++;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      row.push(value);
      value = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (value || row.length) {
        row.push(value);
        rows.push(row);
        row = [];
        value = "";
      }
      if (char === "\r" && nextChar === "\n") i++;
    } else {
      value += char;
    }
  }

  if (value || row.length) {
    row.push(value);
    rows.push(row);
  }

  return rows;
}

function rowsToObjects(rows) {
  if (!rows.length) return [];
  const headers = rows[0].map(h => h.trim().toLowerCase());

  return rows.slice(1)
    .filter(row => row.some(cell => String(cell).trim() !== ""))
    .map(row => {
      const obj = {};
      headers.forEach((header, index) => {
        obj[header] = row[index] ? row[index].trim() : "";
      });
      return obj;
    });
}

async function loadCSV(url) {
  const response = await fetch(url + "&cacheBust=" + Date.now());
  if (!response.ok) throw new Error("Could not load CSV: " + url);

  const text = await response.text();
  return rowsToObjects(parseCSV(text));
}

function val(row, key) {
  return row[key.toLowerCase()] || "";
}

function safeSlug(text) {
  return String(text || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-");
}

/* =========================
   4. Settings and money helpers
   ========================= */

function textSetting(key, fallback) {
  return settings[key.toLowerCase()] || fallback;
}

function numericSetting(key, fallback) {
  const value = Number(settings[key.toLowerCase()]);
  return Number.isNaN(value) ? fallback : value;
}

function currencyCode() {
  return textSetting("currency.code", "USD");
}

function money(value) {
  const n = Number(value);
  if (Number.isNaN(n)) return "";
  return currencyCode() + " " + n.toFixed(2);
}

function priceHTML(row) {
  const price = Number(val(row, "price"));
  const compare = Number(val(row, "compareprice"));

  if (Number.isNaN(price)) return "";

  if (!Number.isNaN(compare) && compare > price) {
    return `<span class="compare-price">${money(compare)}</span><span>${money(price)}</span>`;
  }

  return `<span>${money(price)}</span>`;
}

/* =========================
   5. Shipping rules
   Shipping CSV headers should be:
   Region | Cost | MinFree
   The code reads MinFree as row.minfree because headers are lowercased.
   ========================= */

async function loadShippingRules() {
  try {
    const rows = await loadCSV(SHIPPING_CSV_URL);

    shippingRules = rows
      .filter(row => row.region)
      .map(row => ({
        region: row.region,
        cost: Number(row.cost || 0),
        minFree: Number(row.minfree || 999999)
      }));

    // Do not auto-select a region. Customer must choose one before payment.
    if (selectedShippingRegion && !shippingRules.some(rule => rule.region === selectedShippingRegion)) {
      selectedShippingRegion = "";
      localStorage.removeItem(SHIPPING_REGION_STORAGE_KEY);
    }
  } catch (error) {
    console.warn("Could not load shipping rules:", error);
    shippingRules = [];
  }
}

function selectedShippingRule() {
  if (!selectedShippingRegion) return null;
  return shippingRules.find(rule => rule.region === selectedShippingRegion) || null;
}

function changeShippingRegion(region) {
  selectedShippingRegion = region;
  localStorage.setItem(SHIPPING_REGION_STORAGE_KEY, selectedShippingRegion);
  renderCart();
}

function renderShippingSelector() {
  if (!shippingRules.length) return "";

  return `
    <div class="summary-row">
      <span></span>
      <select id="shippingRegionSelect" onchange="changeShippingRegion(this.value)">
        <option value="" ${!selectedShippingRegion ? "selected" : ""}>region</option>
        ${shippingRules.map(rule => `
          <option value="${rule.region}" ${rule.region === selectedShippingRegion ? "selected" : ""}>
            ${rule.region}
          </option>
        `).join("")}
      </select>
    </div>
  `;
}


async function refreshShippingRulesInBackground() {
  await loadShippingRules();
  renderCart();
}

/* =========================
   6. Product status and image helpers
   Image naming:
   cover:  {id}-cover.jpg
   sku:    {id}-{sku}.jpg
   detail: {id}-1.jpg, {id}-2.jpg, etc.
   ========================= */

function getStatus(row) {
  const status = val(row, "status").trim().toLowerCase();

  if (status === "hidden") return "hidden";

  const hasRequired =
    val(row, "id") &&
    val(row, "name") &&
    val(row, "price") &&
    val(row, "category");

  if (status !== "active" || !hasRequired) return "comingsoon";

  const stock = Number(val(row, "stock") || 0);
  if (stock <= 0) return "soldout";

  return "active";
}

function statusLabel(status) {
  if (status === "soldout") return "Sold out";
  if (status === "comingsoon") return "Coming soon";
  return "";
}

function imageUrl(name) {
  return IMAGE_BASE_URL + name + ".jpg";
}

function coverImage(row) {
  return imageUrl(`${val(row, "id")}-cover`);
}

function skuImage(row) {
  const id = val(row, "id");
  const sku = safeSlug(val(row, "sku"));
  return sku ? imageUrl(`${id}-${sku}`) : coverImage(row);
}

function detailImage(row, number) {
  return imageUrl(`${val(row, "id")}-${number}`);
}

function fallbackLetter(row) {
  const name = val(row, "name");
  return name ? name.charAt(0).toUpperCase() : "✦";
}

function imageBlock(src, row, badge = "") {
  return `
    ${badge ? `<div class="badge">${badge}</div>` : ""}
    <span class="fallback-letter">${fallbackLetter(row)}</span>
    <img src="${src}" alt="${val(row, "name")}" loading="lazy" onerror="this.style.display='none'">
  `;
}

/* =========================
   7. Product grouping and rendering
   Same product id = one product with multiple SKUs.
   ========================= */

function groupProducts(rows) {
  const visibleRows = rows.filter(row => getStatus(row) !== "hidden");
  const map = new Map();

  visibleRows.forEach(row => {
    const id = val(row, "id");
    if (!id) return;

    if (!map.has(id)) map.set(id, []);
    map.get(id).push(row);
  });

  return Array.from(map.entries()).map(([id, rows]) => {
    const activeRows = rows.filter(row => getStatus(row) === "active");
    const soldoutRows = rows.filter(row => getStatus(row) === "soldout");
    const comingRows = rows.filter(row => getStatus(row) === "comingsoon");

    let groupStatus = "comingsoon";
    if (activeRows.length > 0) groupStatus = "active";
    else if (soldoutRows.length > 0 && comingRows.length === 0) groupStatus = "soldout";

    const displayRow = activeRows[0] || soldoutRows[0] || comingRows[0] || rows[0];

    return {
      id,
      rows,
      displayRow,
      status: groupStatus,
      name: val(displayRow, "name"),
      category: val(displayRow, "category")
    };
  });
}

function productPrice(group) {
  const validRows = group.rows.filter(row => {
    const status = getStatus(row);
    return status === "active" || status === "soldout";
  });

  const prices = validRows
    .map(row => Number(val(row, "price")))
    .filter(n => !Number.isNaN(n));

  if (!prices.length) return "";

  const min = Math.min(...prices);
  const max = Math.max(...prices);

  return min === max ? money(min) : "From " + money(min);
}

function productStock(group) {
  if (group.status === "comingsoon") return "Coming soon";
  if (group.status === "soldout") return "Sold out";

  const total = group.rows
    .filter(row => getStatus(row) === "active")
    .reduce((sum, row) => sum + Number(val(row, "stock") || 0), 0);

  return total + " in stock";
}

function productDescription(group) {
  return val(group.displayRow, "shortdescription") || val(group.displayRow, "longdescription") || "";
}

function productCard(group) {
  const badge = statusLabel(group.status);
  const cover = coverImage(group.displayRow);

  return `
    <article class="card" onclick="openProductModal('${group.id}')">
      <div class="image">
        ${imageBlock(cover, group.displayRow, badge)}
      </div>
      <div class="card-body">
        <h3>${group.name}</h3>
        <p class="desc">${productDescription(group)}</p>
        <div class="meta">
          <div class="price">${productPrice(group)}</div>
          <div class="stock">${productStock(group)}</div>
        </div>
      </div>
    </article>
  `;
}

function renderCategories() {
  const select = document.getElementById("categoryFilter");
  select.innerHTML = `<option value="all">All categories</option>`;

  [...new Set(productGroups.map(group => group.category).filter(Boolean))]
    .sort()
    .forEach(category => {
      select.innerHTML += `<option value="${category}">${category}</option>`;
    });
}

function renderProducts() {
  const grid = document.getElementById("productGrid");
  const query = document.getElementById("searchInput").value.trim().toLowerCase();
  const category = document.getElementById("categoryFilter").value;

  const filtered = productGroups.filter(group => {
    const text = group.rows.map(row => [
      val(row, "id"),
      val(row, "name"),
      val(row, "sku"),
      val(row, "category"),
      val(row, "materials"),
      val(row, "shortdescription"),
      val(row, "longdescription")
    ].join(" ")).join(" ").toLowerCase();

    return text.includes(query) && (category === "all" || group.category === category);
  });

  grid.innerHTML = filtered.length
    ? filtered.map(productCard).join("")
    : `<div class="error">No products found.</div>`;
}

/* =========================
   8. Settings rendering
   Settings CSV controls text, links, and hero video.
   ========================= */

function applySettings(rows) {
  rows.forEach(row => {
    const key = val(row, "key").toLowerCase();
    const value = val(row, "value");
    if (key) settings[key] = value;
  });

  const title = textSetting("index.herotitle", "Lisha Studio");
  const subtitle = textSetting("index.herosubtitle", "Handmade little joy");
  const featured = textSetting("index.featuredtitle", "Featured Pieces");
  const video = textSetting("index.herovideo", "");

  document.title = title + " | Handmade Art Objects";
  document.getElementById("heroTitle").textContent = title;
  document.getElementById("heroSubtitle").textContent = subtitle;
  document.getElementById("featuredTitle").textContent = featured;

  document.getElementById("contactTitle").textContent = textSetting("contact.title", "Contact");
  document.getElementById("contactNote").textContent = textSetting("contact.note", "For custom orders, collaborations, or questions, feel free to contact me.");
  document.getElementById("contactCustom").textContent = textSetting("contact.custom", "Custom colors, small gifts, and playful handmade pieces are welcome.");
  document.getElementById("contactShipping").textContent = textSetting("contact.shipping", "Each piece is packed carefully before shipping.");
  document.getElementById("contactResponse").textContent = textSetting("contact.response", "I usually reply within 1–2 business days.");
  document.getElementById("cartShippingNote").textContent = textSetting("shipping.note", "Choose your shipping region before checkout.");

  const links = document.getElementById("contactLinks");
  links.innerHTML = "";

  const email = textSetting("contact.email", "");
  const whatsapp = textSetting("contact.whatsapp", "");
  const youtube = textSetting("contact.youtube", "");

  if (email) links.innerHTML += `<a href="mailto:${email}">Email</a>`;
  if (whatsapp) links.innerHTML += `<a href="${whatsapp}" target="_blank" rel="noopener">WhatsApp</a>`;
  if (youtube) links.innerHTML += `<a href="${youtube}" target="_blank" rel="noopener">YouTube</a>`;

  const videoArea = document.getElementById("videoArea");
  const videoMedia = document.getElementById("videoMedia");

  if (!video) {
    videoArea.style.display = "none";
    videoMedia.innerHTML = "";
  } else {
    videoArea.style.display = "block";

    if (video.includes("youtube.com") || video.includes("youtu.be") || video.includes("vimeo.com")) {
      videoMedia.innerHTML = `<iframe src="${video}" allowfullscreen></iframe>`;
    } else {
      videoMedia.innerHTML = `
        <video autoplay muted loop playsinline>
          <source src="${video}" type="video/mp4">
        </video>
      `;
    }
  }
}

/* =========================
   9. Product modal
   ========================= */

function modalImagesForGroup(group) {
  const images = [coverImage(group.displayRow)];

  group.rows.forEach(row => {
    if (val(row, "sku")) images.push(skuImage(row));
  });

  [1, 2, 3, 4, 5].forEach(number => {
    images.push(detailImage(group.displayRow, number));
  });

  return images;
}

function openProductModal(id) {
  const group = productGroups.find(group => group.id === id);
  if (!group) return;

  const selectedRow = group.rows.find(row => getStatus(row) === "active") || group.displayRow;

  currentModalImages = modalImagesForGroup(group);
  currentModalImageIndex = 0;

  renderModal(group, selectedRow);

  document.getElementById("productModal").style.display = "flex";
  document.body.style.overflow = "hidden";
}

function closeProductModal() {
  document.getElementById("productModal").style.display = "none";
  document.body.style.overflow = "";
}

function changeModalImage(direction) {
  if (!currentModalImages.length) return;

  currentModalImageIndex += direction;

  if (currentModalImageIndex < 0) currentModalImageIndex = currentModalImages.length - 1;
  if (currentModalImageIndex >= currentModalImages.length) currentModalImageIndex = 0;

  const image = document.getElementById("modalSlideImage");

  if (image) {
    image.style.display = "block";
    image.src = currentModalImages[currentModalImageIndex];
  }
}

function renderModal(group, selectedRow) {
  const status = getStatus(selectedRow);
  const badge = statusLabel(status);
  const stock = Number(val(selectedRow, "stock") || 0);

  const stockText =
    status === "active" ? stock + " in stock" :
    status === "soldout" ? "Sold out" :
    "Coming soon";

  const priceText =
    status === "active" || status === "soldout"
      ? priceHTML(selectedRow)
      : "";

  const skuButtons = group.rows.length > 1
    ? `
      <div class="sku-options">
        ${group.rows.map(row => {
          const label = val(row, "sku") || "Default";
          const active = row === selectedRow ? "active" : "";
          return `<button class="sku-option ${active}" onclick="selectSku('${group.id}', '${label}')">${label}</button>`;
        }).join("")}
      </div>
    `
    : "";

  const actionButton = status === "active"
    ? `<button class="button" onclick="addToCartFromRow('${val(selectedRow, "id")}', '${val(selectedRow, "sku")}')">Add to cart</button>`
    : `<button class="button disabled">${stockText}</button>`;

  document.getElementById("modalContent").innerHTML = `
    <div>
      <div class="modal-main-image" id="modalMainImage">
        ${badge ? `<div class="badge">${badge}</div>` : ""}
        <span class="fallback-letter">${fallbackLetter(selectedRow)}</span>
        <img id="modalSlideImage" src="${currentModalImages[currentModalImageIndex]}" alt="${val(selectedRow, "name")}" onerror="this.style.display='none'">
        <button class="image-arrow left" onclick="changeModalImage(-1)">‹</button>
        <button class="image-arrow right" onclick="changeModalImage(1)">›</button>
      </div>
    </div>

    <div class="modal-info">
      <h2>${val(selectedRow, "name")}</h2>
      <p>${val(selectedRow, "longdescription") || val(selectedRow, "shortdescription") || ""}</p>

      ${skuButtons}

      <div class="meta">
        <div class="price">${priceText}</div>
        <div class="stock">${stockText}</div>
      </div>

      <ul class="details-list">
        ${val(selectedRow, "category") ? `<li><strong>Category:</strong> ${val(selectedRow, "category")}</li>` : ""}
        ${val(selectedRow, "materials") ? `<li><strong>Materials:</strong> ${val(selectedRow, "materials")}</li>` : ""}
        ${val(selectedRow, "weight") ? `<li><strong>Weight:</strong> ${val(selectedRow, "weight")} kg</li>` : ""}
        ${(val(selectedRow, "length") || val(selectedRow, "width") || val(selectedRow, "height"))
          ? `<li><strong>Size:</strong> ${val(selectedRow, "length")} × ${val(selectedRow, "width")} × ${val(selectedRow, "height")} cm</li>`
          : ""}
      </ul>

      ${actionButton}
    </div>
  `;
}

function selectSku(groupId, skuLabel) {
  const group = productGroups.find(group => group.id === groupId);
  if (!group) return;

  const selected = group.rows.find(row => (val(row, "sku") || "Default") === skuLabel);
  if (!selected) return;

  const selectedSkuImage = skuImage(selected);
  currentModalImageIndex = currentModalImages.indexOf(selectedSkuImage);
  if (currentModalImageIndex < 0) currentModalImageIndex = 0;

  renderModal(group, selected);
}

/* =========================
   10. Cart
   Cart is stored in browser localStorage.
   This is for user convenience only, not final pricing security.
   ========================= */

function cartItemKey(productId, sku) {
  return productId + "::" + (sku || "");
}

function loadCart() {
  try {
    const saved = localStorage.getItem(CART_STORAGE_KEY);
    cart = saved ? JSON.parse(saved) : [];
  } catch {
    cart = [];
  }
}

function saveCart() {
  localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
}

function findProductRow(productId, sku) {
  return allProductRows.find(row => val(row, "id") === productId && val(row, "sku") === sku)
    || allProductRows.find(row => val(row, "id") === productId && !val(row, "sku"));
}

function addToCartFromRow(productId, sku) {
  const row = findProductRow(productId, sku);
  if (!row) return alert("Product not found.");

  if (getStatus(row) !== "active") {
    return alert("This item is not available right now.");
  }

  const stock = Number(val(row, "stock") || 0);
  const key = cartItemKey(productId, sku);
  const existing = cart.find(item => item.key === key);
  const currentQty = existing ? existing.qty : 0;

  if (currentQty + 1 > stock) {
    return alert("Not enough stock.");
  }

  if (existing) {
    existing.qty += 1;
  } else {
    cart.push({
      key,
      productId,
      sku,
      name: val(row, "name"),
      price: Number(val(row, "price")),
      image: sku ? skuImage(row) : coverImage(row),
      qty: 1,
      stock
    });
  }

  saveCart();
  renderCart();
  toggleCart(true);
}

function updateCartQty(key, change) {
  const item = cart.find(item => item.key === key);
  if (!item) return;

  const nextQty = item.qty + change;

  if (nextQty <= 0) {
    cart = cart.filter(cartItem => cartItem.key !== key);
  } else if (nextQty <= item.stock) {
    item.qty = nextQty;
  } else {
    alert("Not enough stock.");
  }

  saveCart();
  renderCart();
}

function removeFromCart(key) {
  cart = cart.filter(item => item.key !== key);
  saveCart();
  renderCart();
}

function cartSubtotal() {
  return cart.reduce((sum, item) => sum + item.price * item.qty, 0);
}

function cartShipping(subtotal) {
  if (cart.length === 0) return 0;

  const rule = selectedShippingRule();
  if (!rule) return 0;

  return subtotal >= rule.minFree ? 0 : rule.cost;
}


function renderCart() {
  const count = cart.reduce((sum, item) => sum + item.qty, 0);
  document.getElementById("cartCount").textContent = count;

  const itemsEl = document.getElementById("cartItems");
  const summaryEl = document.getElementById("cartSummary");

  if (!cart.length) {
    itemsEl.innerHTML = `<p class="cart-note">Your cart is empty.</p>`;
    summaryEl.innerHTML = "";
    return;
  }

  itemsEl.innerHTML = cart.map(item => `
    <div class="cart-item">
      <div class="cart-thumb">
        <img src="${item.image}" alt="${item.name}" onerror="this.style.display='none'">
      </div>
      <div class="cart-info">
        <h3>${item.name}</h3>
        <p>${item.sku ? item.sku + " · " : ""}${money(item.price)}</p>
        <div class="cart-line">
          <div class="qty-controls">
            <button class="qty-btn" onclick="updateCartQty('${item.key}', -1)">−</button>
            <strong>${item.qty}</strong>
            <button class="qty-btn" onclick="updateCartQty('${item.key}', 1)">+</button>
          </div>
          <button class="remove-btn" onclick="removeFromCart('${item.key}')">Remove</button>
        </div>
      </div>
    </div>
  `).join("");

  const subtotal = cartSubtotal();
  const shipping = cartShipping(subtotal);
  const total = subtotal + shipping;
  const shippingWarning = textSetting(
    "shipping.warning",
    "Estimated delivery: 5–8 business days. Please make sure your PayPal shipping address matches the selected shipping region."
  );

  summaryEl.innerHTML = `
    <div class="summary-row"><span>Subtotal</span><span>${money(subtotal)}</span></div>
    ${renderShippingSelector()}
    <div class="summary-row"><span>Shipping fee</span><span>${!selectedShippingRegion ? "Please select your region to see the shipping cost" : shipping === 0 ? "FREE" : money(shipping)}</span></div>
    <div class="summary-row total"><span>Total</span><span>${money(total)}</span></div>
    <p class="cart-warning">${shippingWarning}</p>
  `;
}

function toggleCart(forceShow) {
  const drawer = document.getElementById("cartDrawer");

  if (typeof forceShow === "boolean") {
    drawer.classList.toggle("open", forceShow);
  } else {
    drawer.classList.toggle("open");
  }

  if (drawer.classList.contains("open")) {
    refreshShippingRulesInBackground();
  }
}

/* =========================
   11. PayPal checkout
   Customer shipping/contact details are collected in the PayPal window.
   Browser only sends product references and selected shipping region.
   Worker must recalculate price from Products CSV + Shipping CSV.
   ========================= */

function buildOrderPayload() {
  return {
    currency: currencyCode(),
    shippingRegion: selectedShippingRegion,
    items: cart.map(item => ({
      productId: item.productId,
      sku: item.sku,
      qty: item.qty
    }))
  };
}

function setupPayPalButtons() {
  if (!window.paypal || paypalButtonsRendered) return;

  paypalButtonsRendered = true;

  paypal.Buttons({
    createOrder: async () => {
      if (!cart.length) {
        alert("Your cart is empty.");
        throw new Error("Cart is empty");
      }

      if (!selectedShippingRegion) {
        alert("Please select a shipping region before payment.");
        throw new Error("Missing shipping region");
      }

      const response = await fetch(`${WORKER_PAYMENT_URL}/create-paypal-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildOrderPayload())
      });

      const data = await response.json();

      if (!response.ok || !data.ok || !data.paypalOrderId) {
        console.error(data);
        alert("Could not create PayPal order:\n" + JSON.stringify(data));
        throw new Error("Could not create PayPal order");
      }

      return data.paypalOrderId;
    },

    onApprove: async (data) => {
      const response = await fetch(`${WORKER_PAYMENT_URL}/capture-paypal-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paypalOrderId: data.orderID,
          ...buildOrderPayload(),
          orderNote: "Website PayPal checkout"
        })
      });

      const result = await response.json();

      if (result.ok) {
        alert("Payment successful. Thank you for your order!");
        cart = [];
        saveCart();
        renderCart();
        toggleCart(false);
      } else {
        console.error(result);
        alert("Payment was approved, but capture failed. Please contact Lisha Studio.");
      }
    },

    onCancel: () => {
      alert("Payment cancelled.");
    },

    onError: (error) => {
      console.error(error);
      alert("PayPal checkout error. Please try again.");
    }
  }).render("#paypal-button-container");
}

/* =========================
   12. App startup
   ========================= */

async function init() {
  try {
    loadCart();

    const [settingsRows, productRows] = await Promise.all([
      loadCSV(SETTINGS_CSV_URL),
      loadCSV(PRODUCTS_CSV_URL)
    ]);

    await loadShippingRules();

    applySettings(settingsRows);

    allProductRows = productRows;
    productGroups = groupProducts(productRows);

    renderCategories();
    renderProducts();
    renderCart();
    setupPayPalButtons();

    document.getElementById("searchInput").addEventListener("input", renderProducts);
    document.getElementById("categoryFilter").addEventListener("change", renderProducts);

    document.getElementById("modalClose").addEventListener("click", closeProductModal);

    document.getElementById("productModal").addEventListener("click", event => {
      if (event.target.id === "productModal") closeProductModal();
    });

    document.addEventListener("keydown", event => {
      if (event.key === "Escape") closeProductModal();
    });
  } catch (error) {
    console.error(error);
    document.getElementById("productGrid").innerHTML = `<div class="error">Could not load products. Please check the Google Sheets links.</div>`;
  }
}

init();
