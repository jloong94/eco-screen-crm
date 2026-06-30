import { roles } from "./data.js";
import { renderAddProductForm, renderProducts, attachProductEvents } from "./products.js";
import { attachQuotationEvents, renderQuotationForm } from "./quotations.js";
import { setRole, state } from "./state.js";
import { attachWorkflowEvents, renderWorkflowModules } from "./workflow.js";

function appHtml() {
  return `
    <header class="topbar">
      <div class="brand">
        <div class="logo">ES</div>
        <div>
          <p>Eco Screen CRM V2</p>
          <h1>Quotation CRM</h1>
        </div>
      </div>
      <nav id="roleSelector" class="role-selector">
        ${roles.map((role) => `<button class="role-btn ${state.role === role ? "active" : ""}" data-role="${role}" type="button">${role}</button>`).join("")}
      </nav>
    </header>

    <main class="layout">
      <section class="panel quotation-panel">
        <div class="panel-head">
          <div>
            <p class="eyebrow">Phase 1</p>
            <h2>Quotation</h2>
          </div>
          <div class="actions">
            <button class="btn" id="newQuoteButton" type="button">New Quote</button>
            <button class="btn" id="printQuoteButton" type="button">Print Quote</button>
            <button class="btn" id="pdfQuoteButton" type="button">PDF Quote</button>
            <button class="btn primary" id="saveQuoteButton" type="button">Save Quote</button>
          </div>
        </div>

        <form id="quotationForm" class="stack" onsubmit="return false">
          <div class="form-grid">
            <label>Quotation Number<input id="quoteNumber" /></label>
            <label>Quotation Status<select id="quoteStatus"></select></label>
            <label>Customer Name<input id="customerName" placeholder="TEST CUSTOMER" /></label>
            <label>Phone<input id="customerPhone" placeholder="0123456789" /></label>
            <label>Area<input id="customerArea" placeholder="Bukit Tengah" /></label>
            <label>Appointment Date<input id="appointmentDate" type="date" /></label>
            <label class="wide">Address<textarea id="customerAddress" rows="3"></textarea></label>
            <label class="wide">Customer Remark<textarea id="customerRemark" rows="2"></textarea></label>
            <label class="wide">Quotation Remark<textarea id="quoteRemark" rows="2"></textarea></label>
          </div>

          <section class="products-editor">
            <div class="section-head">
              <div>
                <h3>Products</h3>
                <span id="itemsCount" class="pill">Items count: 0</span>
              </div>
              <button class="btn primary" id="addItemButton" type="button">Add Item</button>
            </div>
            <div id="quoteItems" class="quote-items"></div>
          </section>

          <aside class="summary-box">
            <label>Discount<input id="discount" inputmode="decimal" placeholder="0.00" /></label>
            <label>Deposit<input id="deposit" inputmode="decimal" placeholder="0.00" /></label>
            <div class="summary-row"><span>Subtotal</span><strong id="subtotalValue">RM 0.00</strong></div>
            <div class="summary-row"><span>Total</span><strong id="totalValue">RM 0.00</strong></div>
            <div class="summary-row balance"><span>Balance</span><strong id="balanceValue">RM 0.00</strong></div>
            <p id="saveStatus" class="muted-text">Ready.</p>
          </aside>
        </form>
      </section>

      <aside class="side-column">
        <section class="panel">
          <div class="panel-head"><h2>Saved Quotations</h2></div>
          <div id="quotationList" class="quote-list"></div>
        </section>

        <section class="panel">
          <div class="panel-head"><h2>Product Management</h2></div>
          <div id="addProductPanel"></div>
          <p id="productSaveStatus" class="muted-text"></p>
          <div id="productList" class="product-list"></div>
        </section>
      </aside>

      <section class="panel workflow-panel" id="ordersPanel">
        <div class="panel-head">
          <h2>Orders</h2>
          <span class="pill" id="workflowStatus">Ready</span>
        </div>
        <div id="orderList" class="workflow-list"></div>
      </section>

      <section class="panel workflow-panel">
        <div class="panel-head"><h2>Production Jobs</h2></div>
        <div id="productionList" class="workflow-list"></div>
      </section>

      <section class="panel workflow-panel">
        <div class="panel-head"><h2>Installation Jobs</h2></div>
        <div id="installationList" class="workflow-list"></div>
      </section>
    </main>

    <section id="printArea" class="print-area">
      <div class="print-head">
        <div>
          <h1>Eco Screen Sdn Bhd</h1>
          <p>24 Jalan Iks Bukit Tengah, Taman Iks Bukit Tengah, 14000 BM</p>
          <p>Tel: 0197563499</p>
        </div>
        <div>
          <p>Quotation</p>
          <h2 id="printQuoteNumber"></h2>
        </div>
      </div>
      <div class="print-customer" id="printCustomer"></div>
      <table>
        <thead>
          <tr>
            <th>#</th><th>Product</th><th>Size</th><th>Qty</th><th>Color</th><th>Handle</th><th>Material</th><th>Remark</th><th class="right">Unit</th><th class="right">Amount</th>
          </tr>
        </thead>
        <tbody id="printItems"></tbody>
      </table>
      <div id="printTotals" class="print-totals"></div>
      <div class="terms">
        <p>Prices quoted are valid for two (2) weeks from the quotation date.</p>
        <p>50% deposit is required upon confirmation. Deposit paid is not refundable.</p>
      </div>
    </section>
    <section id="workflowPrintArea" class="print-area workflow-print-area"></section>
  `;
}

function renderShell() {
  document.querySelector("#app").innerHTML = appHtml();
  attachRoleEvents();
  attachQuotationEvents();
  attachProductEvents();
  attachWorkflowEvents();
  renderQuotationForm();
  renderAddProductForm();
  renderProducts();
  renderWorkflowModules();
  applyRoleAccess();
}

function attachRoleEvents() {
  document.querySelector("#roleSelector").addEventListener("click", (event) => {
    const role = event.target.dataset.role;
    if (!role) return;
    setRole(role);
    renderShell();
  });
}

function applyRoleAccess() {
  const isAdmin = state.role === "Admin";
  document.querySelector("#addProductPanel").classList.toggle("disabled-block", !isAdmin);
  document.querySelectorAll("[data-product-field]").forEach((field) => {
    if (field.tagName === "SELECT") field.disabled = !isAdmin;
    else field.readOnly = !isAdmin;
  });
}

renderShell();
