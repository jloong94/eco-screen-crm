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
const { convertQuoteToOrder } = await import("../src/workflow.js");

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

const quoteA = validQuote("TEST-A", "Customer A");
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

console.log([
  "Convert valid quotation: passed",
  "Duplicate and double-click prevention: passed",
  "Missing item validation: passed",
  "Local-first cloud failure fallback: passed",
  "Stale cloud overwrite protection: passed",
  "Refresh persistence: passed"
].join("\n"));
