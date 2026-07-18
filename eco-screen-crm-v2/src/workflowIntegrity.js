const integrityCollections = ["quotations", "orders", "productionJobs", "installationJobs", "products"];

const archivedWorkflowStatuses = new Set([
  "archived",
  "cancelled",
  "canceled",
  "cancelled_archived",
  "canceled_archived",
  "cancelled_archive",
  "canceled_archive",
  "archived_cancelled",
  "archived_canceled",
  "duplicate_archived"
]);

export function normalizeWorkflowStatus(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/_+/g, "_");
}

function isArchivedWorkflowStatus(status) {
  const normalized = normalizeWorkflowStatus(status);
  return archivedWorkflowStatuses.has(normalized)
    || normalized.endsWith("_archived")
    || normalized.startsWith("archived_");
}

export function isActiveOrderRecord(order = {}) {
  const status = normalizeWorkflowStatus(order.status);
  return order.isArchived !== true
    && !isArchivedWorkflowStatus(status)
    && status !== "follow_up";
}

export function isActiveWorkflowRecord(record = {}) {
  const status = normalizeWorkflowStatus(record.status);
  return record.isArchived !== true
    && !isArchivedWorkflowStatus(status);
}

function recordTimestamp(record = {}) {
  const parsed = Date.parse(record.updatedAt || record.updated_at || record.createdAt || record.created_at || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function uniqueLatestByStableId(records = []) {
  const unique = new Map();
  records.forEach((record) => {
    const stableId = String(record?.id || "").trim();
    if (!stableId) return;
    const current = unique.get(stableId);
    if (!current || recordTimestamp(record) >= recordTimestamp(current)) unique.set(stableId, record);
  });
  return [...unique.values()];
}

export function uniqueActiveOrders(orders = []) {
  return uniqueLatestByStableId(Array.isArray(orders) ? orders : []).filter(isActiveOrderRecord);
}

export function uniqueActiveProductionJobs(productionJobs = []) {
  return uniqueLatestByStableId(Array.isArray(productionJobs) ? productionJobs : []).filter(isActiveWorkflowRecord);
}

export function normalizedFinalOrderTotal(order = {}) {
  const fields = ["finalTotal", "grandTotal", "total", "quotationTotal"];
  for (const field of fields) {
    const raw = order?.[field];
    if (raw === null || raw === undefined || String(raw).trim() === "") continue;
    const normalized = typeof raw === "number"
      ? raw
      : Number(String(raw).replace(/RM/gi, "").replaceAll(",", "").trim());
    if (Number.isFinite(normalized) && normalized >= 0) return normalized;
  }
  return null;
}

export function scanWorkflowIntegrity(snapshot = {}) {
  const data = Object.fromEntries(integrityCollections.map((collection) => [
    collection,
    Array.isArray(snapshot[collection]) ? snapshot[collection] : []
  ]));
  const issues = [];
  const add = (category, recordType, record, problem, recommendedAction, repair = null, overrides = {}) => {
    const stableId = overrides.stableId ?? record?.id ?? "";
    const suffix = `${recordType}:${stableId || issues.length}:${issues.length}`;
    issues.push({
      id: `${category}:${suffix}`,
      category,
      recordType,
      stableId: String(stableId || ""),
      orderNo: String(overrides.orderNo ?? orderNumber(record) ?? ""),
      quotationNo: String(overrides.quotationNo ?? quotationNumber(record) ?? ""),
      customer: String(overrides.customer ?? customerName(record) ?? ""),
      phone: String(overrides.phone ?? customerPhone(record) ?? ""),
      amount: overrides.amount ?? record?.total ?? record?.amount ?? "",
      status: String(overrides.status ?? record?.status ?? ""),
      linkedIds: String(overrides.linkedIds ?? linkedIds(record) ?? ""),
      problem,
      recommendedAction,
      repair
    });
  };

  const activeOrders = data.orders.filter(isActiveOrderRecord);
  const activeProduction = data.productionJobs.filter(isActiveWorkflowRecord);
  const activeInstallation = data.installationJobs.filter(isActiveWorkflowRecord);
  const orderById = new Map(data.orders.filter((row) => row?.id).map((row) => [String(row.id), row]));
  const activeOrderById = new Map(activeOrders.filter((row) => row?.id).map((row) => [String(row.id), row]));
  const quoteById = new Map(data.quotations.filter((row) => row?.id).map((row) => [String(row.id), row]));
  const productionById = new Map(activeProduction.filter((row) => row?.id).map((row) => [String(row.id), row]));

  data.quotations.forEach((quote) => {
    const quoteId = String(quote.id || "");
    const linkedOrderId = String(quote.linkedOrderId || quote.orderId || "");
    const exactOrders = activeOrders.filter((order) => String(order.quoteId || order.quotationId || "") === quoteId
      || (linkedOrderId && String(order.id || "") === linkedOrderId));
    if (normalizeQuotationStatus(quote.status) === "won" && !exactOrders.length) {
      add("A", "Quotation", quote, "Won quotation has no active Order linked by stable ID.", "Review the quotation, then convert it or repair its exact Order link.");
    }
    if (linkedOrderId && !orderById.has(linkedOrderId)) {
      add("B", "Quotation", quote, `Linked Order ID ${linkedOrderId} is missing from state.orders.`, "Enter the exact existing Order stable ID and repair Quotation → Order.", {
        type: "quote-order",
        recordId: quoteId,
        targetLabel: "Exact Order stable ID"
      });
    }
  });

  activeOrders.forEach((order) => {
    const quoteId = String(order.quoteId || order.quotationId || "");
    if (!quoteId || !quoteById.has(quoteId)) {
      add("C", "Order", order, quoteId ? `Linked quotation ID ${quoteId} is missing.` : "Order has no linked quotation stable ID.", "Enter the exact Quotation stable ID and repair Order → Quotation.", {
        type: "order-quote",
        recordId: String(order.id || ""),
        targetLabel: "Exact Quotation stable ID"
      });
    }
  });

  data.orders.filter((order) => String(order.status || "").trim().toLowerCase() === "follow_up").forEach((order) => {
    add("D", "Order", order, "Order uses invalid workflow status follow_up.", "Boss/Admin must choose a valid Order status; the record is not changed automatically.", {
      type: "order-status",
      recordId: String(order.id || "")
    });
  });

  groupsBy(activeOrders, (order) => String(order.quoteId || order.quotationId || ""))
    .filter((group) => group.key && group.rows.length > 1)
    .forEach((group) => add("E", "Order group", group.rows[0], `${group.rows.length} active Orders link to quotation ID ${group.key}.`, "Review differences and archive only a confirmed duplicate after selecting the Main Order.", {
      type: "archive-order",
      recordIds: group.rows.map((row) => String(row.id || "")),
      targetLabel: "Main Order stable ID"
    }, groupOverrides(group.rows)));

  groupsBy(activeProduction, (job) => String(job.orderId || ""))
    .filter((group) => group.key && group.rows.length > 1)
    .forEach((group) => add("F", "Production group", group.rows[0], `${group.rows.length} active Production Jobs link to Order ID ${group.key}.`, "Review progress and archive only a confirmed duplicate after selecting the Main Production Job.", {
      type: "archive-production",
      recordIds: group.rows.map((row) => String(row.id || "")),
      targetLabel: "Main Production stable ID"
    }, groupOverrides(group.rows)));

  activeProduction.forEach((job) => {
    const exactOrder = activeOrderById.get(String(job.orderId || ""));
    if (!exactOrder) {
      add("G", "Production", job, job.orderId ? `Order ID ${job.orderId} is missing or archived.` : "Production Job has no exact Order stable ID.", "Enter the exact active Order stable ID and repair Production → Order.", {
        type: "production-order",
        recordId: String(job.id || ""),
        targetLabel: "Exact Order stable ID"
      });
      return;
    }
    if (normalizeReference(orderNumber(job)) !== normalizeReference(orderNumber(exactOrder))) {
      add("H", "Production", job, `Production Order No ${orderNumber(job) || "(missing)"} does not match exact linked Order ${orderNumber(exactOrder) || "(missing)"}.`, "Repair Production → Order from the existing exact orderId; do not rename the Order.", {
        type: "production-order",
        recordId: String(job.id || ""),
        targetId: String(exactOrder.id || "")
      });
    }
  });

  activeInstallation.forEach((job) => {
    const exactOrder = activeOrderById.get(String(job.orderId || ""));
    const wrongNumber = exactOrder && normalizeReference(orderNumber(job)) !== normalizeReference(orderNumber(exactOrder));
    if (!exactOrder || wrongNumber) {
      add("I", "Installation", job, !exactOrder
        ? `Installation Order ID ${job.orderId || "(missing)"} is missing or archived.`
        : `Installation Order No ${orderNumber(job) || "(missing)"} does not match the exact linked Order.`, "Review and repair the Installation relationship manually using an exact Order stable ID.");
    }
  });

  integrityCollections.forEach((collection) => {
    groupsBy(data[collection], (row) => String(row?.id || ""))
      .filter((group) => group.key && group.rows.length > 1)
      .forEach((group) => add("J", collectionLabel(collection), group.rows[0], `${group.rows.length} records in ${collection} share stable ID ${group.key}.`, "Review as a stable-ID conflict; do not merge or delete automatically.", null, groupOverrides(group.rows)));
  });

  groupsBy(activeOrders, (order) => normalizeReference(orderNumber(order)))
    .filter((group) => group.key && new Set(group.rows.map((row) => String(row.id || ""))).size > 1)
    .forEach((group) => add("K", "Order group", group.rows[0], `Order No ${orderNumber(group.rows[0])} is used by different stable IDs.`, "Treat as Order Number Conflict; review without merging or renaming automatically.", null, groupOverrides(group.rows)));

  activeOrders.filter((order) => order.orderNo && order.orderNumber && normalizeReference(order.orderNo) !== normalizeReference(order.orderNumber)).forEach((order) => {
    add("L", "Order", order, `Order card/detail references disagree: ${order.orderNo} vs ${order.orderNumber}.`, "Review the exact Order record before using the existing Boss/Admin number editor.");
  });

  const owners = new Map();
  integrityCollections.forEach((collection) => data[collection].forEach((record, index) => {
    const id = String(record?.id || "");
    if (!id) {
      add("M", collectionLabel(collection), record, `Record at ${collection}[${index}] has no stable ID and cannot be safely merged with cloud data.`, "Assign or repair a stable ID through an explicit reviewed workflow; do not merge by number.");
      return;
    }
    const entries = owners.get(id) || [];
    entries.push({ collection, record });
    owners.set(id, entries);
  }));
  owners.forEach((entries, id) => {
    const distinctCollections = [...new Set(entries.map((entry) => entry.collection))];
    if (distinctCollections.length < 2) return;
    add("M", "Cross-collection", entries[0].record, `Stable ID ${id} appears in ${distinctCollections.join(", ")}.`, "Review as a cross-collection ID conflict; cloud merge remains collection-scoped.", null, {
      stableId: id,
      linkedIds: distinctCollections.join(", ")
    });
  });

  activeOrders.forEach((order) => {
    const activeJobs = activeProduction.filter((job) => String(job.orderId || "") === String(order.id || ""));
    if (activeJobs.length !== 1) return;
    const exactJob = activeJobs[0];
    if (String(order.productionJobId || "") === String(exactJob.id || "")) return;
    add("M", "Order", order, `Order productionJobId ${order.productionJobId || "(missing)"} does not match its one exact active Production Job ${exactJob.id}.`, "Repair Order → Production using the exact Production stable ID.", {
      type: "order-production",
      recordId: String(order.id || ""),
      targetId: String(exactJob.id || "")
    });
  });

  data.quotations.forEach((quote) => {
    const linkedId = String(quote.linkedOrderId || quote.orderId || "");
    const order = activeOrderById.get(linkedId);
    if (!order || !quote.id) return;
    const orderQuoteId = String(order.quoteId || order.quotationId || "");
    if (!orderQuoteId || orderQuoteId === String(quote.id)) return;
    const orderNo = normalizeReference(orderNumber(order));
    const ownershipConflicts = activeOrders.filter((candidate) => String(candidate.id || "") !== linkedId
      && orderNo
      && normalizeReference(orderNumber(candidate)) === orderNo);
    const conflictMessage = ownershipConflicts.length
      ? ` Order Number Ownership Conflict: ${orderNumber(order)} is also used by Order ${ownershipConflicts.map((candidate) => candidate.id).join(", ")}; every conflicting Order requires a new unused number before repair.`
      : "";
    add("M", "Quotation", quote,
      `Quotation links to Order ${linkedId}, but that Order links to quotation ${orderQuoteId}.${conflictMessage}`,
      "Use Safe Order Ownership Repair with the exact Quotation and Order stable IDs. No customer, item or financial values are copied.", {
        type: "order-ownership",
        quotationId: String(quote.id),
        orderId: linkedId,
        conflictingOrderIds: ownershipConflicts.map((candidate) => String(candidate.id || ""))
      }, {
        orderNo: orderNumber(order),
        linkedIds: `quotation->order:${linkedId}, order->quotation:${orderQuoteId}${ownershipConflicts.length ? `, number-conflicts:${ownershipConflicts.map((candidate) => candidate.id).join(",")}` : ""}`
      });
  });

  return {
    issues,
    categories: Object.fromEntries("ABCDEFGHIJKLM".split("").map((category) => [category, issues.filter((issue) => issue.category === category)])),
    scannedCounts: Object.fromEntries(integrityCollections.map((collection) => [collection, data[collection].length]))
  };
}

function groupsBy(rows, keyGetter) {
  const map = new Map();
  rows.forEach((row) => {
    const key = keyGetter(row);
    const group = map.get(key) || [];
    group.push(row);
    map.set(key, group);
  });
  return [...map.entries()].map(([key, groupedRows]) => ({ key, rows: groupedRows }));
}

function groupOverrides(rows) {
  return {
    stableId: rows.map((row) => row.id || "(missing)").join(", "),
    linkedIds: rows.map((row) => linkedIds(row)).filter(Boolean).join(" | ")
  };
}

function orderNumber(record = {}) {
  return String(record.orderNo || record.orderNumber || "").trim();
}

function quotationNumber(record = {}) {
  return String(record.quotationNo || record.quoteNo || record.quoteNumber || "").trim();
}

function customerName(record = {}) {
  return record.customer?.name || record.customerName || "";
}

function customerPhone(record = {}) {
  return record.customer?.phone || record.phone || "";
}

function linkedIds(record = {}) {
  return [
    record.quoteId || record.quotationId ? `quote:${record.quoteId || record.quotationId}` : "",
    record.linkedOrderId || record.orderId ? `order:${record.linkedOrderId || record.orderId}` : "",
    record.productionJobId ? `production:${record.productionJobId}` : "",
    record.installationJobId ? `installation:${record.installationJobId}` : ""
  ].filter(Boolean).join(", ");
}

function normalizeReference(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeQuotationStatus(value) {
  const normalized = String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (["won", "confirmed", "converted"].includes(normalized)) return "won";
  return normalized;
}

function collectionLabel(collection) {
  return ({
    quotations: "Quotation",
    orders: "Order",
    productionJobs: "Production",
    installationJobs: "Installation",
    products: "Product"
  })[collection] || collection;
}
