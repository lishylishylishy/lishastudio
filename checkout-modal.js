/*
  checkout-modal.js
  功能：PayPal 付款前强制确认 region + 输入电话。
  客户必须勾选确认框，并填写 delivery phone number，才能继续 PayPal。
*/

(function () {
  let resolver = null;

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
        width: min(440px, 100%);
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

      .checkout-modal-error {
        display: none;
        color: #c0392b;
        font-size: 13px;
        font-weight: 800;
        margin: 8px 0 0;
      }

      .checkout-modal-error.show {
        display: block;
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

      .checkout-modal-btn.continue {
        background: var(--accent, #f08a5d);
        border-color: var(--accent, #f08a5d);
        color: white;
      }

      .checkout-modal-btn.continue:hover {
        background: var(--accent-dark, #d9693f);
        border-color: var(--accent-dark, #d9693f);
      }

      .checkout-modal-btn.continue:disabled {
        opacity: 0.45;
        cursor: not-allowed;
        background: #ddd;
        border-color: #ddd;
        color: #777;
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
          <p class="checkout-modal-error" id="checkoutPhoneError">
            Please confirm the shipping region and enter your delivery phone number.
          </p>
        </div>

        <p class="checkout-modal-warning">
          Your PayPal shipping address should match the selected region.
        </p>

        <div class="checkout-modal-actions">
          <button type="button" class="checkout-modal-btn cancel" id="checkoutModalCancel">Cancel</button>
          <button type="button" class="checkout-modal-btn continue" id="checkoutModalContinue" disabled>Continue to PayPal</button>
        </div>
      </div>
    `;

    document.body.appendChild(wrapper);

    document.getElementById("checkoutModalCancel").addEventListener("click", closeCheckoutModalCancel);
    document.getElementById("checkoutModalContinue").addEventListener("click", confirmCheckoutModal);

    document.getElementById("checkoutPhoneInput").addEventListener("input", updateContinueButton);
    document.getElementById("checkoutRegionConfirm").addEventListener("change", updateContinueButton);

    wrapper.addEventListener("click", function (event) {
      if (event.target.id === "checkoutModalBackdrop") {
        closeCheckoutModalCancel();
      }
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && wrapper.classList.contains("open")) {
        closeCheckoutModalCancel();
      }
    });
  }

  function formatMoney(currency, amount) {
    const n = Number(amount);
    if (Number.isNaN(n)) return currency + " " + amount;
    return currency + " " + n.toFixed(2);
  }

  function updateContinueButton() {
    const phone = document.getElementById("checkoutPhoneInput").value.trim();
    const confirmed = document.getElementById("checkoutRegionConfirm").checked;
    const button = document.getElementById("checkoutModalContinue");

    button.disabled = !(phone && confirmed);
  }

  function closeCheckoutModalCancel() {
    const backdrop = document.getElementById("checkoutModalBackdrop");
    if (backdrop) backdrop.classList.remove("open");

    if (resolver) {
      resolver({ ok: false, phone: "" });
      resolver = null;
    }
  }

  function confirmCheckoutModal() {
    const phoneInput = document.getElementById("checkoutPhoneInput");
    const confirmInput = document.getElementById("checkoutRegionConfirm");
    const error = document.getElementById("checkoutPhoneError");

    const phone = phoneInput.value.trim();
    const confirmed = confirmInput.checked;

    if (!phone || !confirmed) {
      error.classList.add("show");
      phoneInput.focus();
      return;
    }

    error.classList.remove("show");

    const backdrop = document.getElementById("checkoutModalBackdrop");
    if (backdrop) backdrop.classList.remove("open");

    if (resolver) {
      resolver({ ok: true, phone });
      resolver = null;
    }
  }

  window.openCheckoutConfirmModal = function (options) {
    injectCheckoutModalStyles();
    injectCheckoutModalHtml();

    const currency = options.currency || "USD";
    const shippingText = Number(options.shippingFee) === 0
      ? "FREE"
      : formatMoney(currency, options.shippingFee);

    document.getElementById("checkoutModalRegion").textContent = options.shippingRegion || "";
    document.getElementById("checkoutModalShipping").textContent = shippingText;
    document.getElementById("checkoutModalTotal").textContent = formatMoney(currency, options.total);

    const phoneInput = document.getElementById("checkoutPhoneInput");
    const confirmInput = document.getElementById("checkoutRegionConfirm");
    const error = document.getElementById("checkoutPhoneError");

    phoneInput.value = options.phone || "";
    confirmInput.checked = false;
    error.classList.remove("show");

    updateContinueButton();

    document.getElementById("checkoutModalBackdrop").classList.add("open");

    setTimeout(function () {
      phoneInput.focus();
    }, 80);

    return new Promise(function (resolve) {
      resolver = resolve;
    });
  };
})();
