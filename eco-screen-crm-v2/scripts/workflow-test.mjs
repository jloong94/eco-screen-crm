import { readFile } from "node:fs/promises";

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
  nextQuoteNumber,
  state
} = await import("../src/state.js");
const { runtimeEnv } = await import("../src/env.js");
const { mergeRows, safeSyncWithCloud } = await import("../src/cloudSync.js");
const { lineTotal } = await import("../src/calculations.js");
const {
  archiveDuplicateGroup,
  archiveProductionDuplicateGroup,
  activeProductionJobForOrder,
  buildSafeOrderOwnershipComparison,
  convertQuoteToOrder,
  createOrderFromQuote,
  createInstallationJobFromOrder,
  duplicateArchiveActionHtml,
  findExistingOrderForQuote,
  findOrderByNumber,
  monthlyOrderSequence,
  nextSalesOrderNumber,
  quotationOrderAction,
  linkedOrderForProduction,
  markInstallationStatus,
  markProductionStatus,
  getOrderDispatchState,
  productionJobMatchesSearch,
  productionWorkStageCounts,
  productionSheetPrintHtml,
  productionJobsForCurrentView,
  productionJobsForDisplay,
  productionDuplicateArchiveActionHtml,
  productionOrderNumber,
  restoreArchivedDuplicate,
  restoreArchivedProductionJob,
  recoverCoveredOrder,
  recoverMissingConfirmedOrder,
  recordOrderPayment,
  repairProductionDispatchIntegrity,
  repairWorkflowIntegrityIssue,
  repairOrderOwnership,
  returnOrderToFollowUp,
  reverseOrderPayment,
  resetWorkflowNavigationState,
  setOrderNavigationFilter,
  setProductionNavigationState,
  workflowNavigationState,
  ordersForDisplay,
  normalizeProductionStatus,
  getOrderPaymentSummary,
  generateWarrantyCard,
  installationDispatchDiagnostics,
  installationJobsForUser,
  nextWarrantyCardNumber,
  recallInstallationFromInstaller,
  saveInstallationArrangement,
  scanProductionDispatchIntegrity,
  scanWorkflowIntegrity,
  scanCoveredOrderReferences,
  scanMissingConfirmedOrderRecovery,
  searchCoveredOrderQuotations,
  scanDuplicateOrders,
  scanDuplicateProductionJobs,
  sendInstallationToInstaller,
  sendOrderToProduction,
  updateOrderNumber,
  updateOrderStatus,
  updateQuotationStatus,
  warrantyCardPreviewHtml
} = await import("../src/workflow.js");
const {
  buildDuplicateQuotation,
  duplicateQuotation,
  quoteDocumentHtml,
  quotationProjectName,
  quotationsForTab
} = await import("../src/quotations.js");
const {
  COLOR_VALUES,
  OPENING_DIRECTION_VALUES,
  colorLabel,
  missingChineseTranslations,
  normalizeColor,
  normalizeOpeningDirection,
  openingDirectionLabel,
  statusLabel,
  t
} = await import("../src/i18n.js");
const {
  isActiveOrderRecord,
  isActiveWorkflowRecord,
  normalizeWorkflowStatus,
  uniqueActiveOrders,
  uniqueActiveProductionJobs
} = await import("../src/workflowIntegrity.js");
const { canDuplicateQuotation, isBossOrAdmin } = await import("../src/permissions.js");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(isBossOrAdmin("Boss") && isBossOrAdmin(" boss ") && isBossOrAdmin("ADMIN") && isBossOrAdmin(" Admin "), "Boss/Admin recognition must ignore case and surrounding whitespace");
assert(!isBossOrAdmin("Sales") && !isBossOrAdmin(""), "Non-Boss/Admin roles must remain restricted");
assert(canDuplicateQuotation("Boss") && canDuplicateQuotation(" admin ") && canDuplicateQuotation("SECRETARY") && !canDuplicateQuotation("Sales"), "Duplicate Quotation must be restricted to normalized Boss/Admin/Secretary roles");

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
const ownershipQuote = validQuote("ESQ-2026-0003", "Tze Yee");
Object.assign(ownershipQuote, {
  id: "quote-1783130657886-e7f8c485de65a8",
  quotationNo: "ESQ-2026-0003",
  quoteNumber: "ESQ-2026-0003",
  customer: { name: "Tze Yee", phone: "0174590532" },
  phone: "0174590532",
  total: 5245.0113,
  deposit: 1000,
  balance: 4245.0113,
  status: "won",
  orderId: "order-ESQ-2026-0003",
  linkedOrderId: "order-ESQ-2026-0003",
  orderNo: "SO2607011",
  orderNumber: "SO2607011",
  updatedAt: "2026-07-01T01:00:00.000Z"
});
const wrongOwnerQuote = validQuote("ESQ-2026-0011", "MS Chew");
Object.assign(wrongOwnerQuote, {
  id: "quote-ms-chew",
  quotationNo: "ESQ-2026-0011",
  quoteNumber: "ESQ-2026-0011",
  customer: { name: "MS Chew", phone: "0164950766" },
  total: 2436,
  deposit: 436,
  balance: 2000,
  status: "won",
  orderId: "order-1784103199329-c9c68eddeaad2e",
  linkedOrderId: "order-1784103199329-c9c68eddeaad2e",
  orderNo: "SO2607011",
  orderNumber: "SO2607011",
  converted: true,
  convertedToOrder: true,
  updatedAt: "2026-07-01T01:00:00.000Z"
});
const tzeOrder = {
  id: "order-ESQ-2026-0003",
  orderNo: "SO2607011",
  orderNumber: "SO2607011",
  quoteId: wrongOwnerQuote.id,
  quotationId: wrongOwnerQuote.id,
  quoteNumber: "ESQ-2026-0011",
  quotationNo: "ESQ-2026-0011",
  customer: { name: "Tze Yee", phone: "0174590532" },
  items: [{ id: "tze-item", productId: "p-1", width: 1500, height: 1800, quantity: 2 }],
  total: 5245.0113,
  deposit: 1000,
  balance: 4245.0113,
  status: "Confirmed",
  updatedAt: "2026-07-01T01:00:00.000Z"
};
const msOrder = {
  id: "order-1784103199329-c9c68eddeaad2e",
  orderNo: "SO2607011",
  orderNumber: "SO2607011",
  quoteId: wrongOwnerQuote.id,
  quotationId: wrongOwnerQuote.id,
  quoteNumber: "ESQ-2026-0011",
  quotationNo: "ESQ-2026-0011",
  customer: { name: "MS Chew", phone: "0164950766" },
  items: [{ id: "ms-item", productId: "p-2", width: 900, height: 1200, quantity: 1 }],
  total: 2436,
  deposit: 436,
  balance: 2000,
  status: "Confirmed",
  updatedAt: "2026-07-01T01:00:00.000Z"
};
state.quotations = [ownershipQuote, wrongOwnerQuote];
state.orders = [tzeOrder, msOrder];
state.productionJobs = [
  { id: "production-tze", orderId: tzeOrder.id, orderNo: "SO2607011", orderNumber: "SO2607011", status: "in_production", assignedStaff: ["staff-a"], remarks: "Keep Tze progress", updatedAt: "2026-07-01T01:00:00.000Z" },
  { id: "production-ms", orderId: msOrder.id, orderNo: "SO2607011", orderNumber: "SO2607011", status: "completed", assignedStaff: ["staff-b"], remarks: "Keep MS progress", updatedAt: "2026-07-01T01:00:00.000Z" },
  { id: "production-number-only", orderNo: "SO2607011", orderNumber: "SO2607011", status: "not_produced", remarks: "Must stay untouched", updatedAt: "2026-07-01T01:00:00.000Z" }
];
state.installationJobs = [
  { id: "installation-tze", orderId: tzeOrder.id, orderNo: "SO2607011", orderNumber: "SO2607011", status: "scheduled", assignedStaff: ["installer-a"], remarks: "Keep Tze install", updatedAt: "2026-07-01T01:00:00.000Z" },
  { id: "installation-ms", orderId: msOrder.id, orderNo: "SO2607011", orderNumber: "SO2607011", status: "installed", assignedStaff: ["installer-b"], remarks: "Keep MS install", updatedAt: "2026-07-01T01:00:00.000Z" }
];
const ownershipBefore = structuredClone({
  quotations: state.quotations,
  orders: state.orders,
  productionJobs: state.productionJobs,
  installationJobs: state.installationJobs
});
const ownershipIssue = scanWorkflowIntegrity().categories.M.find((issue) => issue.repair?.type === "order-ownership"
  && issue.repair.quotationId === ownershipQuote.id
  && issue.repair.orderId === tzeOrder.id);
assert(ownershipIssue && ownershipIssue.problem.includes("Order Number Ownership Conflict"), "W2: Category M must clearly flag the exact Order Number Ownership Conflict");
const ownershipComparison = buildSafeOrderOwnershipComparison(ownershipQuote.id, tzeOrder.id);
assert(ownershipComparison.quotation.id === ownershipQuote.id && ownershipComparison.order.id === tzeOrder.id, "W2: comparison must use the exact selected stable IDs");
assert(ownershipComparison.productionJobIds.includes("production-tze") && ownershipComparison.installationJobIds.includes("installation-tze"), "W2: comparison must list Production and Installation IDs by exact orderId");
assert(ownershipComparison.conflicts.some((record) => record.id === msOrder.id), "W2: comparison must show the exact conflicting MS Chew Order");

const rejectedOwnershipRepair = await repairOrderOwnership({
  quotationId: ownershipQuote.id,
  orderId: tzeOrder.id,
  conflicts: [{ orderId: msOrder.id, replacementOrderNo: "SO2607011" }]
}, { confirm: false, downloadBackup: false });
assert(!rejectedOwnershipRepair.ok && JSON.stringify(state.orders) === JSON.stringify(ownershipBefore.orders), "W2: a used replacement SO number must be rejected without mutation");

const ownershipRepair = await repairWorkflowIntegrityIssue(ownershipIssue.id, {
  quotationId: ownershipQuote.id,
  orderId: tzeOrder.id,
  conflicts: [{ orderId: msOrder.id, replacementOrderNo: "SO2607012" }]
}, { confirm: false, downloadBackup: false });
assert(ownershipRepair.ok, "W2: Safe Order Ownership Repair must complete with exact IDs and an unused conflict number");
const repairedQuote = state.quotations.find((row) => row.id === ownershipQuote.id);
const repairedTzeOrder = state.orders.find((row) => row.id === tzeOrder.id);
const repairedMsOrder = state.orders.find((row) => row.id === msOrder.id);
assert(repairedQuote.orderId === tzeOrder.id && repairedQuote.linkedOrderId === tzeOrder.id, "W2: ESQ-2026-0003 must open the exact Tze Yee Order");
assert(repairedTzeOrder.quoteId === ownershipQuote.id && repairedTzeOrder.quotationId === ownershipQuote.id, "W2: Tze Yee Order must reverse-link to the exact ESQ-2026-0003 quotation");
assert(findOrderByNumber("SO2607011")?.id === tzeOrder.id && repairedMsOrder.orderNo === "SO2607012", "W2: SO2607011 must belong only to Tze Yee and not MS Chew");
const protectedView = (record) => ({ customer: record.customer, items: record.items, total: record.total, deposit: record.deposit, balance: record.balance });
assert(JSON.stringify(protectedView(repairedTzeOrder)) === JSON.stringify(protectedView(tzeOrder)), "W2: Tze Yee customer, items and financial data must remain unchanged");
assert(JSON.stringify(protectedView(repairedMsOrder)) === JSON.stringify(protectedView(msOrder)), "W2: MS Chew customer, items and financial data must remain unchanged");
assert(state.productionJobs.find((row) => row.id === "production-tze").orderId === tzeOrder.id
  && state.productionJobs.find((row) => row.id === "production-ms").orderId === msOrder.id
  && state.installationJobs.find((row) => row.id === "installation-tze").orderId === tzeOrder.id
  && state.installationJobs.find((row) => row.id === "installation-ms").orderId === msOrder.id, "W2: Production and Installation orderId values must never be relinked by SO number");
assert(state.productionJobs.find((row) => row.id === "production-ms").orderNo === "SO2607012"
  && state.installationJobs.find((row) => row.id === "installation-ms").orderNo === "SO2607012", "W2: only exact MS Chew stable-ID-linked references must receive the replacement SO number");
assert(state.productionJobs.find((row) => row.id === "production-number-only").orderNo === "SO2607011", "W2: a number-only Production record must remain untouched");
assert(state.productionJobs.find((row) => row.id === "production-ms").status === "completed"
  && state.productionJobs.find((row) => row.id === "production-ms").assignedStaff[0] === "staff-b"
  && state.productionJobs.find((row) => row.id === "production-ms").remarks === "Keep MS progress", "W2: Production progress, staff and remarks must remain unchanged");
assert(state.orders.length === ownershipBefore.orders.length
  && state.quotations.length === ownershipBefore.quotations.length
  && state.productionJobs.length === ownershipBefore.productionJobs.length
  && state.installationJobs.length === ownershipBefore.installationJobs.length, "W2: repair must not create, delete, merge or archive records");
const persistedOwnershipOrders = JSON.parse(localStorage.getItem("ecoScreenV2.orders") || "[]");
assert(persistedOwnershipOrders.find((row) => row.id === tzeOrder.id)?.quoteId === ownershipQuote.id
  && persistedOwnershipOrders.find((row) => row.id === msOrder.id)?.orderNo === "SO2607012", "W2: refresh storage must preserve repaired ownership and the conflict number change");
applyCloudSnapshot({
  quotations: ownershipBefore.quotations.map((row) => ({ ...row, updatedAt: "2020-01-01T00:00:00.000Z" })),
  orders: ownershipBefore.orders.map((row) => ({ ...row, updatedAt: "2020-01-01T00:00:00.000Z" })),
  productionJobs: ownershipBefore.productionJobs.map((row) => ({ ...row, updatedAt: "2020-01-01T00:00:00.000Z" })),
  installationJobs: ownershipBefore.installationJobs.map((row) => ({ ...row, updatedAt: "2020-01-01T00:00:00.000Z" }))
});
assert(state.orders.find((row) => row.id === tzeOrder.id)?.quoteId === ownershipQuote.id
  && state.orders.find((row) => row.id === msOrder.id)?.orderNo === "SO2607012", "W2: stale cloud roundtrip must not reverse the repaired ownership");

resetWorkflowState();
state.quotations = structuredClone(ownershipBefore.quotations);
state.orders = structuredClone(ownershipBefore.orders);
state.productionJobs = structuredClone(ownershipBefore.productionJobs);
state.installationJobs = structuredClone(ownershipBefore.installationJobs);
const confirmedBefore = structuredClone({
  quotations: state.quotations,
  orders: state.orders,
  productionJobs: state.productionJobs,
  installationJobs: state.installationJobs
});
const coveredTzeScan = scanCoveredOrderReferences("SO2607011");
assert(coveredTzeScan.ok
  && coveredTzeScan.confirmedOrderCandidates.includes(tzeOrder.id)
  && coveredTzeScan.quotationCandidates.includes(wrongOwnerQuote.id)
  && coveredTzeScan.records.some((entry) => entry.collection === "productionJobs" && entry.record.id === "production-number-only"), "W3: SO2607011 lookup must display every exact reference and derive selectable stable IDs");
const missingCoveredSelection = await recoverCoveredOrder({ orderNo: "SO2607011", confirmedOrderId: [tzeOrder.id], unconfirmedQuotationId: wrongOwnerQuote.id }, { confirm: false, downloadBackup: false });
assert(!missingCoveredSelection.ok && JSON.stringify(state.orders) === JSON.stringify(confirmedBefore.orders), "W3: multiple or missing stable-ID selections must stop without changing data");
const confirmedRepair = await recoverCoveredOrder({
  orderNo: "SO2607011",
  confirmedOrderId: tzeOrder.id,
  unconfirmedQuotationId: wrongOwnerQuote.id
}, { confirm: false, downloadBackup: false });
assert(confirmedRepair.ok, "W3: reusable Covered Order recovery must complete with the selected exact stable IDs");
const confirmedTzeQuote = state.quotations.find((row) => row.id === ownershipQuote.id);
const confirmedMsQuote = state.quotations.find((row) => row.id === wrongOwnerQuote.id);
const confirmedTzeOrder = state.orders.find((row) => row.id === tzeOrder.id);
const confirmedMsOrder = state.orders.find((row) => row.id === msOrder.id);
assert(findOrderByNumber("SO2607011")?.id === tzeOrder.id, "W3: SO2607011 must open the exact Tze Yee Order");
assert(findExistingOrderForQuote(confirmedTzeQuote)?.id === tzeOrder.id
  && confirmedTzeQuote.status === "won"
  && confirmedTzeQuote.orderId === tzeOrder.id
  && confirmedTzeOrder.quoteId === ownershipQuote.id
  && confirmedTzeOrder.quoteNumber === "ESQ-2026-0003", "W3: ESQ-2026-0003 and the Tze Yee Order must have exact symmetric links");
assert(quotationsForTab("follow_up").some((quote) => quote.id === wrongOwnerQuote.id), "W3: MS Chew must appear only as an unlinked Follow Up quotation");
assert(confirmedMsQuote.orderId === "" && confirmedMsQuote.linkedOrderId === ""
  && confirmedMsQuote.orderNo === "" && confirmedMsQuote.orderNumber === ""
  && confirmedMsQuote.converted === false && confirmedMsQuote.convertedToOrder === false, "W3: MS Chew must have no Order link or SO number");
assert(confirmedMsOrder.status === "cancelled_archived" && confirmedMsOrder.isArchived === true
  && confirmedMsOrder.archiveReason === "Unconfirmed quotation incorrectly created or linked as Order"
  && !isActiveOrderRecord(confirmedMsOrder), "W3: erroneous MS Chew Order must remain stored but be hidden from normal Orders");
const confirmedMsProduction = state.productionJobs.find((row) => row.id === "production-ms");
const confirmedMsInstallation = state.installationJobs.find((row) => row.id === "installation-ms");
assert(confirmedMsProduction.status === "cancelled_archived" && confirmedMsProduction.isArchived === true
  && confirmedMsProduction.orderId === msOrder.id && !isActiveWorkflowRecord(confirmedMsProduction)
  && !productionJobsForDisplay(state.productionJobs, false).some((row) => row.id === confirmedMsProduction.id), "W3: exact MS Chew Production must be archived without relinking and hidden from active Production");
assert(confirmedMsInstallation.status === "cancelled_archived" && confirmedMsInstallation.isArchived === true
  && confirmedMsInstallation.orderId === msOrder.id && !isActiveWorkflowRecord(confirmedMsInstallation), "W3: exact MS Chew Installation must be archived without relinking");
assert(confirmedMsProduction.statusBeforeArchive === "completed"
  && confirmedMsProduction.assignedStaff[0] === "staff-b"
  && confirmedMsProduction.remarks === "Keep MS progress"
  && confirmedMsInstallation.statusBeforeArchive === "installed"
  && confirmedMsInstallation.assignedStaff[0] === "installer-b"
  && confirmedMsInstallation.remarks === "Keep MS install", "W3: archived workflow records must preserve prior status, staff and remarks");
assert(state.productionJobs.find((row) => row.id === "production-tze").status === "in_production"
  && state.installationJobs.find((row) => row.id === "installation-tze").status === "scheduled"
  && state.productionJobs.find((row) => row.id === "production-number-only").status === "not_produced", "W3: Tze Yee and number-only workflow records must remain untouched");
assert(JSON.stringify(protectedView(confirmedTzeOrder)) === JSON.stringify(protectedView(tzeOrder))
  && JSON.stringify(protectedView(confirmedMsOrder)) === JSON.stringify(protectedView(msOrder))
  && JSON.stringify(protectedView(confirmedTzeQuote)) === JSON.stringify(protectedView(ownershipQuote))
  && JSON.stringify(protectedView(confirmedMsQuote)) === JSON.stringify(protectedView(wrongOwnerQuote)), "W3: all original customer, item and financial information must remain unchanged");
assert(state.orders.length === confirmedBefore.orders.length
  && state.quotations.length === confirmedBefore.quotations.length
  && state.productionJobs.length === confirmedBefore.productionJobs.length
  && state.installationJobs.length === confirmedBefore.installationJobs.length, "W3: confirmed repair must not hard-delete, merge or create records");
const persistedConfirmed = {
  quotations: JSON.parse(localStorage.getItem("ecoScreenV2.quotations") || "[]"),
  orders: JSON.parse(localStorage.getItem("ecoScreenV2.orders") || "[]"),
  productionJobs: JSON.parse(localStorage.getItem("ecoScreenV2.productionJobs") || "[]"),
  installationJobs: JSON.parse(localStorage.getItem("ecoScreenV2.installationJobs") || "[]")
};
assert(persistedConfirmed.quotations.find((row) => row.id === wrongOwnerQuote.id)?.status === "follow_up"
  && persistedConfirmed.orders.find((row) => row.id === msOrder.id)?.status === "cancelled_archived"
  && persistedConfirmed.productionJobs.find((row) => row.id === "production-ms")?.status === "cancelled_archived"
  && persistedConfirmed.installationJobs.find((row) => row.id === "installation-ms")?.status === "cancelled_archived", "W3: refresh storage must preserve the confirmed repair");
applyCloudSnapshot({
  quotations: confirmedBefore.quotations.map((row) => ({ ...row, updatedAt: "2020-01-01T00:00:00.000Z" })),
  orders: confirmedBefore.orders.map((row) => ({ ...row, updatedAt: "2020-01-01T00:00:00.000Z" })),
  productionJobs: confirmedBefore.productionJobs.map((row) => ({ ...row, updatedAt: "2020-01-01T00:00:00.000Z" })),
  installationJobs: confirmedBefore.installationJobs.map((row) => ({ ...row, updatedAt: "2020-01-01T00:00:00.000Z" }))
});
assert(state.quotations.find((row) => row.id === wrongOwnerQuote.id)?.status === "follow_up"
  && state.orders.find((row) => row.id === msOrder.id)?.status === "cancelled_archived"
  && state.productionJobs.find((row) => row.id === "production-ms")?.status === "cancelled_archived", "W3: stale cloud roundtrip must not reverse the confirmed repair");

resetWorkflowState();
const datinQuote = validQuote("ESQ-DATIN", "Datin Conni");
Object.assign(datinQuote, {
  id: "quote-datin-conni",
  customer: { name: "Datin Conni", phone: "0123000001" },
  items: [{ id: "datin-item", quantity: 2, width: 1200, height: 1800 }],
  total: 6800,
  deposit: 1800,
  balance: 5000,
  status: "won",
  orderId: "order-datin-conni",
  linkedOrderId: "order-datin-conni",
  orderNo: "SO2607013",
  orderNumber: "SO2607013",
  remarks: "Confirmed Datin quotation"
});
const datinConflictQuote = validQuote("ESQ-DATIN-CONFLICT", "Unconfirmed Customer");
Object.assign(datinConflictQuote, {
  id: "quote-datin-conflict",
  customer: { name: "Unconfirmed Customer", phone: "0123000002" },
  items: [{ id: "conflict-item", quantity: 1, width: 800, height: 1000 }],
  total: 1900,
  deposit: 0,
  balance: 1900,
  status: "won",
  orderId: "order-datin-conflict",
  linkedOrderId: "order-datin-conflict",
  orderNo: "SO2607013",
  orderNumber: "SO2607013",
  converted: true,
  convertedToOrder: true,
  remarks: "Unconfirmed quotation remains auditable"
});
const datinOrder = {
  id: "order-datin-conni",
  orderNo: "SO2607013",
  orderNumber: "SO2607013",
  quoteId: datinConflictQuote.id,
  quotationId: datinConflictQuote.id,
  quoteNumber: datinConflictQuote.quotationNo,
  quotationNo: datinConflictQuote.quotationNo,
  customer: structuredClone(datinQuote.customer),
  items: structuredClone(datinQuote.items),
  total: datinQuote.total,
  deposit: datinQuote.deposit,
  balance: datinQuote.balance,
  status: "Confirmed",
  remarks: "Datin confirmed Order"
};
const datinConflictOrder = {
  id: "order-datin-conflict",
  orderNo: "SO2607013",
  orderNumber: "SO2607013",
  quoteId: datinConflictQuote.id,
  quotationId: datinConflictQuote.id,
  quoteNumber: datinConflictQuote.quotationNo,
  quotationNo: datinConflictQuote.quotationNo,
  customer: structuredClone(datinConflictQuote.customer),
  items: structuredClone(datinConflictQuote.items),
  total: datinConflictQuote.total,
  deposit: datinConflictQuote.deposit,
  balance: datinConflictQuote.balance,
  status: "Confirmed",
  remarks: "Erroneous Order retained for audit"
};
state.quotations = [datinQuote, datinConflictQuote];
state.orders = [datinOrder, datinConflictOrder];
state.productionJobs = [
  { id: "production-datin-conflict", orderId: datinConflictOrder.id, orderNo: "SO2607013", status: "in_production", assignedStaff: ["staff-d"], items: structuredClone(datinConflictOrder.items), remarks: "Preserve production payload", statusHistory: ["not_produced", "in_production"] },
  { id: "production-datin-number-only", orderNo: "SO2607013", status: "not_produced", remarks: "Number-only reference stays active" }
];
state.installationJobs = [
  { id: "installation-datin-conflict", orderId: datinConflictOrder.id, orderNo: "SO2607013", status: "scheduled", assignedStaff: ["installer-d"], items: structuredClone(datinConflictOrder.items), remarks: "Preserve installation payload", statusHistory: ["not_scheduled", "scheduled"] }
];
const datinBefore = structuredClone({ quotations: state.quotations, orders: state.orders, productionJobs: state.productionJobs, installationJobs: state.installationJobs });
const datinScan = scanCoveredOrderReferences("SO2607013");
assert(datinScan.ok
  && datinScan.confirmedOrderCandidates.includes(datinOrder.id)
  && datinScan.quotationCandidates.includes(datinConflictQuote.id)
  && ["quotations", "orders", "productionJobs", "installationJobs"].every((collection) => datinScan.records.some((entry) => entry.collection === collection)), "W4: SO2607013 lookup must display Datin Conni and every conflicting collection");
const realConfirmedSelection = await recoverCoveredOrder({ orderNo: "SO2607013", confirmedOrderId: datinOrder.id, unconfirmedQuotationId: datinQuote.id }, { confirm: false, downloadBackup: false });
assert(!realConfirmedSelection.ok && JSON.stringify(state.orders) === JSON.stringify(datinBefore.orders), "W4: a quotation already pointing to the confirmed Order must not be returned to Follow Up");
const datinRepair = await recoverCoveredOrder({
  orderNo: "SO2607013",
  confirmedOrderId: datinOrder.id,
  unconfirmedQuotationId: datinConflictQuote.id
}, { confirm: false, downloadBackup: false });
assert(datinRepair.ok, "W4: Datin Conni must be selectable as the confirmed SO2607013 customer");
const recoveredDatinQuote = state.quotations.find((row) => row.id === datinQuote.id);
const recoveredDatinOrder = state.orders.find((row) => row.id === datinOrder.id);
const recoveredConflictQuote = state.quotations.find((row) => row.id === datinConflictQuote.id);
const archivedConflictOrder = state.orders.find((row) => row.id === datinConflictOrder.id);
assert(recoveredDatinQuote.status === "won" && recoveredDatinQuote.orderId === datinOrder.id
  && recoveredDatinOrder.quoteId === datinQuote.id && recoveredDatinOrder.orderNo === "SO2607013", "W4: SO2607013 must open Datin Conni through exact bidirectional links");
assert(recoveredConflictQuote.status === "follow_up" && !recoveredConflictQuote.orderNo && !recoveredConflictQuote.orderId
  && archivedConflictOrder.status === "cancelled_archived" && archivedConflictOrder.orderNo === "SO2607013", "W4: the unconfirmed customer receives no new SO number and its erroneous Order remains archived for audit");
assert(JSON.stringify(protectedView(recoveredDatinQuote)) === JSON.stringify(protectedView(datinQuote))
  && JSON.stringify(protectedView(recoveredDatinOrder)) === JSON.stringify(protectedView(datinOrder))
  && JSON.stringify(protectedView(recoveredConflictQuote)) === JSON.stringify(protectedView(datinConflictQuote))
  && JSON.stringify(protectedView(archivedConflictOrder)) === JSON.stringify(protectedView(datinConflictOrder)), "W4: customer, items and financial values must never move between Datin records");
const archivedDatinProduction = state.productionJobs.find((row) => row.id === "production-datin-conflict");
const archivedDatinInstallation = state.installationJobs.find((row) => row.id === "installation-datin-conflict");
assert(archivedDatinProduction.status === "cancelled_archived" && archivedDatinProduction.orderId === datinConflictOrder.id
  && archivedDatinInstallation.status === "cancelled_archived" && archivedDatinInstallation.orderId === datinConflictOrder.id
  && state.productionJobs.find((row) => row.id === "production-datin-number-only").status === "not_produced", "W4: jobs are archived only through the exact erroneous orderId; number-only references remain untouched");
assert(JSON.stringify(archivedDatinProduction.items) === JSON.stringify(datinBefore.productionJobs[0].items)
  && JSON.stringify(archivedDatinProduction.statusHistory) === JSON.stringify(datinBefore.productionJobs[0].statusHistory)
  && archivedDatinProduction.assignedStaff[0] === "staff-d"
  && archivedDatinInstallation.remarks === "Preserve installation payload", "W4: Production and Installation payload, history, staff and remarks must be preserved");
assert(JSON.parse(localStorage.getItem("ecoScreenV2.orders") || "[]").find((row) => row.id === datinConflictOrder.id)?.status === "cancelled_archived", "W4: refresh storage must preserve the Datin recovery");

resetWorkflowState();
const missingTzeQuote = validQuote("SO-2607-011", "Tze Yee");
Object.assign(missingTzeQuote, {
  id: "quote-1783130657886-e7f8c485de65a8",
  customer: { name: "Tze Yee", phone: "0174590532" },
  quotationNo: "SO-2607-011",
  quoteNo: "SO-2607-011",
  quoteNumber: "SO-2607-011",
  orderId: "order-ESQ-2026-0003",
  linkedOrderId: "order-ESQ-2026-0003",
  orderNo: "ESQ-2026-0003",
  orderNumber: "ESQ-2026-0003",
  status: "won",
  converted: true,
  convertedToOrder: true,
  total: 5245.0113,
  deposit: 1000,
  balance: 4245.0113,
  remarks: "Keep Tze quotation payload"
});
const janeQuote = validQuote("ESQ-2026-0003", "Jane");
Object.assign(janeQuote, { id: "quote-jane-covered", customer: { name: "Jane", phone: "0164931118" }, status: "won", orderId: "order-ESQ-2026-0003", linkedOrderId: "order-ESQ-2026-0003", total: 1815 });
const janeOrder = {
  id: "order-ESQ-2026-0003",
  orderNo: "ESQ-2026-00033",
  orderNumber: "ESQ-2026-00033",
  quoteId: janeQuote.id,
  quotationId: janeQuote.id,
  quoteNumber: "ESQ-2026-0003",
  quotationNo: "ESQ-2026-0003",
  customer: structuredClone(janeQuote.customer),
  items: structuredClone(janeQuote.items),
  total: 1815,
  deposit: 100,
  balance: 1715,
  status: "Confirmed",
  remarks: "Jane payload must not be used or changed"
};
const missingMsQuote = validQuote("ESQ-2026-0011", "MS Chew");
Object.assign(missingMsQuote, {
  id: "quote-1783586082779-020ce4ca5f2a3",
  customer: { name: "MS Chew", phone: "0164950766" },
  status: "won",
  orderId: "order-1784103199329-c9c68eddead2e",
  linkedOrderId: "order-1784103199329-c9c68eddead2e",
  orderNo: "SO2607011",
  orderNumber: "SO2607011",
  total: 2436,
  deposit: 0,
  balance: 2436,
  remarks: "Keep MS quotation payload"
});
const missingMsOrder = {
  id: "order-1784103199329-c9c68eddead2e",
  orderNo: "SO2607011",
  orderNumber: "SO2607011",
  quoteId: missingMsQuote.id,
  quotationId: missingMsQuote.id,
  quoteNumber: "ESQ-2026-0011",
  quotationNo: "ESQ-2026-0011",
  customer: structuredClone(missingMsQuote.customer),
  items: structuredClone(missingMsQuote.items),
  total: 2436,
  deposit: 0,
  balance: 2436,
  status: "Confirmed",
  remarks: "Keep MS Order audit payload"
};
state.quotations = [missingTzeQuote, janeQuote, missingMsQuote];
state.orders = [janeOrder, missingMsOrder];
state.productionJobs = [
  { id: "production-missing-ms", orderId: missingMsOrder.id, orderNo: "SO2607011", status: "in_production", assignedStaff: ["staff-ms"], items: structuredClone(missingMsOrder.items), remarks: "Keep MS production", statusHistory: ["not_produced", "in_production"] },
  { id: "production-missing-number-only", orderNo: "SO2607011", status: "not_produced", remarks: "Number-only must remain active" }
];
state.installationJobs = [
  { id: "installation-missing-ms", orderId: missingMsOrder.id, orderNo: "SO2607011", status: "scheduled", assignedStaff: ["installer-ms"], items: structuredClone(missingMsOrder.items), remarks: "Keep MS installation", statusHistory: ["not_scheduled", "scheduled"] }
];
const missingTzeBefore = structuredClone({ quotations: state.quotations, orders: state.orders, productionJobs: state.productionJobs, installationJobs: state.installationJobs });
const tzeCustomerSearch = searchCoveredOrderQuotations("TzeYee");
const tzeEsqSearch = searchCoveredOrderQuotations("ESQ-2026-0003");
assert(tzeCustomerSearch.quotationCandidates.includes(missingTzeQuote.id)
  && tzeEsqSearch.quotationCandidates.includes(missingTzeQuote.id), "W5: missing confirmed quotation must be searchable by normalized customer or ESQ alias");
const missingTzeScan = scanMissingConfirmedOrderRecovery(missingTzeQuote.id, "SO2607011");
assert(missingTzeScan.ok
  && missingTzeScan.correctOrderCandidates.length === 0
  && missingTzeScan.records.some((entry) => entry.collection === "orders" && entry.record.id === janeOrder.id)
  && missingTzeScan.records.some((entry) => entry.collection === "orders" && entry.record.id === missingMsOrder.id)
  && missingTzeScan.records.some((entry) => entry.collection === "productionJobs" && entry.record.id === "production-missing-ms")
  && missingTzeScan.records.some((entry) => entry.collection === "installationJobs" && entry.record.id === "installation-missing-ms"), "W5: missing mode must show alias and exact stable-ID related records across all workflow collections");
const unselectedOwnerRecovery = await recoverMissingConfirmedOrder({ confirmedQuotationId: missingTzeQuote.id, intendedOrderNo: "SO2607011", incorrectQuotationIds: [], incorrectOrderIds: [] }, { confirm: false, downloadBackup: false });
assert(!unselectedOwnerRecovery.ok && JSON.stringify(state.orders) === JSON.stringify(missingTzeBefore.orders), "W5: an active SO owner not explicitly selected as incorrect must block without mutation");
const missingIncorrectOrderSelection = await recoverMissingConfirmedOrder({
  confirmedQuotationId: missingTzeQuote.id,
  intendedOrderNo: "SO2607011",
  incorrectQuotationIds: [missingMsQuote.id],
  incorrectOrderIds: []
}, { confirm: false, downloadBackup: false });
assert(!missingIncorrectOrderSelection.ok
  && missingIncorrectOrderSelection.message.includes(missingMsOrder.id)
  && JSON.stringify(state.orders) === JSON.stringify(missingTzeBefore.orders), "W5: selecting MS Chew quotation without its exact active Order must block without mutation");
const unrelatedSoOwner = {
  ...structuredClone(missingMsOrder),
  id: "order-unrelated-so2607011",
  quoteId: "quote-unrelated-so2607011",
  quotationId: "quote-unrelated-so2607011",
  customer: { name: "Unrelated Active Owner", phone: "0190000000" },
  total: 999,
  remarks: "Unrelated active SO owner must block"
};
state.orders = [...state.orders, unrelatedSoOwner];
const unrelatedOwnerBefore = JSON.stringify(state.orders);
const unrelatedOwnerRecovery = await recoverMissingConfirmedOrder({
  confirmedQuotationId: missingTzeQuote.id,
  intendedOrderNo: "SO2607011",
  incorrectQuotationIds: [missingMsQuote.id],
  incorrectOrderIds: [missingMsOrder.id]
}, { confirm: false, downloadBackup: false });
assert(!unrelatedOwnerRecovery.ok
  && unrelatedOwnerRecovery.message.includes(unrelatedSoOwner.id)
  && JSON.stringify(state.orders) === unrelatedOwnerBefore, "W5: an unrelated active SO owner must still block when it is not selected for archival");
state.orders = state.orders.filter((order) => order.id !== unrelatedSoOwner.id);
const missingTzeRecovery = await recoverMissingConfirmedOrder({
  confirmedQuotationId: missingTzeQuote.id,
  intendedOrderNo: "SO2607011",
  incorrectQuotationIds: [missingMsQuote.id],
  incorrectOrderIds: [missingMsOrder.id]
}, { confirm: false, downloadBackup: false });
assert(missingTzeRecovery.ok && missingTzeRecovery.confirmedOrderId !== janeOrder.id && state.orders.length === missingTzeBefore.orders.length + 1, "W5: Tze recovery must create one brand-new unique Order instead of reusing Jane or MS payload");
const recoveredMissingTzeQuote = state.quotations.find((row) => row.id === missingTzeQuote.id);
const recoveredMissingTzeOrder = state.orders.find((row) => row.id === missingTzeRecovery.confirmedOrderId);
const followedUpMsQuote = state.quotations.find((row) => row.id === missingMsQuote.id);
const archivedMissingMsOrder = state.orders.find((row) => row.id === missingMsOrder.id);
assert(findOrderByNumber("SO2607011")?.id === recoveredMissingTzeOrder.id
  && recoveredMissingTzeQuote.status === "won"
  && recoveredMissingTzeQuote.orderId === recoveredMissingTzeOrder.id
  && recoveredMissingTzeOrder.quoteId === missingTzeQuote.id
  && recoveredMissingTzeOrder.quoteNumber === "ESQ-2026-0003", "W5: SO2607011 must open the new Tze Order with exact bidirectional ESQ links");
assert(recoveredMissingTzeOrder.customer.name === "Tze Yee" && recoveredMissingTzeOrder.total === missingTzeQuote.total
  && recoveredMissingTzeOrder.deposit === missingTzeQuote.deposit && recoveredMissingTzeOrder.balance === missingTzeQuote.balance, "W5: new Tze Order payload and financial values must come only from the selected quotation snapshot");
assert(followedUpMsQuote.status === "follow_up" && !followedUpMsQuote.orderId && !followedUpMsQuote.orderNo
  && followedUpMsQuote.converted === false && followedUpMsQuote.convertedToOrder === false, "W5: selected MS quotation must return to Follow Up without an SO number");
assert(archivedMissingMsOrder.status === "cancelled_archived" && archivedMissingMsOrder.isArchived === true
  && archivedMissingMsOrder.archiveReason === "Incorrect Order payload covering confirmed quotation"
  && state.productionJobs.find((row) => row.id === "production-missing-ms").status === "cancelled_archived"
  && state.installationJobs.find((row) => row.id === "installation-missing-ms").status === "cancelled_archived"
  && state.productionJobs.find((row) => row.id === "production-missing-number-only").status === "not_produced", "W5: only explicitly selected wrong Order and exact-orderId jobs may be archived");
assert(JSON.stringify(state.orders.find((row) => row.id === janeOrder.id)) === JSON.stringify(janeOrder), "W5: unselected Jane conflict must remain byte-for-byte unchanged");
assert(JSON.stringify(protectedView(followedUpMsQuote)) === JSON.stringify(protectedView(missingMsQuote))
  && JSON.stringify(protectedView(archivedMissingMsOrder)) === JSON.stringify(protectedView(missingMsOrder)), "W5: selected incorrect records must preserve customer, items and finances");
const persistedMissingTzeOrders = JSON.parse(localStorage.getItem("ecoScreenV2.orders") || "[]");
assert(persistedMissingTzeOrders.some((row) => row.id === recoveredMissingTzeOrder.id && row.orderNo === "SO2607011"), "W5: local refresh storage must preserve the newly recovered Order");
applyCloudSnapshot({
  quotations: missingTzeBefore.quotations.map((row) => ({ ...row, updatedAt: "2020-01-01T00:00:00.000Z" })),
  orders: missingTzeBefore.orders.map((row) => ({ ...row, updatedAt: "2020-01-01T00:00:00.000Z" })),
  productionJobs: missingTzeBefore.productionJobs.map((row) => ({ ...row, updatedAt: "2020-01-01T00:00:00.000Z" })),
  installationJobs: missingTzeBefore.installationJobs.map((row) => ({ ...row, updatedAt: "2020-01-01T00:00:00.000Z" }))
});
assert(state.quotations.find((row) => row.id === missingTzeQuote.id)?.orderId === recoveredMissingTzeOrder.id
  && state.orders.some((row) => row.id === recoveredMissingTzeOrder.id)
  && state.orders.find((row) => row.id === missingMsOrder.id)?.status === "cancelled_archived", "W5: older cloud data must not reverse the successful missing Order recovery");

resetWorkflowState();
const missingDatinQuote = validQuote("ESQ-2026-0005", "Datin Connie");
Object.assign(missingDatinQuote, {
  id: "quote-1783169774121-d1c12989c04ae",
  customer: { name: "Datin Connie", phone: "0124818736" },
  status: "quoted",
  orderId: "order-ESQ-2026-0005",
  linkedOrderId: "",
  orderNo: "",
  orderNumber: "",
  converted: true,
  convertedToOrder: true,
  total: 14199.996,
  deposit: 3000,
  balance: 11199.996,
  remarks: "Keep Datin payload"
});
const shiauQuote = validQuote("ESQ-2026-0005", "Shiau fenn");
Object.assign(shiauQuote, {
  id: "quote-1783136724738-479f6aaaea7f4",
  customer: { name: "Shiau fenn", phone: "0125240355" },
  status: "won",
  orderId: "order-ESQ-2026-0005",
  linkedOrderId: "order-ESQ-2026-0005",
  orderNo: "SO2607013",
  orderNumber: "SO2607013",
  converted: true,
  convertedToOrder: true,
  total: 5993.22
});
const shiauOrder = {
  id: "order-ESQ-2026-0005",
  orderNo: "SO2607013",
  orderNumber: "SO2607013",
  quoteId: missingDatinQuote.id,
  quotationId: missingDatinQuote.id,
  quoteNumber: "ESQ-2026-0005",
  quotationNo: "ESQ-2026-0005",
  customer: structuredClone(shiauQuote.customer),
  items: structuredClone(shiauQuote.items),
  total: shiauQuote.total,
  deposit: shiauQuote.deposit,
  balance: shiauQuote.balance,
  status: "Confirmed",
  remarks: "Shiau payload remains untouched"
};
state.quotations = [missingDatinQuote, shiauQuote];
state.orders = [shiauOrder];
const missingDatinBefore = structuredClone({ quotations: state.quotations, orders: state.orders });
const datinCustomerCandidates = searchCoveredOrderQuotations("Datin Conni");
const datinEsqCandidates = searchCoveredOrderQuotations("ESQ-2026-0005");
assert(datinCustomerCandidates.quotationCandidates.includes(missingDatinQuote.id)
  && datinEsqCandidates.quotationCandidates.includes(missingDatinQuote.id)
  && datinEsqCandidates.quotationCandidates.includes(shiauQuote.id), "W6: Datin must be selectable by normalized customer search while duplicate ESQ candidates remain visible by exact stable ID");
const missingDatinScan = scanMissingConfirmedOrderRecovery(missingDatinQuote.id, "SO2607013");
assert(missingDatinScan.ok && missingDatinScan.correctOrderCandidates.length === 0
  && missingDatinScan.records.some((entry) => entry.collection === "orders" && entry.record.id === shiauOrder.id)
  && missingDatinScan.records.some((entry) => entry.collection === "quotations" && entry.record.id === shiauQuote.id), "W6: Datin comparison must include the covered Shiau payload through exact links and ESQ aliases");
const missingDatinRecovery = await recoverMissingConfirmedOrder({
  confirmedQuotationId: missingDatinQuote.id,
  intendedOrderNo: "SO2607013",
  incorrectQuotationIds: [shiauQuote.id],
  incorrectOrderIds: [shiauOrder.id]
}, { confirm: false, downloadBackup: false });
assert(missingDatinRecovery.ok && state.orders.length === missingDatinBefore.orders.length + 1, "W6: Datin recovery must allow an explicitly selected Shiau quotation and active Order conflict");
const recoveredMissingDatinQuote = state.quotations.find((row) => row.id === missingDatinQuote.id);
const recoveredMissingDatinOrder = state.orders.find((row) => row.id === missingDatinRecovery.confirmedOrderId);
const followedUpShiauQuote = state.quotations.find((row) => row.id === shiauQuote.id);
const archivedShiauOrder = state.orders.find((row) => row.id === shiauOrder.id);
assert(findOrderByNumber("SO2607013")?.id === recoveredMissingDatinOrder.id
  && recoveredMissingDatinQuote.status === "won"
  && recoveredMissingDatinQuote.orderId === recoveredMissingDatinOrder.id
  && recoveredMissingDatinOrder.quoteId === missingDatinQuote.id
  && recoveredMissingDatinOrder.customer.name === "Datin Connie"
  && recoveredMissingDatinOrder.total === missingDatinQuote.total, "W6: SO2607013 must open the new Datin Order built only from the selected quotation snapshot");
assert(followedUpShiauQuote.status === "follow_up" && !followedUpShiauQuote.orderId && !followedUpShiauQuote.orderNo
  && archivedShiauOrder.status === "cancelled_archived" && archivedShiauOrder.isArchived === true, "W6: explicitly selected Shiau quotation and Order must return to Follow Up and archive in the same transaction");
assert(JSON.stringify(protectedView(followedUpShiauQuote)) === JSON.stringify(protectedView(shiauQuote))
  && JSON.stringify(protectedView(archivedShiauOrder)) === JSON.stringify(protectedView(shiauOrder)), "W6: selected Shiau customer, item and financial payload must remain unchanged");
assert(nextSalesOrderNumber(new Date("2026-07-20T00:00:00Z")) === "SO2607014", "W6: recovered SO2607013 must advance future SO issuance without going backward or duplicating the number");
const datinOrderCountBeforeRepeat = state.orders.length;
const repeatedMissingDatinConversion = await convertQuoteToOrder(missingDatinQuote.id);
assert(repeatedMissingDatinConversion.ok && repeatedMissingDatinConversion.existing === true
  && state.orders.length === datinOrderCountBeforeRepeat, "W6: converting the recovered quotation again must reuse the exact new Order and never create a duplicate SO");

resetWorkflowState();
const genuineConfirmedQuote = validQuote("ESQ-GENUINE-CONFIRMED", "Genuine Confirmed Customer");
genuineConfirmedQuote.status = "won";
state.quotations = [genuineConfirmedQuote];
const genuineConversion = await convertQuoteToOrder(genuineConfirmedQuote.id);
const genuineBeforeMissingRecovery = structuredClone({ quotations: state.quotations, orders: state.orders });
const duplicateGenuineRecovery = await recoverMissingConfirmedOrder({
  confirmedQuotationId: genuineConfirmedQuote.id,
  intendedOrderNo: "SO2607999",
  incorrectQuotationIds: [],
  incorrectOrderIds: []
}, { confirm: false, downloadBackup: false });
assert(!duplicateGenuineRecovery.ok
  && duplicateGenuineRecovery.message.includes(genuineConversion.order.id)
  && JSON.stringify(state.quotations) === JSON.stringify(genuineBeforeMissingRecovery.quotations)
  && JSON.stringify(state.orders) === JSON.stringify(genuineBeforeMissingRecovery.orders), "W6: a confirmed quotation with its own genuine correct active Order must still block duplicate Order creation");

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
assert(Number.isFinite(Date.parse(state.orders.find((order) => order.id === syncOrder.id).sentToProductionAt)), "X: future Send to Production must record sentToProductionAt");
await sendOrderToProduction(syncOrder.id);
assert(state.productionJobs.length === productionCountBeforeSend, "X: repeated Send to Production must not create another Production Job");
const duplicateSendJob = { ...state.productionJobs[0], id: "production-send-duplicate-block" };
state.productionJobs.push(duplicateSendJob);
const beforeBlockedSend = JSON.stringify(state.orders.find((order) => order.id === syncOrder.id));
const blockedDuplicateSend = await sendOrderToProduction(syncOrder.id);
assert(!blockedDuplicateSend.ok && blockedDuplicateSend.blocked
  && state.productionJobs.length === productionCountBeforeSend + 1
  && JSON.stringify(state.orders.find((order) => order.id === syncOrder.id)) === beforeBlockedSend,
"X: Send to Production must block multiple exact active Jobs without changing the Order or creating another Job");
state.productionJobs = state.productionJobs.filter((job) => job.id !== duplicateSendJob.id);
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

resetWorkflowState();
state.currentUser = { userId: "boss-test", username: "boss-test", name: "Boss Test", role: "Boss", active: true };
state.role = "Boss";
const followUpQuote = validQuote("FOLLOW-UP-QUOTE", "Unconfirmed Customer");
followUpQuote.status = "won";
state.quotations = [followUpQuote];
const followUpConversion = await convertQuoteToOrder(followUpQuote.id);
const followUpOrderId = followUpConversion.order.id;
const followUpOrderNo = followUpConversion.order.orderNo;
state.orders = state.orders.map((order) => order.id === followUpOrderId ? {
  ...order,
  paidAmount: 225,
  amountPaid: 225,
  totalPaid: 225,
  balance: order.total - 225,
  remarks: "Preserve Order history"
} : order);
state.productionJobs.push({ id: "production-unrelated-number-only", orderId: "another-order", orderNo: followUpOrderNo, status: "in_production", remarks: "Must remain active" });
state.installationJobs.push({ id: "installation-unrelated-number-only", orderId: "another-order", orderNo: followUpOrderNo, status: "scheduled", remarks: "Must remain active" });
const returnBefore = structuredClone({ quotations: state.quotations, orders: state.orders, productionJobs: state.productionJobs, installationJobs: state.installationJobs });
const returnResult = await returnOrderToFollowUp(followUpOrderId, "Customer did not confirm", { confirmPaid: false, downloadBackup: false });
assert(returnResult.ok, "Y1: Boss must be able to return an exact active Order to Follow Up");
const returnedQuote = state.quotations.find((quote) => quote.id === followUpQuote.id);
const archivedFollowUpOrder = state.orders.find((order) => order.id === followUpOrderId);
assert(returnedQuote.status === "follow_up" && returnedQuote.workflowStatus === "follow_up"
  && returnedQuote.orderId === "" && returnedQuote.linkedOrderId === ""
  && returnedQuote.orderNo === "" && returnedQuote.orderNumber === ""
  && returnedQuote.converted === false && returnedQuote.convertedToOrder === false, "Y1: exact linked quotation must return to Follow Up with no SO relationship fields");
assert(archivedFollowUpOrder.status === "cancelled_archived" && archivedFollowUpOrder.isArchived === true
  && archivedFollowUpOrder.archiveReason === "Customer did not confirm"
  && archivedFollowUpOrder.statusBeforeArchive === returnBefore.orders[0].status
  && !isActiveOrderRecord(archivedFollowUpOrder), "Y1: selected Order must be archived, auditable and hidden from active Orders");
assert(archivedFollowUpOrder.orderNo === followUpOrderNo
  && archivedFollowUpOrder.paidAmount === 225 && archivedFollowUpOrder.amountPaid === 225 && archivedFollowUpOrder.totalPaid === 225
  && archivedFollowUpOrder.balance === returnBefore.orders[0].balance
  && JSON.stringify(archivedFollowUpOrder.customer) === JSON.stringify(returnBefore.orders[0].customer)
  && JSON.stringify(archivedFollowUpOrder.items) === JSON.stringify(returnBefore.orders[0].items), "Y1: original SO, customer, items and every existing payment value must remain unchanged");
assert(state.productionJobs.find((job) => job.orderId === followUpOrderId)?.status === "cancelled_archived"
  && state.productionJobs.find((job) => job.orderId === followUpOrderId)?.statusBeforeArchive
  && state.installationJobs.find((job) => job.orderId === followUpOrderId)?.status === "cancelled_archived"
  && state.installationJobs.find((job) => job.orderId === followUpOrderId)?.statusBeforeArchive, "Y1: only exact orderId-linked Production and Installation jobs must be safely archived");
assert(state.productionJobs.find((job) => job.id === "production-unrelated-number-only").status === "in_production"
  && state.installationJobs.find((job) => job.id === "installation-unrelated-number-only").status === "scheduled", "Y1: unrelated same-number jobs must remain unchanged");
assert(JSON.parse(localStorage.getItem("ecoScreenV2.orders") || "[]").find((order) => order.id === followUpOrderId)?.status === "cancelled_archived", "Y1: Return to Follow Up must survive refresh storage");
applyCloudSnapshot({
  quotations: returnBefore.quotations.map((row) => ({ ...row, updatedAt: "2020-01-01T00:00:00.000Z" })),
  orders: returnBefore.orders.map((row) => ({ ...row, updatedAt: "2020-01-01T00:00:00.000Z" })),
  productionJobs: returnBefore.productionJobs.map((row) => ({ ...row, updatedAt: "2020-01-01T00:00:00.000Z" })),
  installationJobs: returnBefore.installationJobs.map((row) => ({ ...row, updatedAt: "2020-01-01T00:00:00.000Z" }))
});
assert(state.orders.find((order) => order.id === followUpOrderId)?.status === "cancelled_archived"
  && state.quotations.find((quote) => quote.id === followUpQuote.id)?.status === "follow_up", "Y1: older cloud data must not reverse Return to Follow Up");
await updateQuotationStatus(followUpQuote.id, "won");
const reconfirmed = await convertQuoteToOrder(followUpQuote.id);
assert(reconfirmed.ok && reconfirmed.order.id !== followUpOrderId && reconfirmed.order.orderNo !== followUpOrderNo
  && state.orders.find((order) => order.id === followUpOrderId)?.status === "cancelled_archived", "Y1: later confirmation must create a new active Order with the next unused SO and never restore the archived Order");

resetWorkflowState();
const legacyPaymentOrder = {
  id: "order-payment-ledger",
  orderNo: "SO2607099",
  orderNumber: "SO2607099",
  quoteId: "quote-payment-ledger",
  quotationId: "quote-payment-ledger",
  quoteNumber: "PAYMENT-QUOTE",
  quotationNo: "PAYMENT-QUOTE",
  customer: { name: "Payment Customer", phone: "0129999999" },
  items: [{ id: "payment-item", productName: "Security Screen", quantity: 1, width: 1000, height: 1000 }],
  total: 1000,
  deposit: 100,
  paidAmount: 100,
  amountPaid: 100,
  totalPaid: 100,
  balance: 900,
  status: "Confirmed",
  payments: [{ id: "payment-original-deposit", amount: 100, paymentDate: "2026-06-01", type: "Deposit", method: "Bank Transfer", status: "active", createdAt: "2026-06-01T00:00:00.000Z", createdBy: "Boss Test" }],
  productionJobId: "production-payment-ledger",
  installationJobId: "installation-payment-ledger",
  updatedAt: "2026-07-01T00:00:00.000Z"
};
state.orders = [legacyPaymentOrder];
state.quotations = [{ id: "quote-payment-ledger", orderId: legacyPaymentOrder.id, linkedOrderId: legacyPaymentOrder.id, status: "won", total: 1000 }];
state.productionJobs = [{ id: "production-payment-ledger", orderId: legacyPaymentOrder.id, status: "not_produced" }];
state.installationJobs = [{ id: "installation-payment-ledger", orderId: legacyPaymentOrder.id, status: "not_scheduled" }];
const normalizedLegacy = getOrderPaymentSummary(legacyPaymentOrder);
assert(normalizedLegacy.legacyPaid === 0 && normalizedLegacy.activePaymentTotal === 100 && normalizedLegacy.totalPaid === 100 && normalizedLegacy.balance === 900, "Y2: a legacy deposit mirrored by an active payment record must not be counted twice");
const paymentIdentityBefore = structuredClone({
  orderNo: legacyPaymentOrder.orderNo,
  customer: legacyPaymentOrder.customer,
  items: legacyPaymentOrder.items,
  total: legacyPaymentOrder.total,
  quoteId: legacyPaymentOrder.quoteId,
  productionJobId: legacyPaymentOrder.productionJobId,
  installationJobId: legacyPaymentOrder.installationJobId,
  paidAmount: legacyPaymentOrder.paidAmount,
  amountPaid: legacyPaymentOrder.amountPaid,
  deposit: legacyPaymentOrder.deposit
});
const missedDeposit = await recordOrderPayment({
  orderId: legacyPaymentOrder.id,
  paymentId: "payment-missed-progress",
  amount: 200,
  paymentDate: "2026-05-15",
  type: "Progress Payment",
  method: "Cash",
  referenceNumber: "OLD-CASH-15",
  note: "Forgotten historical payment"
}, { downloadBackup: false });
assert(missedDeposit.ok, "Y2: a missed payment must accept its older actual payment date");
let paymentOrder = state.orders.find((order) => order.id === legacyPaymentOrder.id);
let paymentSummary = getOrderPaymentSummary(paymentOrder);
assert(paymentSummary.totalPaid === 300 && paymentSummary.balance === 700
  && paymentOrder.payments.find((payment) => payment.id === "payment-missed-progress")?.paymentDate === "2026-05-15", "Y2: legacy deposit plus appended payment must calculate totalPaid and balance correctly");
const secondPayment = await recordOrderPayment({
  orderId: legacyPaymentOrder.id,
  paymentId: "payment-second-progress",
  amount: 150,
  paymentDate: "2026-07-10",
  type: "Progress Payment",
  method: "Card",
  referenceNumber: "CARD-150",
  note: "Second payment"
}, { downloadBackup: false });
paymentOrder = state.orders.find((order) => order.id === legacyPaymentOrder.id);
paymentSummary = getOrderPaymentSummary(paymentOrder);
assert(secondPayment.ok && paymentSummary.totalPaid === 450 && paymentSummary.balance === 550, "Y2: multiple active payments must use one normalized totalPaid and balance calculation");
const blockedOverpayment = await recordOrderPayment({
  orderId: legacyPaymentOrder.id,
  paymentId: "payment-blocked-overpay",
  amount: 600,
  paymentDate: "2026-07-11",
  type: "Final Payment",
  method: "Cash"
}, { downloadBackup: false });
assert(!blockedOverpayment.ok && !state.orders.find((order) => order.id === legacyPaymentOrder.id).payments.some((payment) => payment.id === "payment-blocked-overpay"), "Y2: overpayment must be blocked without explicit Boss/Admin confirmation");
const reversedPayment = await reverseOrderPayment({ orderId: legacyPaymentOrder.id, paymentId: "payment-second-progress", reversalReason: "Entered against the wrong receipt" }, { downloadBackup: false });
paymentOrder = state.orders.find((order) => order.id === legacyPaymentOrder.id);
paymentSummary = getOrderPaymentSummary(paymentOrder);
const reversedAudit = paymentOrder.payments.find((payment) => payment.id === "payment-second-progress");
assert(reversedPayment.ok && reversedAudit.status === "reversed" && reversedAudit.reversedAt && reversedAudit.reversedBy && reversedAudit.reversalReason === "Entered against the wrong receipt"
  && paymentSummary.totalPaid === 300 && paymentSummary.balance === 700, "Y2: payment reversal must preserve the original audit record and recalculate balance");
assert(JSON.stringify({
  orderNo: paymentOrder.orderNo,
  customer: paymentOrder.customer,
  items: paymentOrder.items,
  total: paymentOrder.total,
  quoteId: paymentOrder.quoteId,
  productionJobId: paymentOrder.productionJobId,
  installationJobId: paymentOrder.installationJobId,
  paidAmount: paymentOrder.paidAmount,
  amountPaid: paymentOrder.amountPaid,
  deposit: paymentOrder.deposit
}) === JSON.stringify(paymentIdentityBefore), "Y2: payment recording and reversal must not alter SO, customer, items, total, legacy paid fields or relationships");
assert(JSON.parse(localStorage.getItem("ecoScreenV2.orders") || "[]").find((order) => order.id === legacyPaymentOrder.id)?.payments.find((payment) => payment.id === "payment-second-progress")?.status === "reversed", "Y2: Payment History and reversal must survive refresh storage");
applyCloudSnapshot({ orders: [{ ...legacyPaymentOrder, updatedAt: "2020-01-01T00:00:00.000Z" }] });
assert(state.orders.find((order) => order.id === legacyPaymentOrder.id)?.payments.find((payment) => payment.id === "payment-second-progress")?.status === "reversed"
  && getOrderPaymentSummary(state.orders.find((order) => order.id === legacyPaymentOrder.id)).balance === 700, "Y2: older cloud data must not overwrite the payment ledger or reversal");

resetWorkflowState();
state.currentUser = { userId: "boss-test", username: "boss-test", name: "Boss Test", role: "Boss", active: true };
state.role = "Boss";
state.users = [
  state.currentUser,
  { userId: "installer-exact-a", username: "installer-a", name: "Installer A", role: "Installer", active: true },
  { userId: "installer-exact-b", username: "installer-b", name: "Installer B", role: "Installer", active: true },
  { userId: "secretary-test", username: "secretary-test", name: "Secretary Test", role: "Secretary", active: true }
];
const dispatchOrder = {
  id: "order-installation-dispatch",
  orderNo: "SO2607201",
  orderNumber: "SO2607201",
  quoteNumber: "ESQ-DISPATCH-1",
  quotationNo: "ESQ-DISPATCH-1",
  customer: { name: "Dispatch Customer", phone: "0123000000", address: "Dispatch Address" },
  items: [{ id: "dispatch-item", productId: "roller", productName: "Roller", quantity: 1, width: 1000, height: 1200, unitPrice: 100, minimumSqft: 0, warrantyPeriod: "3 years" }],
  total: 500,
  balance: 300,
  status: "Confirmed",
  isArchived: false,
  updatedAt: "2026-07-15T00:00:00.000Z"
};
state.orders = [dispatchOrder];
const pendingInstallation = createInstallationJobFromOrder(dispatchOrder);
state.installationJobs = [pendingInstallation];
assert(pendingInstallation.status === "pending_arrangement" && pendingInstallation.dispatchStatus === "pending", "Z1: a new Installation must default to pending_arrangement and must not auto-dispatch");
assert(installationJobsForUser({ userId: "installer-exact-a", role: "Installer" }).length === 0, "Z1: a pending Installation must be invisible to Installer users");

const arranged = await saveInstallationArrangement(pendingInstallation.id, {
  installationDate: "2026-07-25",
  installationTime: "10:30",
  assignedInstallerId: "installer-exact-a",
  address: "Exact Dispatch Address",
  contactPerson: "Dispatch Contact",
  phone: "0123000000",
  installationRemarks: "Call before arrival",
  requiredItems: "Ladder and fitting kit"
});
assert(arranged.ok && arranged.status === "ready_to_send", "Z2: date plus an exact Installer ID must set ready_to_send");
assert(state.installationJobs[0].assignedInstallerId === "installer-exact-a" && state.installationJobs[0].assignedInstallerName === "Installer A", "Z2: arrangement must store the selected exact staff/user ID and display name");
assert(installationJobsForUser({ userId: "installer-exact-a", role: "Installer" }).length === 0, "Z2: arranging a date and Installer alone must not expose the job");

const sent = await sendInstallationToInstaller(pendingInstallation.id);
assert(sent.ok && state.installationJobs[0].status === "sent_to_installer" && state.installationJobs[0].dispatchStatus === "sent"
  && state.installationJobs[0].sentAt && state.installationJobs[0].sentBy, "Z3: explicit Send to Installer must store dispatch state and audit fields");
assert(installationJobsForUser({ userId: "installer-exact-a", role: "Installer" }).map((job) => job.id).includes(pendingInstallation.id), "Z3: the exact assigned Installer must see the sent job");
assert(installationJobsForUser({ userId: "installer-exact-b", role: "Installer" }).length === 0, "Z3: a different Installer stable ID must not see the sent job");
const firstSentAt = state.installationJobs[0].sentAt;
const recall = await recallInstallationFromInstaller(pendingInstallation.id, "Wrong appointment time");
assert(recall.ok && state.installationJobs[0].status === "pending_arrangement" && state.installationJobs[0].dispatchStatus === "recalled"
  && state.installationJobs[0].recalledAt && state.installationJobs[0].recalledBy && state.installationJobs[0].recallReason === "Wrong appointment time", "Z4: Boss/Admin recall must hide the job and preserve a recall audit");
assert(state.installationJobs[0].assignedInstallerId === "installer-exact-a" && state.installationJobs[0].sentAt === firstSentAt
  && state.installationJobs[0].dispatchHistory.some((event) => event.action === "sent")
  && state.installationJobs[0].dispatchHistory.some((event) => event.action === "recalled"), "Z4: recall must preserve the prior exact assignment and complete dispatch history");
assert(installationJobsForUser({ userId: "installer-exact-a", role: "Installer" }).length === 0, "Z4: a recalled job must disappear from Installer visibility");
state.installationJobs.push({ id: "installation-archived-hidden", orderId: dispatchOrder.id, assignedInstallerId: "installer-exact-a", status: "sent_to_installer", isArchived: true });
state.installationJobs.push({ id: "installation-cancelled-hidden", orderId: dispatchOrder.id, assignedInstallerId: "installer-exact-a", status: "cancelled_archived" });
assert(installationJobsForUser({ userId: "installer-exact-a", role: "Installer" }).length === 0, "Z4: archived and cancelled jobs must remain hidden from Installer users");

const resent = await sendInstallationToInstaller(pendingInstallation.id);
assert(resent.ok, "Z5: editing or recall must not auto-send, but a later explicit send must be allowed");
state.installationJobs = state.installationJobs.map((job) => job.id === pendingInstallation.id ? {
  ...job,
  status: "completed",
  dispatchStatus: "completed",
  completionStatus: "Completed",
  completionOutcome: "installed",
  completionDate: "2026-07-26T14:00",
  completedAt: "2026-07-26T14:00",
  afterPhotos: [{ id: "after-photo", dataUrl: "data:image/png;base64,AA==" }],
  customerSignature: "data:image/png;base64,AA==",
  installerRemark: "Installation completed",
  amountCollected: 300,
  updatedAt: "2026-07-26T14:00:00.000Z"
} : job);
const completedInstallation = state.installationJobs.find((job) => job.id === pendingInstallation.id);
assert(installationJobsForUser({ userId: "installer-exact-a", role: "Installer" }).some((job) => job.id === pendingInstallation.id)
  && completedInstallation.assignedInstallerId === "installer-exact-a"
  && completedInstallation.dispatchHistory.filter((event) => event.action === "sent").length === 2
  && completedInstallation.afterPhotos.length === 1 && completedInstallation.customerSignature && completedInstallation.amountCollected === 300,
"Z5: completed Installation history must retain exact assignment, dispatch history, photos, signature, payment and remarks");
const diagnostics = installationDispatchDiagnostics();
assert(diagnostics.completed === 1 && diagnostics.missingAssignedInstallerId === 0, "Z5: manager diagnostics must count active dispatch states without migrating records");

const incompleteWarrantyJob = createInstallationJobFromOrder(dispatchOrder);
incompleteWarrantyJob.id = "installation-incomplete-warranty";
state.installationJobs.push(incompleteWarrantyJob);
const incompleteWarranty = await generateWarrantyCard(incompleteWarrantyJob.id);
assert(!incompleteWarranty.ok && incompleteWarranty.message.includes("Complete the Installation"), "Z6: incomplete Installation must show a clear Warranty validation error");
state.currentUser = state.users.find((user) => user.userId === "secretary-test");
state.role = "Secretary";
let popupAttempts = 0;
const previousWindowOpen = window.open;
window.open = () => { popupAttempts += 1; return null; };
const warrantyGenerated = await generateWarrantyCard(completedInstallation.id);
window.open = previousWindowOpen;
assert(warrantyGenerated.ok && warrantyGenerated.card && warrantyGenerated.card.status === "active", "Z7: Boss/Admin/Secretary must be able to generate a Warranty Card from a completed Installation");
assert(warrantyGenerated.card.orderId === dispatchOrder.id && warrantyGenerated.card.installationId === completedInstallation.id, "Z7: Warranty Card must use the exact linked Order and Installation stable IDs");
assert(/^WC-\d{4}-\d{4}$/.test(warrantyGenerated.card.warrantyCardNo)
  && warrantyGenerated.card.customerName === "Dispatch Customer"
  && warrantyGenerated.card.customerPhone === "0123000000"
  && warrantyGenerated.card.address === "Exact Dispatch Address"
  && warrantyGenerated.card.orderNo === "SO2607201"
  && warrantyGenerated.card.quotationNo === "ESQ-DISPATCH-1"
  && warrantyGenerated.card.warrantyItems[0].warrantyPeriod === "3 years"
  && warrantyGenerated.card.warrantyStartDate === "2026-07-26"
  && warrantyGenerated.card.warrantyExpiryDate === "2029-07-26"
  && warrantyGenerated.card.generatedBy === "Secretary Test", "Z7: Warranty Card must include the required customer, workflow, product, period and audit fields");
const visibleWarranty = warrantyGenerated.previewHtml;
assert(visibleWarranty.includes("Eco Screen") && visibleWarranty.includes("0195763499")
  && visibleWarranty.includes("Download / Print Warranty Card") && visibleWarranty.includes("mobile browser blocks new tabs")
  && popupAttempts === 0, "Z7: generation must visibly return an inline mobile-safe preview and must not depend on a popup");
assert(warrantyCardPreviewHtml(warrantyGenerated.card).includes(warrantyGenerated.card.warrantyCardNo), "Z7: saved Warranty Card must remain printable by its exact stable ID");
const warrantyCount = state.warrantyCards.length;
const reusedWarranty = await generateWarrantyCard(completedInstallation.id);
assert(reusedWarranty.ok && reusedWarranty.reused && state.warrantyCards.length === warrantyCount
  && reusedWarranty.card.id === warrantyGenerated.card.id, "Z8: an existing exact-Installation Warranty must be reused instead of duplicated");
const originalWarrantyNo = warrantyGenerated.card.warrantyCardNo;
const regeneratedWarranty = await generateWarrantyCard(completedInstallation.id, { regenerate: true });
assert(regeneratedWarranty.ok && regeneratedWarranty.regenerated && state.warrantyCards.length === warrantyCount
  && regeneratedWarranty.card.warrantyCardNo === originalWarrantyNo
  && regeneratedWarranty.card.auditHistory.some((event) => event.action === "regenerated"), "Z8: regeneration must preserve the Warranty Card number and append audit history");
const nextWarrantyNo = nextWarrantyCardNumber(new Date());
assert(/^WC-\d{4}-\d{4}$/.test(nextWarrantyNo) && nextWarrantyNo !== originalWarrantyNo, "Z8: new Warranty Card numbers must be readable and unique");

state.currentUser = { userId: "boss-count-test", username: "boss-count-test", name: "Boss Count Test", role: "Boss", active: true };
state.role = "Boss";
state.installationJobs = [];
const countActiveOrders = Array.from({ length: 15 }, (_, index) => ({
  id: `count-order-${index + 1}`,
  orderNo: `SO-COUNT-${index + 1}`,
  orderNumber: `SO-COUNT-${index + 1}`,
  status: index < 8 ? (index % 2 ? " Pending " : "Confirmed") : (["Sent to Production", " sent-to-production ", "IN PRODUCTION"][index % 3]),
  sentToProduction: index >= 8,
  customer: { name: `Count Customer ${index + 1}`, phone: `01000000${index + 1}` },
  total: 1000,
  deposit: 100,
  items: [{ productName: "Count Product", quantity: 1 }],
  createdAt: `2026-07-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
  updatedAt: `2026-07-${String(index + 1).padStart(2, "0")}T01:00:00.000Z`
}));
const countArchivedOrders = Array.from({ length: 11 }, (_, index) => ({
  id: `archived-count-order-${index + 1}`,
  orderNo: `SO-ARCHIVED-${index + 1}`,
  status: index % 3 === 0 ? "cancelled_archived" : index % 3 === 1 ? " Duplicate-Archived " : "CANCELED",
  isArchived: index % 3 !== 2,
  updatedAt: `2026-06-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`
}));
state.orders = [...countActiveOrders, ...countArchivedOrders];
state.productionJobs = countActiveOrders.slice(8).map((order, index) => ({
  id: `count-order-production-${index + 1}`,
  orderId: order.id,
  status: ["In Production", "in-production", "sent_to_production"][index % 3],
  updatedAt: `2026-07-${String(index + 9).padStart(2, "0")}T02:00:00.000Z`
}));
assert(state.orders.length === 26 && uniqueActiveOrders(state.orders).length === 15,
  "AA1: 15 active plus 11 archived Orders must produce an active Dashboard count of 15, not the raw stored count of 26");
assert(!isActiveOrderRecord({ id: "archive-alias", status: " CANCELLED-ARCHIVED " })
  && normalizeWorkflowStatus(" Sent-to Production ") === "sent_to_production",
"AA1: workflow status normalization must ignore trim, capitalization, spaces and hyphens");
const duplicateActiveOrder = { ...countActiveOrders[0], customer: { name: "Older duplicate payload" }, updatedAt: "2026-01-01T00:00:00.000Z" };
assert(uniqueActiveOrders([...state.orders, duplicateActiveOrder]).length === 15
  && uniqueActiveOrders([...state.orders, duplicateActiveOrder]).find((order) => order.id === countActiveOrders[0].id).customer.name === "Count Customer 1",
"AA1: stable-ID duplicates must collapse to the latest active Order without double-counting");
setOrderNavigationFilter("pending");
assert(ordersForDisplay().length === 8 && workflowNavigationState().orders.filter === "pending", "AA2: the retained Pending category must narrow the Orders list before navigation reset");
resetWorkflowNavigationState("orders");
assert(ordersForDisplay().length === 15
  && workflowNavigationState().orders.filter === "all"
  && workflowNavigationState().orders.orderNumber === ""
  && workflowNavigationState().orders.customerName === ""
  && workflowNavigationState().orders.phone === ""
  && workflowNavigationState().orders.status === ""
  && workflowNavigationState().orders.installationDate === ""
  && workflowNavigationState().orders.page === 1,
"AA2: entering Orders must clear retained searches/status/date, select All and reset pagination");
setOrderNavigationFilter("production");
assert(ordersForDisplay().length === 7, "AA2: Orders category buttons must continue to filter after the navigation reset");
resetWorkflowNavigationState("orders");

const completedCountOrder = {
  ...countActiveOrders[0],
  id: "count-order-completed",
  orderNo: "SO-COUNT-COMPLETED",
  orderNumber: "SO-COUNT-COMPLETED",
  status: " completed ",
  updatedAt: "2026-07-30T00:00:00.000Z"
};
state.orders = [...countActiveOrders, completedCountOrder, ...countArchivedOrders];
setOrderNavigationFilter("completed");
assert(ordersForDisplay().some((order) => order.id === completedCountOrder.id)
  && uniqueActiveOrders(state.orders).some((order) => order.id === completedCountOrder.id),
"AA3: completed Orders must remain active and available in the separate Completed category");

state.orders = countActiveOrders;
const productionAliases = ["not_produced", "Not Produced", "pending", "Pending Production", "ready", "not-started", "in_production", "In Production", "Sent to Production", "sent-to-production", "completed", " Production Completed "];
const countActiveProduction = productionAliases.map((status, index) => ({
  id: `count-production-${index + 1}`,
  orderId: countActiveOrders[index % countActiveOrders.length].id,
  status,
  customerName: `Production Customer ${index + 1}`,
  updatedAt: `2026-07-${String(index + 1).padStart(2, "0")}T03:00:00.000Z`
}));
const countArchivedProduction = [
  { id: "count-production-archived-1", status: "duplicate_archived", isArchived: true },
  { id: "count-production-archived-2", status: " Cancelled-Archived " },
  { id: "count-production-archived-3", status: "CANCELED", isArchived: true }
];
state.productionJobs = [...countActiveProduction, ...countArchivedProduction];
assert(state.productionJobs.length === 15
  && uniqueActiveProductionJobs(state.productionJobs).length === 12
  && productionJobsForDisplay(state.productionJobs, false).length === 12,
"AA4: the normal Production list must show all 12 unique active jobs and hide all 3 archived/cancelled jobs");
assert(normalizeProductionStatus(" In-Production ") === "in_production"
  && normalizeProductionStatus(" Sent to Production ") === "in_production"
  && normalizeProductionStatus("READY") === "not_produced"
  && normalizeProductionStatus(" completed ") === "completed"
  && uniqueActiveProductionJobs(state.productionJobs).some((job) => normalizeProductionStatus(job.status) === "completed"),
"AA4: Production aliases must normalize for labels/categories without hiding active or completed jobs");
const olderProductionDuplicate = { ...countActiveProduction[0], status: "pending", updatedAt: "2026-01-01T00:00:00.000Z" };
assert(uniqueActiveProductionJobs([...state.productionJobs, olderProductionDuplicate]).length === 12,
  "AA4: duplicate Production stable IDs must not increase the active list count");
setProductionNavigationState({ search: "no-production-record-matches-this", showArchived: true });
assert(workflowNavigationState().production.search && workflowNavigationState().production.showArchived,
  "AA5: retained Production search and archived-only mode must be represented before navigation reset");
resetWorkflowNavigationState("production");
assert(workflowNavigationState().production.search === ""
  && workflowNavigationState().production.showArchived === false
  && productionJobsForCurrentView().length === 12,
"AA5: entering Production must clear text search, disable archived-only mode and restore the full unique active list");

resetWorkflowState();
state.currentUser = { userId: "boss-dispatch-test", username: "boss-dispatch-test", name: "Boss Dispatch Test", role: "Boss", active: true };
state.role = "Boss";
const dispatchOrders = Array.from({ length: 19 }, (_, index) => ({
  id: `dispatch-order-${index + 1}`,
  orderNo: `SO-DISPATCH-${index + 1}`,
  orderNumber: `SO-DISPATCH-${index + 1}`,
  customer: { name: index === 0 ? "Waiting Customer" : `Dispatched Customer ${index + 1}` },
  status: index === 0 || index >= 14 ? "Confirmed" : "Sent to Production",
  sentToProduction: index > 0 && index < 14,
  productionStatus: "not_produced",
  items: [{ productName: "Dispatch Product", quantity: 1 }],
  updatedAt: `2026-07-${String(index + 1).padStart(2, "0")}T01:00:00.000Z`
}));
const dispatchProductionJobs = dispatchOrders.slice(1).map((order, index) => ({
  id: `dispatch-production-${index + 1}`,
  orderId: order.id,
  orderNo: order.orderNo,
  status: index < 8 ? "not_produced" : "in_production",
  updatedAt: `2026-07-${String(index + 2).padStart(2, "0")}T02:00:00.000Z`
}));
dispatchOrders.slice(1, 7).forEach((order, index) => {
  order.productionJobId = dispatchProductionJobs[index].id;
  order.productionStatus = dispatchProductionJobs[index].status;
});
dispatchOrders.slice(7, 14).forEach((order, index) => {
  order.productionStatus = dispatchProductionJobs[index + 6].status;
});
dispatchOrders[18].productionJobId = dispatchProductionJobs[17].id;
state.orders = dispatchOrders;
state.productionJobs = dispatchProductionJobs;

assert(getOrderDispatchState(dispatchOrders[0]) === "waiting-to-send"
  && getOrderDispatchState(dispatchOrders[1]) === "sent-to-production"
  && getOrderDispatchState({ ...dispatchOrders[1], productionStatus: "not_produced" }) === "sent-to-production",
"AC1: Order dispatch state must remain separate from the Production Job work stage");
const dispatchStageCounts = productionWorkStageCounts();
assert(dispatchStageCounts.not_produced === 8 && dispatchStageCounts.in_production === 10 && dispatchStageCounts.completed === 0,
  "AC1: Production page stages must independently report 8 Not Produced and 10 In Production");
const initialDispatchScan = scanProductionDispatchIntegrity();
assert(initialDispatchScan.counts.Correct === 7
  && initialDispatchScan.counts["Missing forward productionJobId"] === 7
  && initialDispatchScan.counts["Production Job exists but Order dispatch fields are stale"] === 5
  && initialDispatchScan.repairableCount === 12,
"AC2: dispatch integrity scan must classify exact one-to-one relationships without matching by SO or customer");

const ambiguousOrderId = dispatchOrders[14].id;
const ambiguousDuplicateJob = { ...dispatchProductionJobs[13], id: "dispatch-production-ambiguous-duplicate" };
state.productionJobs.push(ambiguousDuplicateJob);
const ambiguousScan = scanProductionDispatchIntegrity();
assert(ambiguousScan.entries.find((entry) => entry.orderId === ambiguousOrderId)?.classification === "Multiple active Production Jobs",
  "AC2: multiple exact active Production Jobs must be classified as ambiguous");
const ordersBeforeAmbiguousRepair = JSON.stringify(state.orders);
const ambiguousRepair = await repairProductionDispatchIntegrity({ orderIds: [ambiguousOrderId] }, { confirm: false, downloadBackup: false });
assert(!ambiguousRepair.ok && JSON.stringify(state.orders) === ordersBeforeAmbiguousRepair,
  "AC2: ambiguous multiple active Jobs must block repair without changing Orders");
state.productionJobs = state.productionJobs.filter((job) => job.id !== ambiguousDuplicateJob.id);

const repairableDispatchIds = scanProductionDispatchIntegrity().entries.filter((entry) => entry.repairable).map((entry) => entry.orderId);
const productionSnapshotBeforeDispatchRepair = JSON.stringify(state.productionJobs);
const dispatchRepair = await repairProductionDispatchIntegrity({ orderIds: repairableDispatchIds }, { confirm: false, downloadBackup: false });
const repairedDispatchOrders = uniqueActiveOrders(state.orders);
assert(dispatchRepair.ok
  && repairedDispatchOrders.filter((order) => getOrderDispatchState(order) === "waiting-to-send").length === 1
  && repairedDispatchOrders.filter((order) => getOrderDispatchState(order) === "sent-to-production").length === 18,
"AC3: 19 active Orders with 18 explicitly repaired dispatch records must produce 1 Waiting and 18 Sent");
assert(repairableDispatchIds.every((orderId) => {
  const order = state.orders.find((row) => row.id === orderId);
  const exactJob = state.productionJobs.find((job) => job.orderId === orderId);
  return order.productionJobId === exactJob.id
    && order.status === "Sent to Production"
    && order.sentToProduction === true
    && order.productionStatus === normalizeProductionStatus(exactJob.status)
    && !order.sentToProductionAt;
}), "AC3: repair must use exact orderId, update only dispatch fields and never invent historical sentToProductionAt");
assert(JSON.stringify(state.productionJobs) === productionSnapshotBeforeDispatchRepair
  && state.productionJobs.length === 18
  && productionWorkStageCounts().not_produced === 8
  && productionWorkStageCounts().in_production === 10,
"AC3: one-time repair must not create, delete, archive or change any Production Job stage");
const persistedDispatchOrders = JSON.parse(localStorage.getItem("ecoScreenV2.orders") || "[]");
assert(persistedDispatchOrders.filter((order) => getOrderDispatchState(order) === "sent-to-production").length === 18,
  "AC3: repaired dispatch state must survive storage refresh");

state.language = "en";
assert(t("Waiting to Send") === "Waiting to Send" && t("Sent to Production") === "Sent to Production" && statusLabel("not_produced") === "Not Produced",
  "AC4: English dispatch and Production work-stage labels must remain separate");
state.language = "zh";
assert(t("Waiting to Send") === "等待发送" && t("Sent to Production") === "已发送生产" && statusLabel("not_produced") === "未开始生产",
  "AC4: Chinese dispatch and Production work-stage labels must remain language-consistent");
state.language = "en";

assert(JSON.stringify(OPENING_DIRECTION_VALUES) === JSON.stringify(["close_left", "close_right", "close_down"]),
  "AB1: Opening Direction must expose only the three stable canonical values");
assert(JSON.stringify(COLOR_VALUES) === JSON.stringify(["white", "grey"]),
  "AB1: Color must expose only white and grey as stable canonical values");
assert(normalizeOpeningDirection("Left") === "close_left"
  && normalizeOpeningDirection("Right Close") === "close_right"
  && normalizeOpeningDirection("Bottom") === "close_down"
  && normalizeOpeningDirection("左") === "close_left"
  && normalizeOpeningDirection("右") === "close_right"
  && normalizeOpeningDirection("下") === "close_down",
"AB1: known legacy Opening Direction aliases must normalize safely without rewriting records");
assert(normalizeColor("White") === "white"
  && normalizeColor("GRAY") === "grey"
  && normalizeColor("白色") === "white"
  && normalizeColor("灰") === "grey",
"AB1: known legacy Color aliases must normalize safely");
assert(normalizeColor("Bronze") === "Bronze" && normalizeOpeningDirection("Diagonal") === "Diagonal",
  "AB1: unknown legacy selections must remain preserved rather than being discarded");
const newCanonicalItem = makeQuoteItem();
assert(newCanonicalItem.color === "white" && newCanonicalItem.openingDirection === "close_left" && !("handlePosition" in newCanonicalItem),
  "AB1: new Quotation items must use canonical defaults and must not create Handle Position");

state.language = "en";
assert(openingDirectionLabel("close_left") === "Close Left"
  && openingDirectionLabel("close_right") === "Close Right"
  && openingDirectionLabel("close_down") === "Close Down"
  && colorLabel("white") === "White"
  && colorLabel("grey") === "Grey",
"AB1: English canonical labels must be consistent");
state.language = "zh";
assert(openingDirectionLabel("close_left") === "左关"
  && openingDirectionLabel("close_right") === "右关"
  && openingDirectionLabel("close_down") === "下关"
  && colorLabel("white") === "白色"
  && colorLabel("grey") === "灰色"
  && statusLabel("follow_up") === "跟进",
"AB1: Chinese canonical labels must be consistent");
assert(openingDirectionLabel("Diagonal") === "旧值: Diagonal" && colorLabel("Bronze") === "旧值: Bronze",
  "AB1: unknown legacy values must remain visible with a localized legacy marker");
state.language = "en";

const productionPrintOrder = {
  id: "order-production-print-exact",
  orderNo: "SO2607999",
  orderNumber: "SO2607999",
  quoteNumber: "ESQ-2026-PRINT",
  quotationNo: "ESQ-2026-PRINT",
  customer: { name: "Print & Customer", phone: "0123456789" },
  installationDate: "2026-07-30",
  items: []
};
const productionPrintItems = Array.from({ length: 3 }, (_, index) => ({
  productName: index === 0 ? "Sliding Security Mesh Door with an intentionally long printable product description" : `Production Product ${index + 1}`,
  installationLocation: index === 0 ? "Living room opening beside the main entrance with long wrapping text" : `Room ${index + 1}`,
  width: 1234 + index,
  height: 2345 + index,
  quantity: index + 1,
  color: "Custom Grey",
  installType: "Outside install",
  openingDirection: "Sliding Right",
  trackSize: "3650",
  handleHeight: "1100",
  handlePosition: "Right",
  trackType: "Double Track",
  meshType: "1.0 Stainless Steel Net",
  lockType: index === 0 ? "Key Lock" : "-",
  remark: index === 0 ? "Long remark must wrap safely without overlap & must not become HTML <script>" : `Remark ${index + 1}`
}));
const productionPrintJob = {
  id: "production-print-exact",
  orderId: productionPrintOrder.id,
  quoteNumber: productionPrintOrder.quoteNumber,
  installationDate: productionPrintOrder.installationDate,
  status: "in_production",
  remark: "Check all dimensions before production.",
  items: productionPrintItems
};
const productionPrintHtml = productionSheetPrintHtml(productionPrintJob, productionPrintOrder, {
  companyName: "Eco Screen Sdn Bhd",
  companyPhone: "0195763499"
});
assert(productionPrintHtml.includes('class="production-sheet"')
  && productionPrintHtml.includes('data-production-job-id="production-print-exact"')
  && productionPrintHtml.includes('data-order-id="order-production-print-exact"'),
"AB1: Production Sheet must be a dedicated print container tied to exact Production Job and Order stable IDs");
assert(productionPrintHtml.includes("Order No: SO2607999")
  && productionPrintHtml.includes("Print &amp; Customer")
  && productionPrintHtml.includes("ESQ-2026-PRINT")
  && productionPrintHtml.includes("2026-07-30")
  && productionPrintHtml.includes("In Production"),
"AB1: Production Sheet must print the exact SO, customer, quotation, installation date and production status");
assert((productionPrintHtml.match(/data-production-item-row/g) || []).length === 3
  && productionPrintHtml.includes(">Product</th>")
  && productionPrintHtml.includes(">Installation Location</th>")
  && productionPrintHtml.includes(">Lock</th>")
  && productionPrintHtml.includes("Key Lock"),
"AB2: English Production Sheet must render every stored product row using English-only headings");
assert(productionPrintHtml.includes("Long remark must wrap safely without overlap &amp; must not become HTML &lt;script&gt;")
  && productionPrintHtml.includes("Production Remark")
  && productionPrintHtml.includes("Prepared by")
  && productionPrintHtml.includes("Checked by")
  && !productionPrintHtml.includes("Handle Position")
  && !productionPrintHtml.includes("把手位置")
  && !productionPrintHtml.includes(" / Product")
  && !productionPrintHtml.includes("moduleNavigation")
  && !productionPrintHtml.includes("Sync Now")
  && !productionPrintHtml.includes("<button"),
"AB2: printable content must safely wrap long text, retain the footer and exclude CRM controls");
const productionPrintCss = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
assert(productionPrintCss.includes("@page production-sheet")
  && productionPrintCss.includes("size: A4 portrait")
  && productionPrintCss.includes("margin: 10mm")
  && productionPrintCss.includes("body.production-sheet-print-mode #app > :not(#workflowPrintArea)"),
"AB3: Production printing must use a named A4 portrait page and isolate the dedicated sheet from the CRM application");
assert(productionPrintCss.includes("table-layout: fixed !important")
  && productionPrintCss.includes("overflow-wrap: anywhere")
  && productionPrintCss.includes("page-break-inside: avoid")
  && productionPrintCss.includes(".production-col-remark { width: 21mm; }")
  && !productionPrintCss.includes(".production-col-handle-position")
  && productionPrintCss.includes(".production-sheet-footer"),
"AB3: Production print CSS must fill the printable width, wrap long cells, keep rows intact and retain the signature footer");

state.language = "zh";
const chineseProductionPrintHtml = productionSheetPrintHtml(productionPrintJob, productionPrintOrder, {
  companyName: "Eco Screen Sdn Bhd",
  companyPhone: "0195763499"
});
assert(chineseProductionPrintHtml.includes(">生产单<")
  && chineseProductionPrintHtml.includes(">产品</th>")
  && chineseProductionPrintHtml.includes(">安装位置</th>")
  && chineseProductionPrintHtml.includes(">左关</td>") === false
  && chineseProductionPrintHtml.includes(">旧值: Sliding Right</td>")
  && chineseProductionPrintHtml.includes("制单人")
  && chineseProductionPrintHtml.includes("审核人")
  && !chineseProductionPrintHtml.includes("Production Sheet")
  && !chineseProductionPrintHtml.includes("Customer Name")
  && !chineseProductionPrintHtml.includes("Prepared by"),
"AB4: Chinese Production Sheet must use Chinese-only interface headings while preserving unknown legacy item values");

const languageQuote = makeQuote();
const languageQuoteItem = makeQuoteItem();
Object.assign(languageQuoteItem, {
  productName: "Manual Product Name",
  width: "1000",
  height: "1200",
  quantity: "1",
  unitPrice: 100,
  color: "grey",
  openingDirection: "close_down",
  handlePosition: "Right",
  installationLocation: "Customer Entered Location"
});
languageQuote.quoteNumber = "ESQ-LANGUAGE-TEST";
languageQuote.customer = { name: "Customer Entered Name", phone: "0123456789", area: "Customer Entered Area", address: "Customer Entered Address", remark: "" };
languageQuote.items = [languageQuoteItem];
languageQuote.status = "quoted";
state.language = "en";
const englishQuotePrintHtml = quoteDocumentHtml(languageQuote);
const convertedLanguageOrder = createOrderFromQuote(languageQuote, {
  id: "order-language-preservation-test",
  orderNo: "SO-LANGUAGE-TEST"
});
assert(englishQuotePrintHtml.includes("Website: www.ecosecurityscreens.com")
  && englishQuotePrintHtml.includes("Close Down")
  && englishQuotePrintHtml.includes("Grey")
  && !englishQuotePrintHtml.includes("Handle Position")
  && languageQuoteItem.handlePosition === "Right"
  && convertedLanguageOrder.items[0].handlePosition === "Right",
"AB5: English Quotation output must include the website and canonical labels while preserving hidden legacy Handle Position data");
state.language = "zh";
const chineseQuotePrintHtml = quoteDocumentHtml(languageQuote);
assert(chineseQuotePrintHtml.includes("网站: www.ecosecurityscreens.com")
  && chineseQuotePrintHtml.includes("下关")
  && chineseQuotePrintHtml.includes("灰色")
  && chineseQuotePrintHtml.includes("条款与条件")
  && !chineseQuotePrintHtml.includes("BILL TO")
  && !chineseQuotePrintHtml.includes("JOB DETAILS")
  && !chineseQuotePrintHtml.includes("Terms &amp; Conditions")
  && !chineseQuotePrintHtml.includes("Handle Position"),
"AB5: Chinese Quotation output must use Chinese-only interface headings and omit Handle Position");

resetWorkflowState();
state.language = "en";
state.currentUser = { userId: "secretary-duplicate-test", username: "secretary-duplicate-test", name: "Secretary Test", role: "Secretary", active: true };
state.role = "Secretary";
const duplicateSource = validQuote("ESQ-2026-0041", "Duplicate Source Customer");
Object.assign(duplicateSource, {
  id: "quote-duplicate-source",
  projectName: "Original Project",
  siteAddress: "Original Site Address",
  status: "won",
  workflowStatus: "won",
  orderId: "order-source-link",
  linkedOrderId: "order-source-link",
  orderNo: "SO2607041",
  orderNumber: "SO2607041",
  converted: true,
  convertedToOrder: true,
  convertedAt: "2026-07-01T00:00:00.000Z",
  payments: [{ id: "source-payment", amount: 500 }],
  deposit: 500,
  productionJobId: "production-source-link",
  installationJobId: "installation-source-link",
  warrantyCardId: "warranty-source-link",
  collectionRecords: [{ id: "collection-source" }],
  taxEnabled: true,
  taxRate: 8,
  salesperson: { id: "salesperson-source", name: "Sales Person" },
  updatedAt: "2026-07-01T00:00:00.000Z"
});
duplicateSource.customer.email = "customer@example.com";
duplicateSource.customer.company = "Customer Company";
duplicateSource.items[0].measurements = { width: 1000, height: 1200 };
duplicateSource.items[0].unitPrice = "125.50";
duplicateSource.items[0].discount = 5;
const aliasNumberQuote = { id: "quote-number-alias", quotationNo: "ESQ-2026-0042", status: "quoted", updatedAt: "2026-07-01T00:00:00.000Z" };
state.quotations = [duplicateSource, aliasNumberQuote];
assert(nextQuoteNumber(state.quotations, new Date("2026-07-17T00:00:00.000Z")) === "ESQ-2026-0043", "AC1: ESQ generation must include quoteNumber, quotationNo and quoteNo aliases and return the next unused number");
const duplicateSourceBefore = JSON.stringify(duplicateSource);
const duplicatedResult = await duplicateQuotation(duplicateSource.id, {
  customerName: "Duplicate Source Customer",
  phone: "0123456789",
  projectName: "Second Location Project",
  siteAddress: "Second Location Address",
  copyItems: true,
  copyPrices: true,
  copyRemarks: true
}, {
  now: "2026-07-17T09:30:00.000Z",
  idFactory: () => "quote-duplicate-created",
  syncCloud: async () => ({ ok: false, reason: "Local Mode Only" })
});
assert(duplicatedResult.ok && duplicatedResult.localOnly, "AC2: Secretary must be able to save a duplicate locally before cloud sync");
const duplicatedQuote = state.quotations.find((quote) => quote.id === "quote-duplicate-created");
assert(JSON.stringify(state.quotations.find((quote) => quote.id === duplicateSource.id)) === duplicateSourceBefore, "AC2: duplicating must leave the exact source Quotation unchanged");
assert(duplicatedQuote.quoteNumber === "ESQ-2026-0043" && duplicatedQuote.quotationNo === "ESQ-2026-0043" && duplicatedQuote.quoteNo === "ESQ-2026-0043", "AC2: duplicate must receive a new unique ESQ number across every quotation-number alias");
assert(duplicatedQuote.id !== duplicateSource.id && duplicatedQuote.createdAt === "2026-07-17T09:30:00.000Z" && duplicatedQuote.updatedAt === duplicatedQuote.createdAt
  && duplicatedQuote.createdBy === "Secretary Test", "AC2: duplicate must receive a new stable ID and exact creation audit fields");
assert(duplicatedQuote.status === "quoted" && duplicatedQuote.workflowStatus === "quoted" && quotationsForTab("quoted").some((quote) => quote.id === duplicatedQuote.id), "AC2: duplicate must start as a separate Quoted record");
assert(quotationProjectName(duplicatedQuote) === "Second Location Project" && duplicatedQuote.siteAddress === "Second Location Address"
  && duplicatedQuote.customer.address === "Second Location Address", "AC3: project name and site address must be independently editable per Quotation");
assert(duplicatedQuote.customer.email === "customer@example.com" && duplicatedQuote.customer.company === "Customer Company"
  && duplicatedQuote.items.length === 1 && duplicatedQuote.items[0].id !== duplicateSource.items[0].id
  && duplicatedQuote.items[0].unitPrice === "125.50" && duplicatedQuote.discount === 25
  && duplicatedQuote.taxEnabled === true && duplicatedQuote.taxRate === 8
  && duplicatedQuote.remark === "Quotation remark" && duplicatedQuote.salesperson.id === "salesperson-source", "AC3: selected customer, items, measurements, prices, tax, remarks and salesperson fields must copy into independent objects");
assert(!("orderId" in duplicatedQuote) && !("linkedOrderId" in duplicatedQuote) && !("orderNo" in duplicatedQuote) && !("orderNumber" in duplicatedQuote)
  && !("converted" in duplicatedQuote) && !("convertedToOrder" in duplicatedQuote) && !("convertedAt" in duplicatedQuote)
  && !("payments" in duplicatedQuote) && duplicatedQuote.deposit === 0 && !("productionJobId" in duplicatedQuote)
  && !("installationJobId" in duplicatedQuote) && !("warrantyCardId" in duplicatedQuote) && !("collectionRecords" in duplicatedQuote),
"AC4: Order, conversion, payment, deposit, Production, Installation, Warranty and collection fields must never copy");
assert(duplicatedQuote.duplicatedFromQuotationId === duplicateSource.id && duplicatedQuote.duplicatedFromQuotationNo === "ESQ-2026-0041", "AC4: duplicate audit fields must identify the exact source stable ID and ESQ number");
const persistedDuplicateQuotes = JSON.parse(localStorage.getItem("ecoScreenV2.quotations") || "[]");
assert(persistedDuplicateQuotes.some((quote) => quote.id === duplicateSource.id) && persistedDuplicateQuotes.some((quote) => quote.id === duplicatedQuote.id), "AC5: refresh storage must preserve both the original and duplicate Quotations");
applyCloudSnapshot({ quotations: [{ ...duplicateSource, updatedAt: "2020-01-01T00:00:00.000Z" }] });
assert(state.quotations.some((quote) => quote.id === duplicateSource.id) && state.quotations.some((quote) => quote.id === duplicatedQuote.id), "AC5: an older cloud roundtrip must preserve both Quotations");
duplicatedQuote.items[0].width = "777";
assert(duplicateSource.items[0].width === "1000", "AC6: editing a duplicated item must never mutate the source item object");
const duplicatePrintHtml = quoteDocumentHtml(duplicatedQuote);
assert(duplicatePrintHtml.includes("Location / Project Name") && duplicatePrintHtml.includes("Second Location Project")
  && duplicatePrintHtml.includes("Site Address") && duplicatePrintHtml.includes("Second Location Address"), "AC6: Quotation preview and print must visibly include project name and site address");
const duplicateWon = await updateQuotationStatus(duplicatedQuote.id, "won");
assert(duplicateWon.ok, "AC7: duplicated Quotation must remain independently editable");
const duplicateConversion = await convertQuoteToOrder(duplicatedQuote.id);
assert(duplicateConversion.ok && state.orders.some((order) => order.quoteId === duplicatedQuote.id), "AC7: duplicated Quotation must convert through its own exact stable ID");
assert(JSON.stringify(state.quotations.find((quote) => quote.id === duplicateSource.id)) === duplicateSourceBefore, "AC7: converting the duplicate must not change the original Quotation");

const noCopyDuplicate = buildDuplicateQuotation(duplicateSource, {
  projectName: "Blank Copy Project",
  siteAddress: "Blank Copy Address",
  copyItems: false,
  copyPrices: false,
  copyRemarks: false
}, {
  now: "2026-07-17T10:00:00.000Z",
  quoteNumber: "ESQ-2026-0099",
  idFactory: () => "quote-no-copy",
  existingQuotations: state.quotations
});
assert(noCopyDuplicate.items.length === 0 && noCopyDuplicate.discount === 0 && noCopyDuplicate.deposit === 0 && noCopyDuplicate.remark === ""
  && noCopyDuplicate.customer.remark === "" && !("taxEnabled" in noCopyDuplicate), "AC8: unchecked copy options must omit items, prices, tax and remarks");
const beforeRollback = JSON.stringify(state.quotations);
const rollbackResult = await duplicateQuotation(duplicateSource.id, {}, {
  quoteNumber: "ESQ-2026-0100",
  idFactory: () => "quote-local-save-failure",
  saveLocal: () => ({ ok: false, reason: "Simulated local storage failure" }),
  syncCloud: async () => { throw new Error("Cloud must not run after local failure"); }
});
assert(!rollbackResult.ok && JSON.stringify(state.quotations) === beforeRollback, "AC8: local save failure must roll back the complete duplicate transaction before cloud sync");

const quotationSource = await readFile(new URL("../src/quotations.js", import.meta.url), "utf8");
assert(quotationSource.includes("canonicalSelectOptions(COLOR_VALUES")
  && quotationSource.includes("canonicalSelectOptions(OPENING_DIRECTION_VALUES")
  && !quotationSource.includes('data-field="handlePosition"')
  && !quotationSource.includes('fieldSelect(t("Handle Position")'),
"AB6: active Quotation forms must use canonical dropdowns and must not render Handle Position");
const translationSourceUrls = [
  "../src/ads.js",
  "../src/auth.js",
  "../src/main.js",
  "../src/products.js",
  "../src/quotations.js",
  "../src/workflow.js"
];
const visibleTranslationKeys = [];
for (const sourceUrl of translationSourceUrls) {
  const source = await readFile(new URL(sourceUrl, import.meta.url), "utf8");
  for (const match of source.matchAll(/(?<![A-Za-z0-9_.])t\("([^"]+)"\)/g)) visibleTranslationKeys.push(match[1]);
}
assert(missingChineseTranslations(visibleTranslationKeys).length === 0,
  `AB6: every literal visible t() key must have a Chinese translation: ${missingChineseTranslations(visibleTranslationKeys).join(", ")}`);
assert(missingChineseTranslations(["Cloud Checked (read-only)"]).length === 0,
  "AB6: dynamic read-only cloud status must have a Chinese translation");
state.language = "en";

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
  ,"Safe Order Ownership Repair, exact-ID conflict renumbering and cloud-roundtrip protection: passed"
  ,"Reusable Covered Order recovery for Tze Yee and Datin Conni, exact-ID archive and safety stops: passed"
  ,"Missing confirmed Order recovery, exact quotation snapshot creation and explicit conflict handling: passed"
  ,"Transactional Send to Production and Production/Order status synchronization: passed"
  ,"Boss/Admin Return to Follow Up exact-link archive, financial preservation and later reconversion: passed"
  ,"Normalized legacy payment ledger, historical payment entry, reversal and stale-cloud protection: passed"
  ,"Installation pending/ready/send/recall/completed exact-ID dispatch control: passed"
  ,"Warranty validation, exact links, unique numbering, reuse, regeneration and mobile preview: passed"
  ,"Unique active Dashboard counts, Orders navigation reset and category filters: passed"
  ,"Unique active Production visibility, status aliases and navigation reset: passed"
  ,"Separate Order dispatch board, Production work stages and safe exact-ID integrity repair: passed"
  ,"Dedicated A4 Production Sheet isolation, exact IDs, fixed table and print footer: passed"
  ,"Reusable Duplicate Quotation, independent project/address, safe field whitelist and rollback: passed"
].join("\n"));
