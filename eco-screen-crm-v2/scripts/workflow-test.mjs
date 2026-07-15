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
const { mergeRows, safeSyncWithCloud } = await import("../src/cloudSync.js");
const { lineTotal } = await import("../src/calculations.js");
const {
  archiveDuplicateGroup,
  archiveProductionDuplicateGroup,
  activeProductionJobForOrder,
  convertQuoteToOrder,
  duplicateArchiveActionHtml,
  findExistingOrderForQuote,
  findOrderByNumber,
  monthlyOrderSequence,
  nextSalesOrderNumber,
  quotationOrderAction,
  linkedOrderForProduction,
  markInstallationStatus,
  markProductionStatus,
  productionJobMatchesSearch,
  productionJobsForDisplay,
  productionDuplicateArchiveActionHtml,
  productionOrderNumber,
  restoreArchivedDuplicate,
  restoreArchivedProductionJob,
  repairWorkflowIntegrityIssue,
  scanWorkflowIntegrity,
  scanDuplicateOrders,
  scanDuplicateProductionJobs,
  sendOrderToProduction,
  updateOrderNumber,
  updateOrderStatus,
  updateQuotationStatus
} = await import("../src/workflow.js");
const { quotationsForTab } = await import("../src/quotations.js");

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
assert(!quotationOrderAction(quoteA).canConvert, "A0: Quoted quotation must hide conversion");
const quotedConversion = await convertQuoteToOrder(quoteA.id);
assert(!quotedConversion.ok && state.orders.length === 0, "A0: non-Won quotation must not convert");
const wonStatus = await updateQuotationStatus(quoteA.id, "won");
assert(wonStatus.ok && quotationOrderAction(state.quotations[0]).canConvert, "A0: saving Won should enable conversion");
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
assert(quotationOrderAction(state.quotations[0]).order?.id === state.orders[0].id, "A: converted quotation should expose Open Order instead of Convert");
const blockedStatusRollback = await updateQuotationStatus(quoteA.id, "follow_up");
assert(!blockedStatusRollback.ok && state.quotations[0].status === "won", "A: linked order should block Won rollback through quotation status");

state.quotations[0] = { ...state.quotations[0], orderId: null, linkedOrderId: null, orderNo: null, orderNumber: null };
const repeated = await convertQuoteToOrder(quoteA.id);
assert(repeated.ok && repeated.existing, "B: repeated conversion should reuse existing order");
assert(state.orders.length === 1, "B: repeated conversion must not create duplicate order");
assert(state.productionJobs.length === 1, "B: repeated conversion must not duplicate production job");
assert(state.installationJobs.length === 1, "B: repeated conversion must not duplicate installation job");
assert(state.quotations[0].orderId === state.orders[0].id, "B: missing quotation link should be repaired to the existing order");
assert(findExistingOrderForQuote(state.quotations[0])?.id === state.orders[0].id, "B: exact quotation ID lookup should find existing order");

const quoteB = validQuote("TEST-B", "Customer B");
quoteB.status = "won";
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
emptyQuote.status = "won";
state.quotations = [...state.quotations, emptyQuote];
const beforeEmpty = state.orders.length;
const emptyResult = await convertQuoteToOrder(emptyQuote.id);
assert(!emptyResult.ok, "D: quotation without items should be blocked");
assert(state.orders.length === beforeEmpty, "D: blocked quotation must not create an order");

runtimeEnv.VITE_SUPABASE_URL = "https://offline.example.invalid";
runtimeEnv.VITE_SUPABASE_ANON_KEY = "test-key";
globalThis.fetch = async () => { throw new Error("Simulated offline cloud"); };
const quoteC = validQuote("TEST-C", "Customer C");
quoteC.status = "won";
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
editQuote.status = "won";
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

resetWorkflowState();
state.currentUser = { userId: "boss-test", username: "boss-test", name: "Boss Test", role: "Boss", active: true };
state.role = "Boss";
const duplicateQuote = validQuote("DUPLICATE-QUOTE", "Duplicate Customer");
duplicateQuote.status = "won";
state.quotations = [duplicateQuote];
const duplicateBaseConversion = await convertQuoteToOrder(duplicateQuote.id);
assert(duplicateBaseConversion.ok, "M: base order should be created for duplicate cleanup test");
const duplicateMainOrder = state.orders[0];
const duplicateOrder = {
  ...JSON.parse(JSON.stringify(duplicateMainOrder)),
  id: "duplicate-order-record",
  orderNo: "SO2607998",
  orderNumber: "SO2607998",
  createdAt: new Date(Date.parse(duplicateMainOrder.createdAt) + 5 * 60 * 1000).toISOString(),
  updatedAt: new Date(Date.parse(duplicateMainOrder.updatedAt) + 5 * 60 * 1000).toISOString(),
  collectionRecords: [{ id: "duplicate-collection", orderId: "duplicate-order-record", orderNo: "SO2607998", amount: 10 }]
};
state.orders = [duplicateMainOrder, duplicateOrder];
state.productionJobs.push({
  ...JSON.parse(JSON.stringify(state.productionJobs[0])),
  id: "duplicate-production-job",
  orderId: duplicateOrder.id,
  orderNo: duplicateOrder.orderNo,
  orderNumber: duplicateOrder.orderNo
});
state.installationJobs.push({
  ...JSON.parse(JSON.stringify(state.installationJobs[0])),
  id: "duplicate-installation-job",
  orderId: duplicateOrder.id,
  orderNo: duplicateOrder.orderNo,
  orderNumber: duplicateOrder.orderNo,
  paymentRecords: [{ id: "duplicate-payment", orderId: duplicateOrder.id, orderNumber: duplicateOrder.orderNo, amount: 20 }]
});
state.warrantyCards = [{
  id: "duplicate-warranty",
  orderId: duplicateOrder.id,
  orderNo: duplicateOrder.orderNo,
  orderNumber: duplicateOrder.orderNo,
  payments: [{ id: "warranty-payment", orderId: duplicateOrder.id, orderNo: duplicateOrder.orderNo }]
}];
state.quotations[0] = { ...state.quotations[0], orderId: duplicateOrder.id, linkedOrderId: duplicateOrder.id, orderNo: duplicateOrder.orderNo };
const duplicateFinancialSnapshot = JSON.stringify({
  items: duplicateMainOrder.items,
  total: duplicateMainOrder.total,
  deposit: duplicateMainOrder.deposit,
  balance: duplicateMainOrder.balance,
  status: duplicateMainOrder.status
});
const duplicateCountsSnapshot = {
  orders: state.orders.length,
  productionJobs: state.productionJobs.length,
  installationJobs: state.installationJobs.length,
  warrantyCards: state.warrantyCards.length
};
const duplicateScan = scanDuplicateOrders();
const confirmedDuplicateGroup = duplicateScan.confirmedGroups.find((group) => group.members.some((member) => member.order.id === duplicateMainOrder.id)
  && group.members.some((member) => member.order.id === duplicateOrder.id));
assert(confirmedDuplicateGroup, "M: same quotation ID should be a confirmed duplicate group");
const mainMemberKey = confirmedDuplicateGroup.members.find((member) => member.order.id === duplicateMainOrder.id).key;
assert(!duplicateArchiveActionHtml(confirmedDuplicateGroup, "").includes("Archive Other Duplicates"), "M: archive action must stay hidden until a Main Order is selected");
const selectedArchiveAction = duplicateArchiveActionHtml(confirmedDuplicateGroup, mainMemberKey);
assert(selectedArchiveAction.includes("Archive Other Duplicates"), "M: selecting a Main Order must reveal Archive Other Duplicates");
assert(selectedArchiveAction.includes("Linked records") && selectedArchiveAction.includes("Warranty"), "M: duplicate archive preview must summarize linked record counts");
const archiveResult = await archiveDuplicateGroup(confirmedDuplicateGroup.id, mainMemberKey, { confirm: false, downloadBackup: false });
assert(archiveResult.ok, "M: confirmed duplicate should archive with a selected Main Order");
const archivedDuplicate = state.orders.find((order) => order.id === duplicateOrder.id);
assert(archivedDuplicate.status === "duplicate_archived" && archivedDuplicate.isArchived, "M: duplicate order should remain stored as archived");
assert(archivedDuplicate.duplicateOfOrderId === duplicateMainOrder.id, "M: archived duplicate should reference Main Order");
assert(JSON.stringify({
  items: state.orders.find((order) => order.id === duplicateMainOrder.id).items,
  total: state.orders.find((order) => order.id === duplicateMainOrder.id).total,
  deposit: state.orders.find((order) => order.id === duplicateMainOrder.id).deposit,
  balance: state.orders.find((order) => order.id === duplicateMainOrder.id).balance,
  status: state.orders.find((order) => order.id === duplicateMainOrder.id).status
}) === duplicateFinancialSnapshot, "M: Main Order money, items and status must remain unchanged");
assert(state.orders.length === duplicateCountsSnapshot.orders, "M: archive must not hard-delete an order");
assert(state.productionJobs.length === duplicateCountsSnapshot.productionJobs, "M: archive must not delete production jobs");
assert(state.installationJobs.length === duplicateCountsSnapshot.installationJobs, "M: archive must not delete installation jobs");
assert(state.warrantyCards.length === duplicateCountsSnapshot.warrantyCards, "M: archive must not delete warranty cards");
assert(state.quotations[0].orderId === duplicateMainOrder.id, "M: quotation should link to Main Order");
assert(state.productionJobs.find((job) => job.id === "duplicate-production-job").orderId === duplicateMainOrder.id, "M: production reference should relink to Main Order");
assert(state.installationJobs.find((job) => job.id === "duplicate-installation-job").orderId === duplicateMainOrder.id, "M: installation reference should relink to Main Order");
assert(state.warrantyCards[0].orderId === duplicateMainOrder.id, "M: warranty reference should relink to Main Order");
assert(state.installationJobs.find((job) => job.id === "duplicate-installation-job").paymentRecords[0].orderId === duplicateMainOrder.id, "M: payment reference should relink to Main Order");
assert(JSON.parse(localStorage.getItem("ecoScreenV2.orders") || "[]").some((order) => order.id === duplicateOrder.id && order.status === "duplicate_archived"), "M: archived duplicate should survive refresh storage reload");

const archivedMemberIndex = state.orders.findIndex((order) => order.id === duplicateOrder.id);
const restoreResult = await restoreArchivedDuplicate(`${duplicateOrder.id}::${archivedMemberIndex}`, { confirm: false });
assert(restoreResult.ok && state.orders.find((order) => order.id === duplicateOrder.id).status !== "duplicate_archived", "N: archived duplicate should be recoverable");

runtimeEnv.VITE_SUPABASE_URL = "https://offline.example.invalid";
runtimeEnv.VITE_SUPABASE_ANON_KEY = "test-key";
globalThis.fetch = async () => { throw new Error("Simulated offline cloud"); };
const offlineDuplicateScan = scanDuplicateOrders();
const offlineDuplicateGroup = offlineDuplicateScan.confirmedGroups.find((group) => group.members.some((member) => member.order.id === duplicateOrder.id));
const offlineMainKey = offlineDuplicateGroup.members.find((member) => member.order.id === duplicateMainOrder.id).key;
const offlineArchive = await archiveDuplicateGroup(offlineDuplicateGroup.id, offlineMainKey, { confirm: false, downloadBackup: false });
assert(offlineArchive.ok && offlineArchive.cloudOk === false, "N: cloud failure should not roll back local duplicate cleanup");
assert(JSON.parse(localStorage.getItem("ecoScreenV2.orders") || "[]").some((order) => order.id === duplicateOrder.id && order.status === "duplicate_archived"), "N: cloud-failed cleanup should remain in local storage");

runtimeEnv.VITE_SUPABASE_URL = "";
runtimeEnv.VITE_SUPABASE_ANON_KEY = "";
resetWorkflowState();
const conflictItems = validQuote("CONFLICT-Q1").items;
state.orders = [
  { id: "conflict-a", quoteId: "quote-conflict-a", orderNo: "SO2607555", orderNumber: "SO2607555", customer: { phone: "0111111111" }, total: 500, items: conflictItems, createdAt: "2026-07-14T10:00:00.000Z" },
  { id: "conflict-b", quoteId: "quote-conflict-b", orderNo: "SO2607555", orderNumber: "SO2607555", customer: { phone: "0222222222" }, total: 700, items: conflictItems, createdAt: "2026-07-14T10:10:00.000Z" }
];
const numberConflictScan = scanDuplicateOrders();
assert(numberConflictScan.numberConflicts.length === 1, "O: same Order No on genuine different quotations should be a Number Conflict");
assert(numberConflictScan.confirmedGroups.length === 0, "O: number conflict must not become an auto-archivable confirmed duplicate");

state.orders = [
  { id: "possible-a", quoteId: "possible-quote-a", orderNo: "SO2607556", customer: { phone: "0122222222" }, total: 800, items: conflictItems, createdAt: "2026-07-14T10:00:00.000Z" },
  { id: "possible-b", quoteId: "possible-quote-b", orderNo: "SO2607557", customer: { phone: "0122222222" }, total: 800, items: JSON.parse(JSON.stringify(conflictItems)), createdAt: "2026-07-14T10:20:00.000Z" }
];
const possibleScan = scanDuplicateOrders();
assert(possibleScan.possibleGroups.length === 1, "O: matching customer/total/items within 30 minutes should be previewed as possible duplicate");
assert(possibleScan.confirmedGroups.length === 0, "O: possible duplicate must not be auto-archivable");

const localNewest = { id: "merge-order", customer: { name: "Newest Local" }, updatedAt: "2026-07-15T08:00:00.000Z" };
const cloudOlder = { id: "merge-order", customer: { name: "Older Cloud" }, updatedAt: "2026-07-14T08:00:00.000Z" };
const cloudOnly = { id: "cloud-only-order", updatedAt: "2026-07-14T09:00:00.000Z" };
const mergedRows = mergeRows([localNewest], [cloudOlder, cloudOnly]);
assert(mergedRows.length === 2, "P: stable-ID merge must not create duplicates");
assert(mergedRows.find((row) => row.id === "merge-order").customer.name === "Newest Local", "P: newer local record must beat older cloud record");
assert(mergedRows.some((row) => row.id === "cloud-only-order"), "P: cloud-only records must download during merge");

runtimeEnv.VITE_SUPABASE_URL = "";
runtimeEnv.VITE_SUPABASE_ANON_KEY = "";
const missingConfigSync = await safeSyncWithCloud({ orders: [localNewest] });
assert(!missingConfigSync.ok, "P: missing cloud configuration must report failure without changing local data");
assert(missingConfigSync.reason.includes("VITE_SUPABASE_URL") && missingConfigSync.reason.includes("VITE_SUPABASE_ANON_KEY"), "P: missing configuration must name both Vercel variables");
assert(missingConfigSync.snapshot.orders[0].customer.name === "Newest Local", "P: failed cloud read must preserve the local snapshot");

runtimeEnv.VITE_SUPABASE_URL = "https://offline.example.invalid";
runtimeEnv.VITE_SUPABASE_ANON_KEY = "test-key";
const failedReadMethods = [];
globalThis.fetch = async (_url, options = {}) => {
  failedReadMethods.push(options.method || "GET");
  throw new Error("Simulated DNS failure");
};
const failedReadSync = await safeSyncWithCloud({ orders: [localNewest] });
assert(!failedReadSync.ok, "P: an unreadable cloud must fail safely");
assert(!failedReadMethods.includes("POST"), "P: failed cloud reads must never be treated as empty cloud data or trigger writes");
assert(failedReadSync.snapshot.orders[0].customer.name === "Newest Local", "P: unreadable cloud must not overwrite local rows");

localStorage.removeItem("ecoScreenV2.preCloudWriteBackup.v1");
const simulatedCloud = Object.fromEntries(["users", "customers", "products", "quotations", "orders", "adsEntries", "productionJobs", "installationJobs", "warrantyCards", "companySettings"].map((collection) => [collection, []]));
simulatedCloud.orders = [cloudOlder, cloudOnly];
let backupWrites = 0;
let cloudPostWrites = 0;
globalThis.fetch = async (url, options = {}) => {
  if ((options.method || "GET") === "POST") {
    const body = JSON.parse(options.body);
    simulatedCloud[body.collection] = body.data;
    cloudPostWrites += 1;
    return { ok: true, status: 201, json: async () => ({}), text: async () => "" };
  }
  const match = String(url).match(/collection=eq\.([^&]+)/);
  const collection = decodeURIComponent(match?.[1] || "");
  const rows = simulatedCloud[collection]?.length ? [{ collection, data: simulatedCloud[collection], updated_at: "2026-07-14T09:00:00.000Z" }] : [];
  return { ok: true, status: 200, json: async () => rows, text: async () => JSON.stringify(rows) };
};
const readOnlySafeSync = await safeSyncWithCloud({ orders: [localNewest] }, { allowWrites: false, backupWriter: async () => { backupWrites += 1; return true; } });
assert(readOnlySafeSync.ok && readOnlySafeSync.readOnly, "P: first-login cloud hydration must be read-only");
assert(cloudPostWrites === 0, "P: first-login cloud hydration must not write before Boss/Admin reviews counts and presses Sync Now");
assert(backupWrites === 0, "P: a read-only cloud check must not create a pre-write backup");
assert(readOnlySafeSync.summary.pendingWrites.orders === 1, "P: read-only cloud check must report pending order writes");
const successfulSafeSync = await safeSyncWithCloud({ orders: [localNewest] }, { backupWriter: async () => { backupWrites += 1; return true; } });
assert(successfulSafeSync.ok, "P: readable cloud should merge and sync successfully");
assert(backupWrites === 1, "P: the first repaired cloud write must create one full JSON backup");
assert(cloudPostWrites === 1, "P: only the changed collection should be written after a full read check");
assert(simulatedCloud.orders.length === 2 && simulatedCloud.orders.find((row) => row.id === "merge-order").customer.name === "Newest Local", "P: uploaded cloud snapshot must retain cloud-only rows and the newest stable-ID record");

runtimeEnv.VITE_SUPABASE_URL = "";
runtimeEnv.VITE_SUPABASE_ANON_KEY = "";
resetWorkflowState();
state.currentUser = { userId: "boss-test", username: "boss-test", role: "Boss", active: true };
state.role = "Boss";
const productionQuote = validQuote("PRODUCTION-QUOTE", "Production Search Customer");
productionQuote.status = "won";
state.quotations = [productionQuote];
const productionConversion = await convertQuoteToOrder(productionQuote.id);
assert(productionConversion.ok, "Q: production lookup test order should convert");
const productionOrder = state.orders[0];
const productionJob = state.productionJobs[0];
assert(linkedOrderForProduction(productionJob)?.id === productionOrder.id, "Q: Production job should resolve its actual linked Order record");
assert(productionOrderNumber(productionJob) === productionOrder.orderNo, "Q: Production heading must use the linked SO Order No");
assert(productionJobMatchesSearch(productionJob, productionOrder.orderNo), "Q: Production search should find SO Order No");
assert(productionJobMatchesSearch(productionJob, "Production Search Customer"), "Q: Production search should find customer");
assert(productionJobMatchesSearch(productionJob, "0123456789"), "Q: Production search should find phone");
assert(productionJobMatchesSearch(productionJob, "PRODUCTION-QUOTE"), "Q: Production search should find quotation number");
assert(productionOrderNumber({ id: "orphan-production", productionNumber: "ESP-2026-9999" }) === "Order Number Missing", "Q: orphan Production job must not display or guess from ESP");
await markProductionStatus(productionJob.id, "in_production");
assert(state.productionJobs.find((job) => job.id === productionJob.id).status === "in_production", "Q: Production status updates must still work");
const productionInstallationJob = state.installationJobs[0];
markInstallationStatus(productionInstallationJob.id, "scheduled");
assert(state.installationJobs.find((job) => job.id === productionInstallationJob.id).status === "scheduled", "Q: Installation status updates must still work");

const productionMainSnapshot = JSON.stringify(state.productionJobs.find((job) => job.id === productionJob.id));
const duplicateProductionJob = {
  ...JSON.parse(JSON.stringify(productionJob)),
  id: "duplicate-production-v2",
  productionNumber: "ESP-DUPLICATE-V2",
  status: "completed",
  assignedStaff: "Latest progress staff",
  remark: "Preserved duplicate progress",
  createdAt: "2026-07-15T08:05:00.000Z",
  updatedAt: "2026-07-15T09:05:00.000Z"
};
state.productionJobs.push(duplicateProductionJob);
state.installationJobs[0] = { ...state.installationJobs[0], productionJobId: duplicateProductionJob.id };
const productionDuplicateCounts = {
  orders: state.orders.length,
  productionJobs: state.productionJobs.length,
  installationJobs: state.installationJobs.length
};
const productionDuplicateScan = scanDuplicateProductionJobs();
const confirmedProductionGroup = productionDuplicateScan.confirmedGroups.find((group) => group.members.some((member) => member.job.id === productionJob.id)
  && group.members.some((member) => member.job.id === duplicateProductionJob.id));
assert(confirmedProductionGroup, "R: same linked Order and exact items should be a confirmed Production duplicate group");
const productionMainKey = confirmedProductionGroup.members.find((member) => member.job.id === productionJob.id).key;
assert(!productionDuplicateArchiveActionHtml(confirmedProductionGroup, "").includes("Archive Other Production Duplicates"), "R: Production archive action must stay hidden before Main selection");
assert(productionDuplicateArchiveActionHtml(confirmedProductionGroup, productionMainKey).includes("Archive Other Production Duplicates"), "R: Main Production Job selection should reveal the archive action");
const productionArchiveResult = await archiveProductionDuplicateGroup(confirmedProductionGroup.id, productionMainKey, { confirm: false, downloadBackup: false });
assert(productionArchiveResult.ok, "R: confirmed Production duplicate should archive");
const archivedProductionJob = state.productionJobs.find((job) => job.id === duplicateProductionJob.id);
assert(archivedProductionJob.status === "duplicate_archived" && archivedProductionJob.isArchived, "R: duplicate Production Job should remain stored as archived");
assert(archivedProductionJob.duplicateOfProductionJobId === productionJob.id, "R: archived Production Job should reference the selected Main Job");
assert(JSON.stringify(state.productionJobs.find((job) => job.id === productionJob.id)) === productionMainSnapshot, "R: Main Production Job must not be overwritten");
assert(productionJobsForDisplay(state.productionJobs, false).length === 1, "R: normal Production view should show one active Job");
assert(productionJobsForDisplay(state.productionJobs, true).some((job) => job.id === duplicateProductionJob.id), "R: archived Production filter should find the preserved Job");
assert(state.installationJobs[0].productionJobId === productionJob.id, "R: Installation reference should point to Main Production Job");
assert(state.orders.length === productionDuplicateCounts.orders, "R: Production archive must not create an Order");
assert(state.installationJobs.length === productionDuplicateCounts.installationJobs, "R: Production archive must not create an Installation Job");
assert(state.productionJobs.length === productionDuplicateCounts.productionJobs, "R: Production archive must not hard-delete a Production Job");
assert(JSON.parse(localStorage.getItem("ecoScreenV2.productionJobs") || "[]").some((job) => job.id === duplicateProductionJob.id && job.status === "duplicate_archived"), "R: archived Production Job should survive refresh storage reload");

const productionRestoreResult = await restoreArchivedProductionJob(duplicateProductionJob.id, { confirm: false });
assert(productionRestoreResult.ok && !state.productionJobs.find((job) => job.id === duplicateProductionJob.id).isArchived, "S: archived Production Job should restore");
runtimeEnv.VITE_SUPABASE_URL = "https://offline.example.invalid";
runtimeEnv.VITE_SUPABASE_ANON_KEY = "test-key";
globalThis.fetch = async () => { throw new Error("Simulated offline cloud"); };
const restoredProductionGroup = scanDuplicateProductionJobs().confirmedGroups.find((group) => group.members.some((member) => member.job.id === duplicateProductionJob.id));
const restoredMainKey = restoredProductionGroup.members.find((member) => member.job.id === productionJob.id).key;
const offlineProductionArchive = await archiveProductionDuplicateGroup(restoredProductionGroup.id, restoredMainKey, { confirm: false, downloadBackup: false });
assert(offlineProductionArchive.ok && offlineProductionArchive.cloudOk === false, "S: cloud failure should preserve the local Production archive");
assert(JSON.parse(localStorage.getItem("ecoScreenV2.productionJobs") || "[]").some((job) => job.id === duplicateProductionJob.id && job.isArchived), "S: cloud-failed Production archive should remain in local storage");

runtimeEnv.VITE_SUPABASE_URL = "";
runtimeEnv.VITE_SUPABASE_ANON_KEY = "";
const activeProductionBeforeRepeat = state.productionJobs.filter((job) => !job.isArchived && job.status !== "duplicate_archived").length;
const repeatProductionConversion = await convertQuoteToOrder(productionQuote.id);
assert(repeatProductionConversion.ok, "S: converting the same quotation again should safely reuse its workflow");
assert(state.productionJobs.filter((job) => !job.isArchived && job.status !== "duplicate_archived").length === activeProductionBeforeRepeat, "S: repeat conversion must not create a second active Production Job");
assert(activeProductionJobForOrder(productionOrder)?.id === productionJob.id, "S: prevention should reuse the existing active Production Job and ignore archived duplicates");
assert(state.orders.length === productionDuplicateCounts.orders && state.installationJobs.length === productionDuplicateCounts.installationJobs, "S: repeat conversion must not increase Order or Installation counts");

state.orders = [];
state.productionJobs = [
  { id: "possible-production-a", orderId: "missing-order-a", orderNo: "SO2607888", customerName: "Possible Customer", items: [{ productId: "screen", width: 1000, height: 1200, quantity: 1 }] },
  { id: "possible-production-b", orderId: "missing-order-b", orderNo: "SO2607888", customerName: "Possible Customer", items: [{ productId: "screen", width: 1000, height: 1200, quantity: 1 }] }
];
const possibleProductionScan = scanDuplicateProductionJobs();
assert(possibleProductionScan.confirmedGroups.length === 0 && possibleProductionScan.possibleGroups.length === 1, "S: matching SO/customer/items without an exact linked Order should remain Possible only");

resetWorkflowState();
const followUpOnly = validQuote("FOLLOW-UP-ONLY", "Follow Up Only");
followUpOnly.status = "follow_up";
const linkedFollowUp = validQuote("FOLLOW-UP-LINKED", "Linked Follow Up");
linkedFollowUp.status = "follow_up";
linkedFollowUp.linkedOrderId = "existing-order";
state.quotations = [followUpOnly, linkedFollowUp];
state.orders = [{ id: "legacy-follow-up-order", orderNo: "SO2607900", orderNumber: "SO2607900", status: "follow_up" }];
assert(quotationsForTab("follow_up").length === 1 && quotationsForTab("follow_up")[0].id === followUpOnly.id, "T: Follow Up tab must contain only unlinked follow_up quotations");
assert(!quotationsForTab("quoted").includes(followUpOnly), "T: Follow Up quotation must not appear in Quoted");
assert(scanWorkflowIntegrity().categories.D.some((issue) => issue.stableId === "legacy-follow-up-order"), "T: legacy Order status follow_up must be flagged as a Workflow Conflict");

const strictQuote = validQuote("SAME-REFERENCE", "Strict Quote");
strictQuote.status = "won";
state.quotations = [strictQuote];
state.orders = [{ id: "unrelated-order", orderNo: "SAME-REFERENCE", orderNumber: "SAME-REFERENCE", status: "Confirmed" }];
assert(findExistingOrderForQuote(strictQuote) === null, "U: quotation number or Order No alone must never identify an existing Order");
assert(linkedOrderForProduction({ id: "legacy-production", orderNo: "SAME-REFERENCE" }) === null, "U: Production must not resolve an Order from Order No without exact orderId");

const sameNumberSeparateIds = mergeRows(
  [{ id: "order-number-a", orderNo: "SO2607991", updatedAt: "2026-07-15T10:00:00.000Z" }],
  [{ id: "order-number-b", orderNo: "SO2607991", updatedAt: "2026-07-15T11:00:00.000Z" }],
  "orders"
);
assert(sameNumberSeparateIds.length === 2, "U: same Order No with different stable IDs must remain separate in cloud merge");

const integritySnapshot = {
  quotations: [
    { id: "quote-a", status: "won", quotationNo: "Q-A" },
    { id: "quote-b", status: "won", quotationNo: "Q-B", linkedOrderId: "missing-order" },
    { id: "quote-e", status: "won", quotationNo: "Q-E" },
    { id: "quote-k1", status: "won", quotationNo: "Q-K1" },
    { id: "quote-k2", status: "won", quotationNo: "Q-K2" },
    { id: "cross-id", status: "quoted", quotationNo: "Q-CROSS" }
  ],
  orders: [
    { id: "order-c", orderNo: "SO-C", status: "Confirmed" },
    { id: "order-d", orderNo: "SO-D", status: "follow_up" },
    { id: "order-e1", orderNo: "SO-E1", quoteId: "quote-e", status: "Confirmed" },
    { id: "order-e2", orderNo: "SO-E2", quoteId: "quote-e", status: "Confirmed" },
    { id: "order-k1", orderNo: "SO-SAME", quoteId: "quote-k1", status: "Confirmed" },
    { id: "order-k2", orderNo: "SO-SAME", quoteId: "quote-k2", status: "Confirmed" },
    { id: "order-l", orderNo: "SO-L1", orderNumber: "SO-L2", quoteId: "quote-k1", status: "Confirmed" },
    { id: "cross-id", orderNo: "SO-CROSS", status: "Confirmed" }
  ],
  productionJobs: [
    { id: "production-f1", orderId: "order-e1", orderNo: "SO-E1", status: "not_produced" },
    { id: "production-f2", orderId: "order-e1", orderNo: "SO-E1", status: "in_production" },
    { id: "production-g", orderId: "missing-production-order", orderNo: "SO-G", status: "not_produced" },
    { id: "production-h", orderId: "order-e2", orderNo: "WRONG-SO", status: "not_produced" }
  ],
  installationJobs: [
    { id: "installation-i", orderId: "missing-installation-order", orderNo: "SO-I", status: "not_scheduled" }
  ],
  products: [{ id: "duplicate-product" }, { id: "duplicate-product" }]
};
const integrityBefore = JSON.stringify(integritySnapshot);
const completeIntegrityScan = scanWorkflowIntegrity(integritySnapshot);
"ABCDEFGHIJKLM".split("").forEach((category) => assert(completeIntegrityScan.categories[category].length > 0, `V: Integrity Check must detect category ${category}`));
assert(JSON.stringify(integritySnapshot) === integrityBefore, "V: Integrity Check preview must not modify scanned data");

resetWorkflowState();
state.currentUser = { userId: "boss-test", username: "boss-test", role: "Boss", active: true };
state.role = "Boss";
const repairQuote = validQuote("REPAIR-QUOTE", "Repair Customer");
repairQuote.status = "won";
repairQuote.linkedOrderId = "missing-order";
repairQuote.orderId = "missing-order";
const repairOrder = {
  id: "repair-order",
  orderNo: "SO2607992",
  orderNumber: "SO2607992",
  quoteId: repairQuote.id,
  quotationId: repairQuote.id,
  customer: { name: "Repair Customer", phone: "0123456789" },
  items: [{ id: "repair-item", quantity: 2, width: 1000, height: 1200 }],
  total: 1234,
  deposit: 234,
  balance: 1000,
  status: "Confirmed"
};
state.quotations = [repairQuote];
state.orders = [repairOrder];
const repairFinancialSnapshot = JSON.stringify({ customer: repairOrder.customer, items: repairOrder.items, total: repairOrder.total, deposit: repairOrder.deposit, balance: repairOrder.balance });
const quoteLinkIssue = scanWorkflowIntegrity().categories.B[0];
const linkRepair = await repairWorkflowIntegrityIssue(quoteLinkIssue.id, { targetId: repairOrder.id }, { confirm: false, downloadBackup: false });
assert(linkRepair.ok && state.quotations[0].linkedOrderId === repairOrder.id, "W: selected Quotation → Order link must repair by exact stable ID");
assert(JSON.stringify({ customer: state.orders[0].customer, items: state.orders[0].items, total: state.orders[0].total, deposit: state.orders[0].deposit, balance: state.orders[0].balance }) === repairFinancialSnapshot, "W: relationship repair must not alter customer, items or financial data");
assert(state.orders.length === 1 && state.quotations.length === 1, "W: relationship repair must not create or delete records");

state.orders.push({ id: "repair-follow-up", orderNo: "SO2607993", status: "follow_up", total: 500, deposit: 100, balance: 400 });
const statusConflict = scanWorkflowIntegrity().categories.D.find((issue) => issue.stableId === "repair-follow-up");
const statusRepair = await repairWorkflowIntegrityIssue(statusConflict.id, { nextStatus: "Confirmed" }, { confirm: false, downloadBackup: false });
assert(statusRepair.ok && state.orders.find((order) => order.id === "repair-follow-up").status === "Confirmed", "W: invalid Order follow_up status must change only after an explicit valid selection");
assert(state.orders.find((order) => order.id === "repair-follow-up").total === 500, "W: status repair must preserve financial data");

resetWorkflowState();
const syncQuote = validQuote("SYNC-QUOTE", "Production Sync Customer");
syncQuote.status = "won";
state.quotations = [syncQuote];
const syncConversion = await convertQuoteToOrder(syncQuote.id);
const syncOrder = syncConversion.order;
const productionCountBeforeSend = state.productionJobs.length;
const sendResult = await sendOrderToProduction(syncOrder.id);
assert(sendResult.ok && state.orders.find((order) => order.id === syncOrder.id).productionJobId === state.productionJobs[0].id, "X: Send to Production must save the exact Production Job ID on the Order");
assert(state.orders.find((order) => order.id === syncOrder.id).productionStatus === "not_produced", "X: Send to Production must preserve the normalized initial Production status");
await sendOrderToProduction(syncOrder.id);
assert(state.productionJobs.length === productionCountBeforeSend, "X: repeated Send to Production must not create another Production Job");
await markProductionStatus(state.productionJobs[0].id, "in_production");
assert(state.orders.find((order) => order.id === syncOrder.id).productionStatus === "in_production", "X: In Production must synchronize to the exact linked Order");
await markProductionStatus(state.productionJobs[0].id, "completed");
assert(state.orders.find((order) => order.id === syncOrder.id).productionStatus === "completed", "X: Production Completed must synchronize to the exact linked Order");
const persistedWorkflow = {
  orders: JSON.parse(localStorage.getItem("ecoScreenV2.orders") || "[]"),
  productionJobs: JSON.parse(localStorage.getItem("ecoScreenV2.productionJobs") || "[]")
};
assert(persistedWorkflow.orders.find((order) => order.id === syncOrder.id).productionStatus === "completed", "X: synchronized Order Production status must survive refresh storage");
assert(persistedWorkflow.productionJobs.find((job) => job.orderId === syncOrder.id).status === "completed", "X: synchronized Production Job status must survive refresh storage");

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
  "Order status update, refresh persistence and cloud-failure fallback: passed",
  "Won-only conversion and linked-order status protection: passed",
  "Confirmed duplicate scan, Main Order archive and linked reference repair: passed",
  "Archived duplicate restore and cloud-failure local persistence: passed",
  "Order number conflict and possible duplicate preview: passed"
  ,"Safe cloud stable-ID merge and missing configuration diagnostics: passed"
  ,"Production SO Order No resolution and search: passed"
  ,"Production duplicate scan, selectable Main, safe archive, reference repair and restore: passed"
  ,"Production cloud-failure persistence and repeat-conversion prevention: passed"
  ,"Strict quotation tabs, exact stable-ID relationships and Order conflict isolation: passed"
  ,"Workflow Integrity Check categories A-M, preview safety and selected repairs: passed"
  ,"Transactional Send to Production and Production/Order status synchronization: passed"
].join("\n"));
