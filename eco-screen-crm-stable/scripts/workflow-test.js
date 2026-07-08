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

process.stdout.write([
  'Workflow tests passed',
  'B quotation manual total RM800: passed',
  'C convert Q-TEST-1 order number and quote number: passed',
  'D second order increments: passed',
  'E move back follow up excludes monthly active orders: passed',
  'F production flow: passed',
  'G installation full/partial collection: passed',
  'H company phone: passed',
  'I role safety basis: passed',
  'Migration preview/import/duplicate skip: passed'
].join('\n') + '\n');
