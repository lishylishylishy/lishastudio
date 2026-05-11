/*
  checkout-modal.js
  功能：
  - 点击购物车里的 Continue to checkout 后，弹出确认小窗
  - 客户必须确认 shipping region
  - 客户必须输入 delivery phone number
  - 满足条件后，弹窗里的 PayPal 按钮才显示
*/

(function () {
  let readyHandler = null;

  function injectCheckoutModalStyles() {
    if (document.getElementById("checkoutModalStyles")) return;

    const style = document.createElement("style");
    style.id = "checkoutModalStyles";
    style.textContent = `
      .checkout-modal-backdrop {
        position: fixed;
        inset: 0;
        z-index: 120;
        background: rgba(31, 27, 24, 0.42);
        display: none;
        align-items: center;
        justify-content: center;
        padding: 22px;
      }

      .checkout-modal-backdrop.open {
        display: flex;
      }

      .checkout-modal {
        width: min(450px, 100%);
        max-height: 92vh;
        overflow: auto;
        background: var(--bg, #fffdf8);
        border: 1px solid var(--line, #eee5dc);
        border-radius: 28px;
        box-shadow: 0 28px 80px rgba(31, 27, 24, 0.24);
        padding: 26px;
      }

      .checkout-modal h2 {
        font-family: "Baloo 2", cursive;
        font-size: 32px;
        line-height: 1;
        margin: 0 0 10px;
        color: var(--text, #1f1b18);
      }

      .checkout-modal-note {
        margin: 0 0 18px;
        color: var(--muted, #756d66);
        font-size: 14px;
        line-height: 1.55;
      }

      .checkout-modal-summary {
        border-top: 1px solid var(--line, #eee5dc);
        border-bottom: 1px solid var(--line, #eee5dc);
        padding: 12px 0;
        margin: 0 0 16px;
      }

      .checkout-modal-row {
        display: flex;
        justify-content: space-between;
        gap: 14px;
        margin: 8px 0;
        color: var(--muted, #756d66);
        font-weight: 800;
      }

      .checkout-modal-row strong {
        color: var(--text, #1f1b18);
        text-align: right;
      }

      .checkout-confirm-check {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        margin: 0 0 16px;
        color: var(--text, #1f1b18);
        font-size: 14px;
        line-height: 1.45;
        font-weight: 800;
        cursor: pointer;
      }

      .checkout-confirm-check input {
        margin-top: 3px;
        width: 16px;
        height: 16px;
        cursor: pointer;
        accent-color: var(--accent, #f08a5d);
      }

      .checkout-modal-field label {
        display: block;
        margin: 0 0 7px;
        color: var(--text, #1f1b18);
        font-weight: 900;
        font-size: 14px;
      }

      .checkout-modal-field input {
        width: 100%;
        border: 1px solid var(--line, #eee5dc);
        background: white;
        border-radius: 999px;
        padding: 13px 17px;
        font-family: "Nunito", Arial, sans-serif;
        font-size: 15px;
        outline: none;
      }

      .checkout-modal-field input:focus {
        border-color: var(--accent, #f08a5d);
      }

      .checkout-modal-warning {
        color: #c0392b;
        font-size: 13px;
        font-weight: 800;
        line-height: 1.45;
        margin: 14px 0 0;
      }

      .checkout-modal-actions {
        display: flex;
        gap: 10px;
        margin-top: 20px;
      }

      .checkout-modal-btn {
        flex: 1;
        border: 1px solid var(--line, #eee5dc);
        border-radius: 999px;
        padding: 13px 14px;
        font-family: "Nunito", Arial, sans-serif;
        font-size: 15px;
        font-weight: 900;
        cursor: pointer;
      }

      .checkout-modal-btn.cancel {
        background: white;
        color: var(--text, #1f1b18);
      }

      .checkout-modal-btn.cancel:hover {
        background: linear-gradient(135deg, var(--soft, #fff4e4), var(--pink, #ffe8ec));
      }

      .checkout-paypal-hint {
        color: var(--muted, #756d66);
        font-size: 13px;
        line-height: 1.5;
        margin: 16px 0 0;
        text-align: center;
      }

      .checkout-paypal-box {
        margin-top: 16px;
      }

      .checkout-paypal-box.hidden {
        display: none;
      }

      @media (max-width: 560px) {
        .checkout-modal {
          padding: 22px;
        }

        .checkout-modal h2 {
          font-size: 28px;
        }

        .checkout-modal-actions {
          flex-direction: column;
        }
      }
    `;

    document.head.appendChild(style);
  }

  function injectCheckoutModalHtml() {
    if (document.getElementById("checkoutModalBackdrop")) return;

    const wrapper = document.createElement("div");
    wrapper.id = "checkoutModalBackdrop";
    wrapper.className = "checkout-modal-backdrop";
    wrapper.innerHTML = `
      <div class="checkout-modal" role="dialog" aria-modal="true" aria-labelledby="checkoutModalTitle">
        <h2 id="checkoutModalTitle">Confirm checkout</h2>

        <p class="checkout-modal-note">
          Please confirm your shipping region and enter a phone number for delivery.
        </p>

        <div class="checkout-modal-summary">
          <div class="checkout-modal-row">
            <span>Shipping region</span>
            <strong id="checkoutModalRegion"></strong>
          </div>
          <div class="checkout-modal-row">
            <span>Shipping fee</span>
            <strong id="checkoutModalShipping"></strong>
          </div>
          <div class="checkout-modal-row">
            <span>Total</span>
            <strong id="checkoutModalTotal"></strong>
          </div>
        </div>

        <label class="checkout-confirm-check">
          <input id="checkoutRegionConfirm" type="checkbox">
          <span>I confirm this shipping region matches my PayPal shipping address.</span>
        </label>

        <div class="checkout-modal-field">
          <label for="checkoutPhoneInput">Delivery phone number *</label>
          <input id="checkoutPhoneInput" type="tel" autocomplete="tel" placeholder="Phone number for delivery">
        </div>

        <p class="checkout-modal-warning">
          Your PayPal shipping address should match the selected shipping region.
        </p>

        <p class="checkout-paypal-hint" id="checkoutPaypalHint">
          Please confirm the shipping region and enter your phone number to continue.
        </p>

        <div class="checkout-paypal-box hidden" id="checkoutPaypalBox">
          <div id="checkoutPaypalButtonContainer"></div>
        </div>

        <div class="checkout-modal-actions">
          <button type="button" class="checkout-modal-btn cancel" id="checkoutModalCancel">Cancel</button>
        </div>
      </div>
    `;

    document.body.appendChild(wrapper);

    document.getElementById("checkoutModalCancel").addEventListener("click", closeCheckoutModal);
    document.getElementById("checkoutPhoneInput").addEventListener("input", updateCheckoutReady);
    document.getElementById("checkoutRegionConfirm").addEventListener("change", updateCheckoutReady);

    wrapper.addEventListener("click", function (event) {
      if (event.target.id === "checkoutModalBackdrop") {
        closeCheckoutModal();
      }
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && wrapper.classList.contains("open")) {
        closeCheckoutModal();
      }
    });
  }

  function formatMoney(currency, amount) {
    const n = Number(amount);
    if (Number.isNaN(n)) return currency + " " + amount;
    return currency + " " + n.toFixed(2);
  }

  function updateCheckoutReady() {
    const phone = document.getElementById("checkoutPhoneInput").value.trim();
    const confirmed = document.getElementById("checkoutRegionConfirm").checked;
    const ready = Boolean(phone && confirmed);

    const paypalBox = document.getElementById("checkoutPaypalBox");
    const hint = document.getElementById("checkoutPaypalHint");

    if (ready) {
      paypalBox.classList.remove("hidden");
      hint.style.display = "none";
    } else {
      paypalBox.classList.add("hidden");
      hint.style.display = "block";
    }

    if (typeof readyHandler === "function") {
      readyHandler({
        ready,
        phone
      });
    }
  }

  function closeCheckoutModal() {
    const backdrop = document.getElementById("checkoutModalBackdrop");
    if (backdrop) backdrop.classList.remove("open");
  }

  window.setCheckoutModalReadyHandler = function (handler) {
    readyHandler = handler;
  };

  window.openCheckoutModal = function (options) {
    injectCheckoutModalStyles();
    injectCheckoutModalHtml();

    const currency = options.currency || "USD";
    const shippingText = Number(options.shippingFee) === 0
      ? "FREE"
      : formatMoney(currency, options.shippingFee);

    document.getElementById("checkoutModalRegion").textContent = options.shippingRegion || "";
    document.getElementById("checkoutModalShipping").textContent = shippingText;
    document.getElementById("checkoutModalTotal").textContent = formatMoney(currency, options.total);

    document.getElementById("checkoutPhoneInput").value = options.phone || "";
    document.getElementById("checkoutRegionConfirm").checked = false;

    updateCheckoutReady();

    document.getElementById("checkoutModalBackdrop").classList.add("open");

    setTimeout(function () {
      document.getElementById("checkoutPhoneInput").focus();
    }, 80);
  };

  window.closeCheckoutModal = closeCheckoutModal;
})();
