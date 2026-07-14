class MemoryStorage {
  constructor() {
    this.values = new Map();
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }

  removeItem(key) {
    this.values.delete(key);
  }
}

globalThis.localStorage = new MemoryStorage();
globalThis.document = { querySelector: () => null };
globalThis.window = globalThis;

const {
  applyCloudSnapshot,
  makeQuote,
  makeQuoteItem,
  state
} = await import("../src/state.js");
const { runtimeEnv } = await import("../src/env.js");
const { lineTotal } = await import("../src/calculations.js");
const {
  convertQuoteToOrder,
  findOrderByNumber,
  monthlyOrderSequence,
  nextSalesOrderNumber,
  updateOrderNumber,
  updateOrderStatus
} = await import("../src/workflow.js");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function resetWorkflowState() {
  state.quotations = [];
  state.orders = [];
  state.productionJobs = [];
  state.installationJobs = [];
  state.warrantyCards = [];
}

function validQuote(number, name = number) {
  const quote = makeQuote();
  const item = makeQuoteItem();
  Object.assign(item, {
    width: "1000",
    height: "1200",
    quantity: "1",
    unitPrice: "100",
    minimumSqft: 0,
    color: "White",
    installationLocation: "Living",
    handlePosition: "Right",
    remark: "Item remark"
  });
  Object.assign(quote, {
    quoteNumber: number,
    quotationNo: number,
    quoteNo: number,
    customer: {
      name,
      phone: "0123456789",
      area: "BM",
      address: "Test address",
      remark: "Customer remark"
    },
    appointmentDate: "2026-07-20",
    remark: "Quotation remark",
    discount: 25,
    deposit: 100,
    items: [item]
  });
  return quote;
}

resetWorkflowState();
runtimeEnv.VITE_SUPABASE_URL = "";
runtimeEnv.VITE_SUPABASE_ANON_KEY = "";

const defaultPriceItem = makeQuoteItem();
assert(Number(defaultPriceItem.unitPrice) > 0, "Pricing: selecting/defaulting a product should provide its selling price");
defaultPriceItem.width = "1000";
defaultPriceItem.height = "1000";
defaultPriceItem.quantity = "1";
defaultPriceItem.minimumSqft = 0;
defaultPriceItem.unitPrice = "125.50";
const customUnitPriceTotal = lineTotal(defaultPriceItem);
assert(customUnitPriceTotal > 0, "Pricing: manually edited unit price should calculate a line total");
defaultPriceItem.manualFinalPrice = "800";
assert(lineTotal(defaultPriceItem) === 800, "Pricing: manual final price should override the calculated line total");

state.orders = [
  { id: "old-1", orderNo: "SO-2607-001" },
  { id: "old-9", orderNumber: "SO-2607-009" }
];
assert(nextSalesOrderNumber(new Date("2026-07-14T00:00:00Z")) === "SO2607010", "Numbering: old dashed numbers should contribute to the monthly sequence");
state.orders.push({ id: "new-999", orderNo: "SO2607999" });
assert(nextSalesOrderNumber(new Date("2026-07-14T00:00:00Z")) === "SO26071000", "Numbering: sequence should continue beyond 999");
assert(monthlyOrderSequence("SO-2607-009", "26", "07") === 9, "Numbering: old dashed format should parse");
assert(monthlyOrderSequence("SO2607010", "26", "07") === 10, "Numbering: new compact format should parse");
resetWorkflowState();

const quoteA = validQuote("TEST-A", "Customer A");
quoteA.items[0].unitPrice = "125.50";
state.quotations = [quoteA];
const first = await convertQuoteToOrder(quoteA.id);
assert(first.ok, "A: valid quotation should convert");
assert(state.orders.length === 1, "A: exactly one order should be created");
assert(/^SO\d{7}$/.test(state.orders[0].orderNo), "A: unique SO order number should be generated");
assert(state.orders[0].quoteNumber === "TEST-A", "A: original quotation number should be retained");
assert(state.orders[0].customer.phone === "0123456789", "A: customer details should be copied");
assert(state.orders[0].appointmentDate === "2026-07-20", "A: appointment should be copied");
assert(state.orders[0].remark === "Quotation remark", "A: quotation remark should be copied");
assert(state.orders[0].items[0].installationLocation === "Living", "A: item details should be copied");
assert(Number(state.orders[0].items[0].unitPrice) === 125.5, "A: manually edited unit price should be preserved in the order");
assert(state.productionJobs.length === 1, "A: one production job should be created");
assert(state.installationJobs.length === 1, "A: one installation job should be created");
assert(state.quotations[0].status === "won", "A: quotation should be marked won");
assert(state.quotations[0].orderId === state.orders[0].id, "A: quotation should store linked order id");

const repeated = await convertQuoteToOrder(quoteA.id);
assert(repeated.ok && repeated.existing, "B: repeated conversion should reuse existing order");
assert(state.orders.length === 1, "B: repeated conversion must not create duplicate order");
assert(state.productionJobs.length === 1, "B: repeated conversion must not duplicate production job");
assert(state.installationJobs.length === 1, "B: repeated conversion must not duplicate installation job");

const quoteB = validQuote("TEST-B", "Customer B");
state.quotations = [...state.quotations, quoteB];
const concurrent = await Promise.all([
  convertQuoteToOrder(quoteB.id),
  convertQuoteToOrder(quoteB.id)
]);
assert(concurrent.some((result) => result.ok), "C: one concurrent conversion should succeed");
assert(state.orders.filter((order) => order.quoteId === quoteB.id).length === 1, "C: concurrent clicks must create one order only");
assert(new Set(state.orders.map((order) => order.orderNo)).size === state.orders.length, "C: order numbers must be unique");
const firstSequence = monthlyOrderSequence(state.orders.find((order) => order.quoteId === quoteA.id).orderNo, String(new Date().getFullYear()).slice(-2), String(new Date().getMonth() + 1).padStart(2, "0"));
const secondSequence = monthlyOrderSequence(state.orders.find((order) => order.quoteId === quoteB.id).orderNo, String(new Date().getFullYear()).slice(-2), String(new Date().getMonth() + 1).padStart(2, "0"));
assert(secondSequence === firstSequence + 1, "C: the next quotation should receive the next monthly order sequence");

const emptyQuote = validQuote("TEST-EMPTY", "Empty Quote");
emptyQuote.items = [];
state.quotations = [...state.quotations, emptyQuote];
const beforeEmpty = state.orders.length;
const emptyResult = await convertQuoteToOrder(emptyQuote.id);
assert(!emptyResult.ok, "D: quotation without items should be blocked");
assert(state.orders.length === beforeEmpty, "D: blocked quotation must not create an order");

runtimeEnv.VITE_SUPABASE_URL = "https://offline.example.invalid";
runtimeEnv.VITE_SUPABASE_ANON_KEY = "test-key";
globalThis.fetch = async () => { throw new Error("Simulated offline cloud"); };
const quoteC = validQuote("TEST-C", "Customer C");
state.quotations = [...state.quotations, quoteC];
const cloudFailure = await convertQuoteToOrder(quoteC.id);
assert(cloudFailure.ok, "E: cloud failure must not fail local conversion");
assert(cloudFailure.cloudOk === false, "E: cloud failure should be reported separately");
assert(state.orders.some((order) => order.quoteId === quoteC.id), "E: cloud failure order must remain in memory");

const localOrder = state.orders.find((order) => order.quoteId === quoteC.id);
const staleCloudOrder = {
  ...localOrder,
  customer: { ...localOrder.customer, name: "Stale Cloud Customer" },
  updatedAt: "2020-01-01T00:00:00.000Z"
};
applyCloudSnapshot({
  orders: [staleCloudOrder, {
    id: "cloud-existing-order",
    orderNo: "SO2001001",
    orderNumber: "SO2001001",
    updatedAt: "2020-01-01T00:00:00.000Z"
  }]
});
assert(state.orders.some((order) => order.id === localOrder.id && order.customer.name === "Customer C"), "F: stale cloud snapshot must not overwrite newer local order");
assert(state.orders.some((order) => order.id === "cloud-existing-order"), "F: unrelated cloud order should still merge");

const persistedOrders = JSON.parse(localStorage.getItem("ecoScreenV2.orders") || "[]");
assert(persistedOrders.some((order) => order.quoteId === quoteA.id), "G: first order should survive browser refresh storage reload");
assert(persistedOrders.some((order) => order.quoteId === quoteB.id), "G: second order should survive browser refresh storage reload");
assert(persistedOrders.some((order) => order.quoteId === quoteC.id), "G: cloud-failed order should survive browser refresh storage reload");

runtimeEnv.VITE_SUPABASE_URL = "";
runtimeEnv.VITE_SUPABASE_ANON_KEY = "";
resetWorkflowState();
state.currentUser = { userId: "boss-test", username: "boss-test", role: "Boss", active: true };
state.role = "Boss";

const editQuote = validQuote("EDIT-QUOTE", "Order Number Customer");
state.quotations = [editQuote];
const editConversion = await convertQuoteToOrder(editQuote.id);
assert(editConversion.ok, "H: test order should be created for order-number editing");
const editOrder = state.orders[0];
const stableOrderId = editOrder.id;
const oldOrderNumber = "SO-2607-001";
const originalCustomer = JSON.stringify(editOrder.customer);
const originalItems = JSON.stringify(editOrder.items);
const originalTotal = editOrder.total;
const originalDeposit = editOrder.deposit;
const originalBalance = editOrder.balance;

Object.assign(editOrder, { orderNo: oldOrderNumber, orderNumber: oldOrderNumber });
Object.assign(state.quotations[0], { orderId: stableOrderId, orderNo: oldOrderNumber, orderNumber: oldOrderNumber });
Object.assign(state.productionJobs[0], { orderId: stableOrderId, orderNo: oldOrderNumber, orderNumber: oldOrderNumber });
Object.assign(state.installationJobs[0], {
  orderId: stableOrderId,
  orderNo: oldOrderNumber,
  orderNumber: oldOrderNumber,
  collectionRecords: [{ id: "collection-1", orderId: stableOrderId, orderNo: oldOrderNumber }]
});
state.warrantyCards = [{
  id: "warranty-edit-test",
  orderId: stableOrderId,
  orderNo: oldOrderNumber,
  orderNumber: oldOrderNumber,
  payments: [{ id: "payment-1", orderId: stableOrderId, orderNumber: oldOrderNumber }]
}];

const numberUpdate = await updateOrderNumber(stableOrderId, " so2607001 ", { confirmChange: false });
assert(numberUpdate.ok, "H: Boss should be able to update an order number");
assert(state.orders.length === 1, "H: changing an order number must not create a second order");
assert(state.orders[0].id === stableOrderId, "H: stable order id must not change");
assert(state.orders[0].orderNo === "SO2607001" && state.orders[0].orderNumber === "SO2607001", "H: order number should be trimmed and uppercased");
assert(state.quotations[0].orderNo === "SO2607001", "H: linked quotation order reference should update");
assert(state.quotations[0].quotationNo === "EDIT-QUOTE", "H: quotation number itself must not be renamed");
assert(state.productionJobs[0].orderNo === "SO2607001", "H: linked production reference should update");
assert(state.installationJobs[0].orderNo === "SO2607001", "H: linked installation reference should update");
assert(state.installationJobs[0].collectionRecords[0].orderNo === "SO2607001", "H: embedded collection reference should update");
assert(state.warrantyCards[0].orderNo === "SO2607001", "H: linked warranty reference should update");
assert(state.warrantyCards[0].payments[0].orderNumber === "SO2607001", "H: embedded payment reference should update");
assert(JSON.stringify(state.orders[0].customer) === originalCustomer, "H: customer data must not be overwritten");
assert(JSON.stringify(state.orders[0].items) === originalItems, "H: item data must not be overwritten");
assert(state.orders[0].total === originalTotal && state.orders[0].deposit === originalDeposit && state.orders[0].balance === originalBalance, "H: financial values must not change");
assert(findOrderByNumber("so2607001")?.id === stableOrderId, "H: search should find the new number case-insensitively");
assert(findOrderByNumber(oldOrderNumber) === null, "H: old order number should no longer be active");
const persistedRenamedOrder = JSON.parse(localStorage.getItem("ecoScreenV2.orders") || "[]").find((order) => order.id === stableOrderId);
assert(persistedRenamedOrder?.orderNo === "SO2607001", "H: changed number should survive a storage reload");

state.orders = [...state.orders, {
  id: "duplicate-order",
  orderNo: "SO2607002",
  orderNumber: "SO2607002",
  status: "Confirmed",
  items: []
}];
const duplicateNumber = await updateOrderNumber(stableOrderId, "so2607002", { confirmChange: false });
assert(!duplicateNumber.ok && duplicateNumber.message === "This order number is already in use.", "I: duplicate order number should be blocked");
assert(state.orders.find((order) => order.id === stableOrderId).orderNo === "SO2607001", "I: blocked duplicate must leave original number unchanged");

state.currentUser = { userId: "sales-test", username: "sales-test", role: "Sales", active: true };
state.role = "Sales";
const unauthorizedNumberEdit = await updateOrderNumber(stableOrderId, "SO2607003", { confirmChange: false });
assert(!unauthorizedNumberEdit.ok, "J: non-Boss/Admin must not edit order numbers");
assert(state.orders.find((order) => order.id === stableOrderId).orderNo === "SO2607001", "J: unauthorized edit must not change data");

state.currentUser = { userId: "boss-test", username: "boss-test", role: "Boss", active: true };
state.role = "Boss";
const workflowCountsBeforeStatus = {
  orders: state.orders.length,
  productionJobs: state.productionJobs.length,
  installationJobs: state.installationJobs.length
};
const statusUpdate = await updateOrderStatus(stableOrderId, "Sent to Production");
assert(statusUpdate.ok, "K: authorized status update should succeed in local mode");
assert(state.orders.find((order) => order.id === stableOrderId).status === "Sent to Production", "K: selected status should be stored on the correct order");
assert(state.orders.length === workflowCountsBeforeStatus.orders, "K: status update must not create an order");
assert(state.productionJobs.length === workflowCountsBeforeStatus.productionJobs, "K: status update must not create a production job");
assert(state.installationJobs.length === workflowCountsBeforeStatus.installationJobs, "K: status update must not create an installation job");
const persistedStatusOrder = JSON.parse(localStorage.getItem("ecoScreenV2.orders") || "[]").find((order) => order.id === stableOrderId);
assert(persistedStatusOrder?.status === "Sent to Production", "K: status should survive a storage reload");

runtimeEnv.VITE_SUPABASE_URL = "https://offline.example.invalid";
runtimeEnv.VITE_SUPABASE_ANON_KEY = "test-key";
globalThis.fetch = async () => { throw new Error("Simulated offline cloud"); };
const offlineStatusUpdate = await updateOrderStatus(stableOrderId, "Production Completed");
assert(offlineStatusUpdate.ok && offlineStatusUpdate.cloudOk === false, "L: cloud failure should be reported without rolling back local status");
assert(state.orders.find((order) => order.id === stableOrderId).status === "Production Completed", "L: local status must remain after cloud failure");
const persistedOfflineStatus = JSON.parse(localStorage.getItem("ecoScreenV2.orders") || "[]").find((order) => order.id === stableOrderId);
assert(persistedOfflineStatus?.status === "Production Completed", "L: cloud-failed status must survive refresh storage reload");
assert(state.orders.length === workflowCountsBeforeStatus.orders, "L: cloud failure must not duplicate orders");
assert(state.productionJobs.length === workflowCountsBeforeStatus.productionJobs, "L: cloud failure must not duplicate production jobs");
assert(state.installationJobs.length === workflowCountsBeforeStatus.installationJobs, "L: cloud failure must not duplicate installation jobs");

runtimeEnv.VITE_SUPABASE_URL = "";
runtimeEnv.VITE_SUPABASE_ANON_KEY = "";

console.log([
  "Editable unit price and manual final price: passed",
  "Monthly SO numbering including legacy formats and >999: passed",
  "Convert valid quotation: passed",
  "Duplicate and double-click prevention: passed",
  "Missing item validation: passed",
  "Local-first cloud failure fallback: passed",
  "Stale cloud overwrite protection: passed",
  "Refresh persistence: passed",
  "Boss order-number edit and linked references: passed",
  "Duplicate and role protection for order numbers: passed",
  "Order status update, refresh persistence and cloud-failure fallback: passed"
].join("\n"));
