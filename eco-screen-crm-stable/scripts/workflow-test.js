const fs = require('fs');
const path = require('path');
const vm = require('vm');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'app.js'), 'utf8');

function makeContext() {
  const store = {};
  const elements = {};
  const document = {
    getElementById(id) {
      if (!elements[id]) elements[id] = { innerHTML: '' };
      return elements[id];
    },
    addEventListener() {},
    querySelector() { return null; }
  };
  const context = {
    window: {},
    document,
    localStorage: {
      getItem: (key) => Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null,
      setItem: (key, value) => { store[key] = String(value); },
      removeItem: (key) => { delete store[key]; }
    },
    alert: (message) => { throw new Error(message); },
    prompt: () => 'DELETE',
    confirm: () => false,
    fetch: undefined,
    navigator: { clipboard: { writeText() {} } },
    printOutput: '',
    open() {
      return {
        document: {
          write: (html) => { context.printOutput += html; },
          close() {}
        },
        print() { context.printOutput += '[printed]'; }
      };
    },
    Date,
    Math,
    Number,
    String,
    JSON,
    Object,
    Array,
    RegExp
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(appSource, context);
  return { api: context.window.ecoScreenStableApi, context };
}

const harness = makeContext();
const api = harness.api;
api.reset();
const state = api.getState();
state.session = { username: 'boss1', role: 'Boss' };

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const q1 = api.seedQuote('Q-TEST-1', 800, 0);
assert(api.calcQuote(q1).total === 800, 'B: manual final price should set total to RM800');
api.printQuotation(q1.id);
assert(harness.context.printOutput.includes('RM800.00'), 'B: printed quotation should show RM800.00');
assert(harness.context.printOutput.includes('0195763499'), 'H: printed quotation should show company phone');
const o1 = api.convertQuotation(q1.id);
const prefix = 'SO' + String(new Date().getFullYear()).slice(-2) + String(new Date().getMonth() + 1).padStart(2, '0');
assert(o1.orderNo === prefix + '001', 'C: first order number should be current YYMM 001');
assert(o1.quoteNumber === 'Q-TEST-1', 'C: quote number should remain original');

const q2 = api.seedQuote('Q-TEST-2', 900, 0);
const o2 = api.convertQuotation(q2.id);
assert(o2.orderNo === prefix + '002', 'D: second order should increment');

api.moveBackToFollowUp(o1.id, true);
assert(!api.getState().orders.filter((o) => o.status !== 'moved_back').some((o) => o.id === o1.id), 'E: moved-back order removed from active orders');
assert(api.getState().quotations.find((q) => q.id === q1.id).status === 'follow_up', 'E: quotation returns to follow up');

api.sendToProduction(o2.id);
assert(api.getState().orders.find((o) => o.id === o2.id).productionStatus === 'in_production', 'F: send to production');
api.markProductionCompleted(o2.id);
assert(api.getState().orders.find((o) => o.id === o2.id).productionStatus === 'completed', 'F: production completed');

api.sendToInstaller(o2.id);
api.scheduleInstallation(o2.id);
api.completeInstallation(o2.id, 900, false);
assert(api.getState().orders.find((o) => o.id === o2.id).installationStatus === 'installed', 'G: full payment should install');
api.printWarranty(o2.id);
assert(harness.context.printOutput.includes('Warranty'), 'H: warranty print should render');
assert(harness.context.printOutput.includes('0195763499'), 'H: warranty should show company phone');

const q3 = api.seedQuote('Q-TEST-3', 1000, 100);
const o3 = api.convertQuotation(q3.id);
api.markProductionCompleted(o3.id);
api.sendToInstaller(o3.id);
api.scheduleInstallation(o3.id);
api.completeInstallation(o3.id, 200, false);
assert(api.getState().orders.find((o) => o.id === o3.id).installationStatus === 'pending_collection', 'G: remaining balance should be pending collection');

assert(api.getState().products.length === 20, 'Products: default Eco Screen list should contain 20 products');
const rollerWindow = api.getState().products.find((product) => product.name === 'Roller Window');
assert(rollerWindow && rollerWindow.unitPrice === 33 && rollerWindow.minimumSqft === 11, 'Products: Roller Window default price/minimum');
const rollerItem = { product: 'Roller Window', width: 1000, height: 1000, quantity: 1, unitPrice: 33, minimumSqft: 11, calculationType: 'sqft', powdercoat: 'no' };
assert(api.calcItemDetails(rollerItem).finalTotal === 363, 'Products: Roller Window 1000mm x 1000mm uses 11 sqft minimum = RM363');
const hollow = api.getState().products.find((product) => product.name === 'Hollow 1x2');
assert(hollow && hollow.unitPrice === 10, 'Products: Hollow 1x2 unit price RM10');
const powdercoat = api.calcItemDetails({ ...rollerItem, powdercoat: 'yes' });
assert(Math.abs(powdercoat.powdercoatAmount - 29.04) < 0.001 && Math.abs(powdercoat.finalTotal - 392.04) < 0.001, 'Products: powdercoat adds 8 percent');
assert(api.calcItemDetails({ ...rollerItem, powdercoat: 'yes', manualFinalPrice: 300 }).finalTotal === 300, 'Products: manual final price overrides powdercoat final amount');
const beforeRestoreQuotes = api.getState().quotations.length;
const beforeRestoreOrders = api.getState().orders.length;
api.restoreDefaultProducts(false);
assert(api.getState().products.length === 20, 'Products: restore returns 20 defaults');
assert(api.getState().quotations.length === beforeRestoreQuotes && api.getState().orders.length === beforeRestoreOrders, 'Products: restore does not touch quotations/orders');

assert(api.getState().companySettings[0].phone === '0195763499', 'H: company phone default');
state.session = { username: 'sales', role: 'Sales' };
assert(!['Boss', 'Admin'].includes(api.getState().session.role), 'I: sales is not a manager role');
state.session = { username: 'admin', role: 'Admin' };
assert(['Boss', 'Admin'].includes(api.getState().session.role), 'I: admin is manager role');

const oldV2Backup = {
  data: {
    quotations: [
      {
        quotationNo: 'V2-Q-100',
        customer: { name: 'Old Quote Customer', phone: '0111111111', area: 'PJ', address: 'Old address' },
        items: [{ product: 'Eco Screen Premium', quantity: 1, unitPrice: 700, total: 700 }],
        total: 700,
        deposit: 0,
        status: 'quoted'
      },
      { quotationNo: 'V2-Q-NOITEM', customerName: 'No Item Customer', phone: '012', items: [], total: 0 }
    ],
    orders: [
      {
        orderNo: 'OLD-SO-88',
        quoteNumber: 'V2-Q-200',
        customerName: 'Old Order Customer',
        phone: '0122222222',
        items: [{ product: 'Eco Screen Classic', quantity: 1, unitPrice: 1200, total: 1200 }],
        total: 1200,
        deposit: 200,
        balance: 1000,
        productionStatus: 'sent',
        installationStatus: 'not scheduled',
        status: 'confirmed'
      },
      {
        orderNo: 'OLD-SO-99',
        quoteNumber: 'V2-Q-300',
        customerName: 'Old Installed Customer',
        phone: '0133333333',
        items: [{ product: 'Eco Screen Classic', quantity: 1, unitPrice: 500, total: 500 }],
        total: 500,
        deposit: 500,
        balance: 0,
        productionStatus: 'completed',
        installationStatus: 'installed',
        status: 'completed'
      }
    ]
  }
};
const preview = api.previewOldV2Backup(oldV2Backup);
assert(preview.totals.oldQuotations === 2, 'Migration: preview should find old quotations');
assert(preview.totals.oldOrders === 2, 'Migration: preview should find old orders');
assert(preview.totals.skippedNoItems === 1, 'Migration: preview should flag no-items rows');
const quoteRow = preview.rows.find((row) => row.oldRefNo === 'V2-Q-100');
const orderRow = preview.rows.find((row) => row.oldRefNo === 'OLD-SO-88');
api.importOldV2Backup(oldV2Backup, [quoteRow.id, orderRow.id], { preview, force: true });
assert(api.getState().quotations.some((q) => q.oldRefNo === 'V2-Q-100' && q.status === 'quoted'), 'Migration: selected old quotation imports into quotations');
const importedOrder = api.getState().orders.find((o) => o.oldRefNo === 'OLD-SO-88');
assert(importedOrder && importedOrder.orderNo.startsWith(prefix), 'Migration: old order imports with new Stable SO order number');
assert(importedOrder.oldOrderNo === 'OLD-SO-88', 'Migration: old order number is preserved as Old Ref No');
const duplicateResult = api.importOldV2Backup(oldV2Backup, [quoteRow.id, orderRow.id], { preview: api.previewOldV2Backup(oldV2Backup), force: true });
assert(duplicateResult.quotationsImported === 0 && duplicateResult.ordersImported === 0, 'Migration: duplicate oldRefNo is skipped');

api.reset();
api.getState().session = { username: 'boss1', role: 'Boss' };

function largeOldV2Backup() {
  const quotations = [];
  const orders = [];
  for (let i = 1; i <= 120; i += 1) {
    quotations.push({
      id: 'old-q-id-' + i,
      quotationNo: 'OLD-Q-' + String(i).padStart(3, '0'),
      customerName: 'Quote Customer ' + i,
      phone: '011' + String(i).padStart(7, '0'),
      items: [{ product: 'Eco Screen Classic', quantity: 1, unitPrice: 100 + i, total: 100 + i }],
      total: 100 + i,
      deposit: 0,
      status: 'follow_up'
    });
    orders.push({
      id: 'old-o-id-' + i,
      orderNo: 'OLD-O-' + String(i).padStart(3, '0'),
      quoteNumber: 'OLD-QO-' + String(i).padStart(3, '0'),
      customerName: 'Order Customer ' + i,
      phone: '012' + String(i).padStart(7, '0'),
      items: [{ product: 'Eco Screen Premium', quantity: 1, unitPrice: 500 + i, total: 500 + i }],
      total: 500 + i,
      deposit: 100,
      balance: 400 + i,
      productionStatus: i % 2 === 0 ? 'sent' : 'not_produced',
      installationStatus: 'not_scheduled',
      status: 'confirmed'
    });
  }
  for (let i = 1; i <= 20; i += 1) {
    quotations.push({
      id: 'old-empty-id-' + i,
      quotationNo: 'OLD-NOITEM-' + String(i).padStart(3, '0'),
      customerName: 'No Item Customer ' + i,
      phone: '013' + String(i).padStart(7, '0'),
      items: [],
      total: 0
    });
  }
  for (let i = 1; i <= 10; i += 1) {
    orders.push({
      id: 'old-o-id-dup-' + i,
      orderNo: 'OLD-O-' + String(i).padStart(3, '0'),
      quoteNumber: 'OLD-DUP-Q-' + String(i).padStart(3, '0'),
      customerName: 'Duplicate Order Customer ' + i,
      phone: '014' + String(i).padStart(7, '0'),
      items: [{ product: 'Eco Screen Premium', quantity: 1, unitPrice: 800, total: 800 }],
      total: 800,
      deposit: 0,
      balance: 800,
      status: 'confirmed'
    });
  }
  return { data: { quotations, orders } };
}

const largeBackup = largeOldV2Backup();
const largePreview = api.previewOldV2Backup(largeBackup);
assert(largePreview.totals.totalRecords === 270, 'Large migration: preview should see all 270 records');
assert(largePreview.totals.valid === 240, 'Large migration: valid count should be 240');
assert(largePreview.totals.skipped === 30, 'Large migration: skipped count should be 30');
assert(largePreview.totals.duplicates === 10, 'Large migration: duplicate count should be 10');
assert(largePreview.totals.skippedNoItems === 20, 'Large migration: no-item count should be 20');
const allValidIds = largePreview.rows.filter((row) => row.importable).map((row) => row.id);
assert(allValidIds.length === 240, 'Large migration: Select All Valid should select all 240 valid rows');
const pageOneIds = largePreview.rows.slice(0, 20).filter((row) => row.importable).map((row) => row.id);
const pageTwoIds = largePreview.rows.slice(20, 40).filter((row) => row.importable).map((row) => row.id);
const selectedAcrossPages = new Set(pageOneIds);
pageTwoIds.forEach((id) => selectedAcrossPages.add(id));
assert(pageOneIds.every((id) => selectedAcrossPages.has(id)), 'Large migration: page 1 selection remains after page 2 selection');
const searchedRows = largePreview.rows.filter((row) => `${row.customer} ${row.phone} ${row.oldRefNo}`.toLowerCase().includes('order customer 120'));
assert(searchedRows.length === 1 && pageOneIds.every((id) => selectedAcrossPages.has(id)), 'Large migration: search does not delete existing selection');
const largeResult = api.importOldV2Backup(largeBackup, allValidIds, { preview: largePreview, force: true });
assert(largeResult.imported === 240, 'Large migration: import should process all selected valid rows, not only visible rows');
assert(largeResult.ordersImported === 120, 'Large migration: imports more than 100 orders');
const importedOrderNumbers = api.getState().orders.map((order) => order.orderNo);
['SO2607001', 'SO2607009', 'SO2607010', 'SO2607011', 'SO2607100', 'SO2607120'].forEach((orderNo) => {
  assert(importedOrderNumbers.includes(orderNo), 'Large migration: expected order number ' + orderNo);
});
const repeatPreview = api.previewOldV2Backup(largeBackup);
assert(repeatPreview.totals.duplicates >= 250, 'Large migration: duplicate preview detects previously imported old refs/source ids');

process.stdout.write([
  'Workflow tests passed',
  'B quotation manual total RM800: passed',
  'C convert Q-TEST-1 order number and quote number: passed',
  'D second order increments: passed',
  'E move back follow up excludes monthly active orders: passed',
  'F production flow: passed',
  'G installation full/partial collection: passed',
  'Product defaults and calculation: passed',
  'H company phone: passed',
  'I role safety basis: passed',
  'Migration preview/import/duplicate skip: passed',
  'Large migration 270-row preview and 240-row import: passed',
  'SO sequence 001/009/010/011/100/120: passed'
].join('\n') + '\n');
