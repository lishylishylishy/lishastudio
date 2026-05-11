const SETTINGS_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRQ5vcuUBnI85arPNNe2h-aqwqq_9RpCBN0oewhCexPjWd-nX7YW-j3ii_5JlwvZZ7VlyjZ_RSTVwD5/pub?gid=0&single=true&output=csv"; // Settings 表 CSV
const PRODUCTS_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRQ5vcuUBnI85arPNNe2h-aqwqq_9RpCBN0oewhCexPjWd-nX7YW-j3ii_5JlwvZZ7VlyjZ_RSTVwD5/pub?gid=22339288&single=true&output=csv"; // Products 表 CSV
const SHIPPING_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRQ5vcuUBnI85arPNNe2h-aqwqq_9RpCBN0oewhCexPjWd-nX7YW-j3ii_5JlwvZZ7VlyjZ_RSTVwD5/pub?gid=206682554&single=true&output=csv"; // Shipping 表 CSV

const IMAGE_BASE_URL = "https://pub-32f3f529081e4033a9e6ecf3fd1297ae.r2.dev/images/"; // 商品图片基础地址
const WORKER_PAYMENT_URL = "https://lishastudio-payment.ldeng123.workers.dev"; // Cloudflare Worker 支付接口

const CART_STORAGE_KEY = "lisha_studio_cart"; // 购物车本地缓存名
const SHIPPING_REGION_STORAGE_KEY = "lisha_studio_shipping_region"; // 已选 region 本地缓存名

let productGroups = []; // 分组后的商品
let allProductRows = []; // Products 表原始数据
let settings = {}; // Settings 表内容
let cart = []; // 购物车内容
let shippingRules = []; // Shipping 表运费规则
let selectedShippingRegion = localStorage.getItem(SHIPPING_REGION_STORAGE_KEY) || ""; // 当前选择的 region
let currentModalImages = []; // 商品弹窗图片
let currentModalImageIndex = 0; // 当前弹窗图片索引
let paypalButtonsRendered = false; // 防止 PayPal 按钮重复渲染
let confirmedCustomerPhone = ""; // 客户在确认弹窗里填写的发货电话

function parseCSV(text) { // 解析 CSV 文本
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

function rowsToObjects(rows) { // CSV 行转对象；表头会转小写
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

async function loadCSV(url) { // 读取 Google Sheet CSV
  const joiner = url.includes("?") ? "&" : "?";
  const response = await fetch(url + joiner + "cacheBust=" + Date.now());

  if (!response.ok) throw new Error("Could not load CSV: " + url);

  const text = await response.text();
  return rowsToObjects(parseCSV(text));
}

function val(row, key) { // 读取 row 字段，避免大小写问题
  return row[key.toLowerCase()] || "";
}

function safeSlug(text) { // SKU 转成图片文件名可用格式
  return String(text || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-");
}

function textSetting(key, fallback) { // 读取 Settings 文本
  return settings[key.toLowerCase()] || fallback;
}

function numericSetting(key, fallback) { // 读取 Settings 数字
  const value = Number(settings[key.toLowerCase()]);
  return Number.isNaN(value) ? fallback : value;
}

function currencyCode() { // 货币代码，比如 USD
  return textSetting("currency.code", "USD");
}

function money(value) { // 金额显示格式
  const n = Number(value);
  if (Number.isNaN(n)) return "";
  return currencyCode() + " " + n.toFixed(2);
}

function priceHTML(row) { // 商品价格 HTML，含划线价
  const price = Number(val(row, "price"));
  const compare = Number(val(row, "compareprice"));

  if (Number.isNaN(price)) return "";

  if (!Number.isNaN(compare) && compare > price) {
    return `<span class="compare-price">${money(compare)}</span><span>${money(price)}</span>`;
  }

  return `<span>${money(price)}</span>`;
}

async function loadShippingRules() { // 读取 Shipping 表：Region / Cost / MinFree
  try {
    const rows = await loadCSV(SHIPPING_CSV_URL);

    shippingRules = rows
      .filter(row => row.region)
      .map(row => ({
        region: row.region,
        cost: Number(row.cost || 0),
        minFree: Number(row.minfree || 999999)
      }));

    if (selectedShippingRegion && !shippingRules.some(rule => rule.region === selectedShippingRegion)) {
      selectedShippingRegion = "";
      localStorage.removeItem(SHIPPING_REGION_STORAGE_KEY);
    }
  } catch (error) {
    console.warn("Could not load shipping rules:", error);
    shippingRules = [];
  }
}

function selectedShippingRule() { // 找到当前 region 对应运费规则
  if (!selectedShippingRegion) return null;
  return shippingRules.find(rule => rule.region === selectedShippingRegion) || null;
}

function changeShippingRegion(region) { // 用户切换 region 后刷新购物车金额
  selectedShippingRegion = region;

  if (region) {
    localStorage.setItem(SHIPPING_REGION_STORAGE_KEY, region);
  } else {
    localStorage.removeItem(SHIPPING_REGION_STORAGE_KEY);
  }

  renderCart();
}

function renderShippingSelector() { // 购物车里的 region 下拉菜单
  if (!shippingRules.length) return "";

  return `
    <select class="shipping-region-select" id="shippingRegionSelect" onchange="changeShippingRegion(this.value)">
      <option value="" ${!selectedShippingRegion ? "selected" : ""}>Select shipping region</option>
      ${shippingRules.map(rule => `
        <option value="${rule.region}" ${rule.region === selectedShippingRegion ? "selected" : ""}>
          ${rule.region}
        </option>
      `).join("")}
    </select>
  `;
}

async function refreshShippingRulesInBackground() { // 打开购物车时刷新运费规则
  await loadShippingRules();
  renderCart();
}

function getStatus(row) { // 判断商品状态：active / soldout / comingsoon / hidden
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

function statusLabel(status) { // 商品角标文字
  if (status === "soldout") return "Sold out";
  if (status === "comingsoon") return "Coming soon";
  return "";
}

function imageUrl(name) { // 拼图片 URL
  return IMAGE_BASE_URL + name + ".jpg";
}

function coverImage(row) { // 封面图：id-cover.jpg
  return imageUrl(`${val(row, "id")}-cover`);
}

function skuImage(row) { // SKU 图：id-sku.jpg
  const id = val(row, "id");
  const sku = safeSlug(val(row, "sku"));
  return sku ? imageUrl(`${id}-${sku}`) : coverImage(row);
}

function detailImage(row, number) { // 详情图：id-1.jpg / id-2.jpg
  return imageUrl(`${val(row, "id")}-${number}`);
}

function fallbackLetter(row) { // 图片加载失败时显示首字母
  const name = val(row, "name");
  return name ? name.charAt(0).toUpperCase() : "✦";
}

function imageBlock(src, row, badge = "") { // 商品图片块
  return `
    ${badge ? `<div class="badge">${badge}</div>` : ""}
    <span class="fallback-letter">${fallbackLetter(row)}</span>
    <img src="${src}" alt="${val(row, "name")}" loading="lazy" onerror="this.style.display='none'">
  `;
}

function groupProducts(rows) { // 相同 id 的商品合并成一个产品，SKU 在弹窗里选
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

function productPrice(group) { // 商品卡片价格；多 SKU 时显示 From
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

function productStock(group) { // 商品卡片库存显示
  if (group.status === "comingsoon") return "Coming soon";
  if (group.status === "soldout") return "Sold out";

  const total = group.rows
    .filter(row => getStatus(row) === "active")
    .reduce((sum, row) => sum + Number(val(row, "stock") || 0), 0);

  return total + " in stock";
}

function productDescription(group) { // 商品卡片短描述
  return val(group.displayRow, "shortdescription") || val(group.displayRow, "longdescription") || "";
}

function productCard(group) { // 渲染单个商品卡片
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

function renderCategories() { // 渲染首页 category 筛选
  const select = document.getElementById("categoryFilter");
  select.innerHTML = `<option value="all">All categories</option>`;

  [...new Set(productGroups.map(group => group.category).filter(Boolean))]
    .sort()
    .forEach(category => {
      select.innerHTML += `<option value="${category}">${category}</option>`;
    });
}

function renderProducts() { // 渲染商品列表
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

function applySettings(rows) { // 应用 Settings 表内容
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

function modalImagesForGroup(group) { // 商品弹窗图片列表
  const images = [coverImage(group.displayRow)];

  group.rows.forEach(row => {
    if (val(row, "sku")) images.push(skuImage(row));
  });

  [1, 2, 3, 4, 5].forEach(number => {
    images.push(detailImage(group.displayRow, number));
  });

  return images;
}

function openProductModal(id) { // 打开商品弹窗
  const group = productGroups.find(group => group.id === id);
  if (!group) return;

  const selectedRow = group.rows.find(row => getStatus(row) === "active") || group.displayRow;

  currentModalImages = modalImagesForGroup(group);
  currentModalImageIndex = 0;

  renderModal(group, selectedRow);

  document.getElementById("productModal").style.display = "flex";
  document.body.style.overflow = "hidden";
}

function closeProductModal() { // 关闭商品弹窗
  document.getElementById("productModal").style.display = "none";
  document.body.style.overflow = "";
}

function changeModalImage(direction) { // 商品弹窗切换图片
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

function renderModal(group, selectedRow) { // 渲染商品详情弹窗
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

function selectSku(groupId, skuLabel) { // 选择 SKU
  const group = productGroups.find(group => group.id === groupId);
  if (!group) return;

  const selected = group.rows.find(row => (val(row, "sku") || "Default") === skuLabel);
  if (!selected) return;

  const selectedSkuImage = skuImage(selected);
  currentModalImageIndex = currentModalImages.indexOf(selectedSkuImage);
  if (currentModalImageIndex < 0) currentModalImageIndex = 0;

  renderModal(group, selected);
}

function cartItemKey(productId, sku) { // 购物车 item 唯一 key
  return productId + "::" + (sku || "");
}

function loadCart() { // 从 localStorage 读取购物车
  try {
    const saved = localStorage.getItem(CART_STORAGE_KEY);
    cart = saved ? JSON.parse(saved) : [];
  } catch {
    cart = [];
  }
}

function saveCart() { // 保存购物车到 localStorage
  localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
}

function findProductRow(productId, sku) { // 根据 id + sku 找商品行
  return allProductRows.find(row => val(row, "id") === productId && val(row, "sku") === sku)
    || allProductRows.find(row => val(row, "id") === productId && !val(row, "sku"));
}

function addToCartFromRow(productId, sku) { // 加入购物车
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

function updateCartQty(key, change) { // 修改购物车数量
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

function removeFromCart(key) { // 移除购物车 item
  cart = cart.filter(item => item.key !== key);
  saveCart();
  renderCart();
}

function cartSubtotal() { // 商品小计
  return cart.reduce((sum, item) => sum + item.price * item.qty, 0);
}

function cartShipping(subtotal) { // 根据 region 算前端展示运费；最终运费由 Worker 再算一次
  if (cart.length === 0) return 0;

  const rule = selectedShippingRule();
  if (!rule) return 0;

  return subtotal >= rule.minFree ? 0 : rule.cost;
}

function renderCart() { // 渲染购物车
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

  summaryEl.innerHTML = `
    <div class="summary-row">
      <span>Subtotal</span>
      <span>${money(subtotal)}</span>
    </div>

    <div class="summary-row shipping-fee-row">
      ${renderShippingSelector()}
      <span>${!selectedShippingRegion ? "" : shipping === 0 ? "FREE" : money(shipping)}</span>
    </div>

    <div class="summary-row total">
      <span>Total</span>
      <span>${money(total)}</span>
    </div>
  `;
}

function toggleCart(forceShow) { // 打开/关闭购物车抽屉
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

function buildOrderPayload() { // 发给 Worker 的订单数据；不传前端价格
  return {
    currency: currencyCode(),
    shippingRegion: selectedShippingRegion,
    customerPhone: confirmedCustomerPhone,
    items: cart.map(item => ({
      productId: item.productId,
      sku: item.sku,
      qty: item.qty
    }))
  };
}

function setupPayPalButtons() { // PayPal 按钮
  if (!window.paypal || paypalButtonsRendered) return;

  paypalButtonsRendered = true;

  paypal.Buttons({
    /*
      重要：
      onClick 会在 PayPal 窗口继续打开之前执行。
      所以这里可以强制先弹出你自己的确认小窗。
      客户必须：
      1. 已选择 shipping region
      2. 勾选确认 region 匹配 PayPal 地址
      3. 输入 delivery phone number
      才能继续 PayPal。
    */
    onClick: async (data, actions) => {
      if (!cart.length) {
        alert("Your cart is empty.");
        return actions.reject();
      }

      if (!selectedShippingRegion) {
        alert("Please select your shipping region before checkout.");
        return actions.reject();
      }

      if (typeof openCheckoutConfirmModal !== "function") {
        alert("Checkout confirmation could not load. Please refresh the page and try again.");
        return actions.reject();
      }

      const subtotal = cartSubtotal();
      const shipping = cartShipping(subtotal);
      const total = subtotal + shipping;

      const confirmed = await openCheckoutConfirmModal({
        shippingRegion: selectedShippingRegion,
        shippingFee: shipping,
        total: total,
        currency: currencyCode(),
        phone: confirmedCustomerPhone
      });

      if (!confirmed.ok) {
        return actions.reject();
      }

      confirmedCustomerPhone = confirmed.phone;
      return actions.resolve();
    },

    /*
      只有 onClick 通过后，才会执行 createOrder。
      所以 PayPal order 不会在客户确认前创建。
    */
    createOrder: async () => {
      const response = await fetch(`${WORKER_PAYMENT_URL}/create-paypal-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildOrderPayload())
      });

      const data = await response.json();

      if (!response.ok || !data.ok || !data.paypalOrderId) {
        console.error(data);
        alert("Could not create PayPal order. Please try again.");
        throw new Error("Could not create PayPal order");
      }

      return data.paypalOrderId;
    },

    onApprove: async (data) => { // 买家批准后扣款并写入 Orders
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
        confirmedCustomerPhone = "";

        saveCart();
        renderCart();
        toggleCart(false);
      } else {
        console.error(result);
        alert("Payment was approved, but capture failed. Please contact Lisha Studio.");
      }
    },

    onCancel: () => { // 买家取消 PayPal 付款
      alert("Payment cancelled.");
    },

    onError: (error) => { // PayPal 错误
      const message = error && error.message ? error.message : String(error);

      // 用户取消你自己的确认弹窗时，不显示 PayPal error
      if (
        message.includes("Expected an order id to be passed") ||
        message.includes("Checkout confirmation cancelled")
      ) {
        return;
      }

      console.error(error);
      alert("PayPal checkout error. Please try again.");
    }
  }).render("#paypal-button-container");
}

async function init() { // 页面启动
  loadCart();

  try {
    const settingsRows = await loadCSV(SETTINGS_CSV_URL);
    applySettings(settingsRows);
  } catch (error) {
    console.error("Settings load failed:", error);
  }

  try {
    await loadShippingRules();
  } catch (error) {
    console.error("Shipping load failed:", error);
  }

  try {
    const productRows = await loadCSV(PRODUCTS_CSV_URL);
    allProductRows = productRows;
    productGroups = groupProducts(productRows);
    renderCategories();
    renderProducts();
  } catch (error) {
    console.error("Products load failed:", error);
    document.getElementById("productGrid").innerHTML = `<div class="error">Could not load products. Please check the Google Sheets links.</div>`;
  }

  renderCart();
  setupPayPalButtons();

  document.getElementById("searchInput")?.addEventListener("input", renderProducts);
  document.getElementById("categoryFilter")?.addEventListener("change", renderProducts);
  document.getElementById("modalClose")?.addEventListener("click", closeProductModal);

  document.getElementById("productModal")?.addEventListener("click", event => {
    if (event.target.id === "productModal") closeProductModal();
  });

  document.addEventListener("keydown", event => {
    if (event.key === "Escape") closeProductModal();
  });
}

init();
