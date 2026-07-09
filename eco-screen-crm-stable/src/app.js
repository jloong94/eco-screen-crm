(() => {
  'use strict';

  const APP_KEY = 'ecoScreenCrmStable.v1';
  const CLOUD_KEY = 'ecoScreenCrmStable.supabase';
  const COMPANY_PHONE = '0195763499';
  const COLLECTIONS = ['users', 'products', 'quotations', 'orders', 'productionJobs', 'installationJobs', 'warrantyCards', 'companySettings'];
  const ROLE_CAN_MANAGE = ['Boss', 'Admin'];
  const DEFAULT_PRODUCTS = [
    ['Roller Window', 'Roller Screen', 33, 'sqft', 11],
    ['Roller Door', 'Roller Screen', 41, 'sqft', 11],
    ['3 Section Removable', 'Removable Screen', 40, 'sqft', 11],
    ['Pocket Lock', 'Pocket Lock', 50, 'sqft', 11],
    ['Sliding Security Mesh Door', 'Pocket Lock', 100, 'sqft', 21],
    ['Sliding Stainless Steel Net Window', 'Sliding Screen', 55, 'sqft', 11],
    ['Sliding Stainless Steel Net Door', 'Sliding Door', 55, 'sqft', 11],
    ['Aluminium Grille + Stainless Steel Net', 'Aluminium Grille', 80, 'sqft', 11],
    ['Hinged Security Mesh Window', 'Security Mesh', 90, 'sqft', 11],
    ['Hinged Security Mesh Door', 'Security Mesh', 100, 'sqft', 11],
    ['Roller With Grille', 'Roller With Grille', 53, 'sqft', 11],
    ['3 Section With Grille', 'Removable With Grille', 60, 'sqft', 11],
    ['Magnetic Screen', 'Magnetic Screen', 10, 'sqft', 11],
    ['Fold Security Mesh', 'Security Mesh', 129, 'sqft', 11],
    ['Glass With Security Mesh', 'Security Mesh', 190, 'sqft', 11],
    ['Hollow 1x1', 'Hollow', 5, 'sqft', 0],
    ['Hollow 1x2', 'Hollow', 10, 'sqft', 0],
    ['Hollow 1x3', 'Hollow', 15, 'sqft', 0],
    ['Hollow 2x2', 'Hollow', 20, 'sqft', 0],
    ['Hollow 2x3', 'Hollow', 25, 'sqft', 0]
  ];
  const t = {
    en: {
      login: 'Login', dashboard: 'Dashboard', quotations: 'Quotations', orders: 'Orders', production: 'Production', installation: 'Installation',
      warranty: 'Warranty Card', products: 'Products', settings: 'Company Settings', backup: 'Backup', logout: 'Logout', save: 'Save',
      quoted: 'Quoted', follow_up: 'Follow Up', won: 'Won', lost: 'Lost', not_produced: 'Not Produced', in_production: 'In Production',
      completed: 'Completed', not_scheduled: 'Not Scheduled', scheduled: 'Scheduled', installed: 'Installed', pending_collection: 'Pending Collection',
      touch_up: 'Touch Up'
    },
    zh: {
      login: '登录', dashboard: '总览', quotations: '报价', orders: '订单', production: '生产', installation: '安装',
      warranty: '保用卡', products: '产品', settings: '公司设置', backup: '备份', logout: '退出', save: '保存',
      quoted: '报价', follow_up: 'Follow Up', won: '成交', lost: '不成交', not_produced: '未生产', in_production: '生产中',
      completed: '已完成', not_scheduled: '未安排', scheduled: '已安排', installed: '已安装', pending_collection: '等待收款',
      touch_up: '手尾'
    }
  };

  const defaults = () => ({
    session: null,
    lang: 'en',
    syncStatus: 'Local Mode',
    users: [
      { username: 'boss1', password: '1234', role: 'Boss' },
      { username: 'admin', password: '1234', role: 'Admin' },
      { username: 'secretary', password: '1234', role: 'Secretary' },
      { username: 'sales', password: '1234', role: 'Sales' },
      { username: 'production', password: '1234', role: 'Production' },
      { username: 'installer', password: '1234', role: 'Installer' }
    ],
    products: defaultProducts(),
    quotations: [],
    orders: [],
    productionJobs: [],
    installationJobs: [],
    warrantyCards: [],
    companySettings: [{ id: 'company', name: 'Eco Screen', phone: COMPANY_PHONE }],
    ui: {
      page: 'dashboard',
      selectedQuotationId: null,
      selectedOrderId: null,
      quotationPage: 1,
      quotationSearch: '',
      quotationStatus: 'all',
      orderPage: 1,
      orderSearch: '',
      orderStatus: 'all',
      migration: null
    }
  });

  let state = load();
  const app = document.getElementById('app');

  function uid() {
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  function defaultProducts() {
    return DEFAULT_PRODUCTS.map(([name, category, unitPrice, calculationType, minimumSqft]) => ({
      id: uid(),
      name,
      category,
      unitPrice,
      calculationType,
      minimumSqft,
      active: true
    }));
  }

  function load() {
    try {
      const stored = JSON.parse(localStorage.getItem(APP_KEY) || 'null');
      return stored ? { ...defaults(), ...stored, ui: { ...defaults().ui, ...(stored.ui || {}) } } : defaults();
    } catch {
      return defaults();
    }
  }

  function save() {
    localStorage.setItem(APP_KEY, JSON.stringify(state));
    syncCloud().catch(() => setSync('Sync Failed'));
  }

  function setSync(value) {
    state.syncStatus = value;
    localStorage.setItem(APP_KEY, JSON.stringify(state));
  }

  function restoreDefaultProducts(showMessage = true) {
    state.products = defaultProducts();
    save();
    if (showMessage) alert('Default Eco Screen products restored.');
  }

  function label(key) {
    return (t[state.lang] && t[state.lang][key]) || t.en[key] || key;
  }

  function money(value) {
    return 'RM' + Number(value || 0).toFixed(2);
  }

  function canManage() {
    return state.session && ROLE_CAN_MANAGE.includes(state.session.role);
  }

  function activeOrders() {
    return state.orders.filter((order) => order.status !== 'archived' && order.status !== 'moved_back');
  }

  function productByName(name) {
    return state.products.find((product) => product.name === name) || {};
  }

  function yes(value) {
    return String(value || '').toLowerCase() === 'yes' || value === true;
  }

  function calcItemDetails(item) {
    const product = productByName(item.product);
    const unitPrice = numberValue(item.unitPrice) || numberValue(product.unitPrice);
    const calculationType = item.calculationType || product.calculationType || 'sqft';
    const minimumSqft = numberValue(item.minimumSqft !== undefined && item.minimumSqft !== '' ? item.minimumSqft : product.minimumSqft);
    const quantity = numberValue(item.quantity) || 1;
    const widthMm = numberValue(item.width);
    const heightMm = numberValue(item.height);
    const sqft = widthMm > 0 && heightMm > 0 ? (widthMm * heightMm) / 92903.04 : 0;
    const chargeableSqft = calculationType === 'sqft' ? Math.max(sqft, minimumSqft) : 1;
    const baseTotal = calculationType === 'sqft' ? chargeableSqft * unitPrice * quantity : unitPrice * quantity;
    const powdercoatAmount = yes(item.powdercoat) ? baseTotal * 0.08 : 0;
    const autoTotal = baseTotal + powdercoatAmount;
    const manual = numberValue(item.manualFinalPrice);
    const finalTotal = manual > 0 ? manual : autoTotal;
    return { unitPrice, calculationType, minimumSqft, quantity, sqft, chargeableSqft, baseTotal, powdercoatAmount, autoTotal, finalTotal };
  }

  function calcItem(item) {
    return calcItemDetails(item).finalTotal;
  }

  function calcQuote(quote) {
    const subtotal = (quote.items || []).reduce((sum, item) => sum + calcItem(item), 0);
    const total = Math.max(0, subtotal - Number(quote.discount || 0));
    const deposit = Number(quote.deposit || 0);
    return { subtotal, total, deposit, balance: Math.max(0, total - deposit) };
  }

  function nextOrderNo(date = new Date()) {
    const yy = String(date.getFullYear()).slice(-2);
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const prefix = `SO${yy}${mm}`;
    const max = state.orders
      .filter((order) => order.orderNo && order.orderNo.startsWith(prefix))
      .reduce((highest, order) => Math.max(highest, Number(order.orderNo.slice(prefix.length)) || 0), 0);
    return formatOrderNo(prefix, max + 1);
  }

  function formatOrderNo(prefix, sequence) {
    return prefix + String(sequence).padStart(3, '0');
  }

  function paymentStatus(balance) {
    if (Number(balance || 0) <= 0) return 'paid';
    return 'partial';
  }

  function convertQuotation(id) {
    const quote = state.quotations.find((item) => item.id === id);
    if (!quote) return null;
    const existing = state.orders.find((order) => order.quotationId === id && order.status !== 'moved_back');
    if (existing) {
      state.ui.page = 'orders';
      state.ui.selectedOrderId = existing.id;
      render();
      return existing;
    }
    const totals = calcQuote(quote);
    const order = {
      id: uid(), orderNo: nextOrderNo(), quoteNumber: quote.quotationNo, quotationId: quote.id,
      customerName: quote.customerName, phone: quote.phone, area: quote.area, address: quote.address,
      items: quote.items, total: totals.total, deposit: totals.deposit, balance: totals.balance,
      status: 'confirmed', productionStatus: 'not_produced', installationStatus: 'not_scheduled',
      paymentStatus: paymentStatus(totals.balance), createdAt: new Date().toISOString()
    };
    quote.status = 'won';
    quote.convertedOrderId = order.id;
    state.orders.push(order);
    save();
    return order;
  }

  function seedQuote(no, finalPrice = 800, deposit = 0) {
    const quote = {
      id: uid(), quotationNo: no, customerName: no + ' Customer', phone: '0123456789', area: 'Klang Valley',
      address: 'Test address', appointmentDate: today(), status: 'quoted', discount: 0, deposit,
      items: [{ id: uid(), product: 'Eco Screen Classic', width: 1, height: 1, quantity: 1, color: 'Black', location: 'Living', unitPrice: 100, manualFinalPrice: finalPrice, adjustmentRemark: 'Manual test price' }]
    };
    state.quotations.push(quote);
    save();
    return quote;
  }

  function today() {
    return new Date().toISOString().slice(0, 10);
  }

  function pick(obj, names, fallback = '') {
    for (const name of names) {
      const parts = name.split('.');
      let value = obj;
      for (const part of parts) value = value && value[part];
      if (value !== undefined && value !== null && value !== '') return value;
    }
    return fallback;
  }

  function asArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function numberValue(value) {
    const number = Number(String(value || 0).replace(/[^\d.-]/g, ''));
    return Number.isFinite(number) ? number : 0;
  }

  function oldCollections(payload) {
    const data = payload && payload.data ? payload.data : payload;
    return {
      quotations: asArray(data && data.quotations),
      orders: asArray(data && data.orders),
      productionJobs: asArray(data && data.productionJobs),
      installationJobs: asArray(data && data.installationJobs),
      warrantyCards: asArray(data && data.warrantyCards)
    };
  }

  function oldRef(record, type) {
    const fallback = type + '-' + uid();
    return String(pick(record, ['oldRefNo', 'orderNo', 'quotationNo', 'quoteNo', 'quoteNumber', 'number', 'refNo', 'id'], fallback));
  }

  function oldSourceId(record) {
    return String(pick(record, ['id', '_id', 'uuid', 'sourceId'], ''));
  }

  function migrationRowId(type, ref, sourceIndex) {
    return `${type}-${ref}-${sourceIndex}`.replace(/[^a-z0-9_-]/gi, '-');
  }

  function customerName(record) {
    return String(pick(record, ['customerName', 'customer.name', 'name', 'clientName'], ''));
  }

  function customerPhone(record) {
    return String(pick(record, ['phone', 'customer.phone', 'customerPhone', 'contact'], ''));
  }

  function normalizeItems(record) {
    return asArray(record.items || record.orderItems || record.products).map((item) => ({
      id: uid(),
      product: pick(item, ['product', 'name', 'productName', 'description'], 'Eco Screen'),
      width: numberValue(pick(item, ['width', 'w'], 1)),
      height: numberValue(pick(item, ['height', 'h'], 1)),
      quantity: numberValue(pick(item, ['quantity', 'qty'], 1)) || 1,
      color: pick(item, ['color', 'colour'], ''),
      location: pick(item, ['location', 'room'], ''),
      unitPrice: numberValue(pick(item, ['unitPrice', 'price', 'rate'], 0)),
      manualFinalPrice: numberValue(pick(item, ['manualFinalPrice', 'finalPrice', 'amount', 'total'], 0)),
      adjustmentRemark: pick(item, ['adjustmentRemark', 'remark', 'notes'], '')
    }));
  }

  function oldTotals(record, items) {
    const subtotal = numberValue(pick(record, ['subtotal', 'subTotal'], 0)) || items.reduce((sum, item) => sum + calcItem(item), 0);
    const discount = numberValue(pick(record, ['discount'], 0));
    const total = numberValue(pick(record, ['total', 'grandTotal', 'amount'], 0)) || Math.max(0, subtotal - discount);
    const deposit = numberValue(pick(record, ['deposit', 'paid', 'amountPaid'], 0));
    const balance = pick(record, ['balance', 'remaining', 'outstanding'], '') === '' ? Math.max(0, total - deposit) : numberValue(pick(record, ['balance', 'remaining', 'outstanding'], 0));
    return { subtotal, discount, total, deposit, balance };
  }

  function mapQuotationStatus(record, importingAsOrder) {
    const raw = String(pick(record, ['status', 'quotationStatus'], '')).toLowerCase().replace(/\s+/g, '_');
    if (raw.includes('lost') || raw.includes('cancel')) return 'lost';
    if (raw.includes('quoted')) return 'quoted';
    if (raw.includes('follow')) return 'follow_up';
    if (raw.includes('won') || raw.includes('confirm') || raw.includes('convert')) return importingAsOrder ? 'won' : 'follow_up';
    return 'follow_up';
  }

  function mapProductionStatus(record) {
    const raw = String(pick(record, ['productionStatus', 'production.status', 'status'], '')).toLowerCase();
    if (raw.includes('complete') || raw.includes('done')) return 'completed';
    if (raw.includes('sent') || raw.includes('production') || raw.includes('process')) return 'in_production';
    return 'not_produced';
  }

  function mapInstallationStatus(record, balance) {
    const raw = String(pick(record, ['installationStatus', 'installation.status', 'status'], '')).toLowerCase();
    if (raw.includes('touch')) return 'touch_up';
    if ((raw.includes('install') || raw.includes('complete') || raw.includes('service')) && balance > 0) return 'pending_collection';
    if (raw.includes('install') || raw.includes('complete') || raw.includes('service')) return 'installed';
    if (raw.includes('schedule')) return 'scheduled';
    if (raw.includes('collection')) return 'pending_collection';
    return 'not_scheduled';
  }

  function stableQuotationFromOld(record, forceFollowUp = true, importingAsOrder = false) {
    const items = normalizeItems(record);
    const totals = oldTotals(record, items);
    const ref = oldRef(record, 'quotation');
    return {
      id: 'v2-quote-' + ref.replace(/[^a-z0-9_-]/gi, '-'),
      quotationNo: String(pick(record, ['quotationNo', 'quoteNo', 'quoteNumber', 'number', 'refNo'], ref)),
      customerName: customerName(record),
      phone: customerPhone(record),
      area: pick(record, ['area', 'customer.area'], ''),
      address: pick(record, ['address', 'customer.address'], ''),
      appointmentDate: pick(record, ['appointmentDate', 'appointment.date', 'date'], ''),
      items,
      discount: totals.discount,
      deposit: totals.deposit,
      subtotal: totals.subtotal,
      total: totals.total,
      balance: totals.balance,
      status: forceFollowUp ? mapQuotationStatus(record, importingAsOrder) : mapQuotationStatus(record, importingAsOrder),
      source: 'v2-import',
      oldRefNo: ref,
      oldSourceId: oldSourceId(record)
    };
  }

  function stableOrderFromOld(record, newOrderNo, linkedQuotationId = '') {
    const items = normalizeItems(record);
    const totals = oldTotals(record, items);
    const ref = oldRef(record, 'order');
    const installationStatus = mapInstallationStatus(record, totals.balance);
    const completed = installationStatus === 'installed';
    return {
      id: uid(),
      orderNo: newOrderNo,
      quoteNumber: String(pick(record, ['quoteNumber', 'quotationNo', 'quoteNo', 'orderNo', 'refNo'], ref)),
      quotationNo: String(pick(record, ['quotationNo', 'quoteNo', 'quoteNumber', 'orderNo', 'refNo'], ref)),
      quotationId: linkedQuotationId,
      customerName: customerName(record),
      phone: customerPhone(record),
      area: pick(record, ['area', 'customer.area'], ''),
      address: pick(record, ['address', 'customer.address'], ''),
      items,
      subtotal: totals.subtotal,
      discount: totals.discount,
      total: totals.total,
      deposit: totals.deposit,
      balance: totals.balance,
      productionStatus: completed ? 'completed' : mapProductionStatus(record),
      installationStatus,
      paymentStatus: paymentStatus(totals.balance),
      status: completed ? 'archived' : (installationStatus === 'touch_up' ? 'touch_up' : (installationStatus === 'pending_collection' ? 'pending_collection' : 'confirmed')),
      source: 'v2-import',
      oldOrderNo: ref,
      oldRefNo: ref,
      oldSourceId: oldSourceId(record),
      createdAt: new Date().toISOString()
    };
  }

  function previewProblems(record, items, totals) {
    const problems = [];
    if (!customerName(record)) problems.push('missing customer');
    if (!customerPhone(record)) problems.push('missing phone');
    if (!items.length) problems.push('no items');
    if (totals.total <= 0) problems.push('zero total');
    return problems;
  }

  function previewOldV2Backup(payload, options = {}) {
    const settings = { importQuotations: true, importOrders: true, importCompletedArchived: true, ...options };
    const collections = oldCollections(payload);
    let orderOffset = 0;
    const rows = [];
    const existingRefs = new Set([
      ...state.quotations.filter((item) => item.source === 'v2-import').map((item) => item.oldRefNo),
      ...state.orders.filter((item) => item.source === 'v2-import').map((item) => item.oldRefNo)
    ].filter(Boolean));
    const existingSourceIds = new Set([
      ...state.quotations.filter((item) => item.source === 'v2-import').map((item) => item.oldSourceId),
      ...state.orders.filter((item) => item.source === 'v2-import').map((item) => item.oldSourceId)
    ].filter(Boolean));
    const seenRefs = new Set();
    const seenSourceIds = new Set();

    collections.quotations.forEach((record, index) => {
      const ref = oldRef(record, 'quotation');
      const sourceId = oldSourceId(record);
      const quote = stableQuotationFromOld(record, true, false);
      const totals = oldTotals(record, quote.items);
      const problems = previewProblems(record, quote.items, totals);
      const duplicate = existingRefs.has(ref) || seenRefs.has(ref) || (sourceId && (existingSourceIds.has(sourceId) || seenSourceIds.has(sourceId)));
      seenRefs.add(ref);
      if (sourceId) seenSourceIds.add(sourceId);
      rows.push({
        id: migrationRowId('quotation', ref, index),
        type: 'Quotation',
        oldRefNo: ref,
        oldSourceId: sourceId,
        newOrderNo: '',
        customer: quote.customerName,
        phone: quote.phone,
        total: totals.total,
        balance: totals.balance,
        status: quote.status,
        problems,
        duplicate,
        importable: settings.importQuotations && !duplicate && quote.items.length > 0,
        selected: settings.importQuotations && !duplicate && quote.items.length > 0,
        record
      });
    });

    collections.orders.forEach((record, index) => {
      const ref = oldRef(record, 'order');
      const sourceId = oldSourceId(record);
      const items = normalizeItems(record);
      const totals = oldTotals(record, items);
      const installationStatus = mapInstallationStatus(record, totals.balance);
      const isCompleted = installationStatus === 'installed';
      const allowed = settings.importOrders && (!isCompleted || settings.importCompletedArchived);
      const duplicate = existingRefs.has(ref) || seenRefs.has(ref) || (sourceId && (existingSourceIds.has(sourceId) || seenSourceIds.has(sourceId)));
      seenRefs.add(ref);
      if (sourceId) seenSourceIds.add(sourceId);
      const newOrderNo = allowed && !duplicate && items.length ? nextOrderNoWithOffset(orderOffset++) : '';
      const problems = previewProblems(record, items, totals);
      rows.push({
        id: migrationRowId('order', ref, index),
        type: isCompleted ? 'Archived Completed' : 'Order',
        oldRefNo: ref,
        oldSourceId: sourceId,
        newOrderNo,
        customer: customerName(record),
        phone: customerPhone(record),
        total: totals.total,
        balance: totals.balance,
        status: installationStatus,
        problems,
        duplicate,
        importable: allowed && !duplicate && items.length > 0,
        selected: allowed && !duplicate && items.length > 0,
        record
      });
    });

    const valid = rows.filter((row) => row.importable).length;
    const duplicateCount = rows.filter((row) => row.duplicate).length;
    const skipped = rows.filter((row) => !row.importable).length;
    return {
      totals: {
        totalRecords: rows.length,
        oldQuotations: collections.quotations.length,
        oldOrders: collections.orders.length,
        valid,
        selected: rows.filter((row) => row.selected).length,
        skipped,
        duplicates: duplicateCount,
        quotationsToImport: rows.filter((row) => row.type === 'Quotation' && row.selected).length,
        ordersToImport: rows.filter((row) => (row.type === 'Order' || row.type === 'Archived Completed') && row.selected).length,
        skippedNoItems: rows.filter((row) => row.problems.includes('no items')).length,
        skippedDuplicates: duplicateCount,
        potentialProblems: rows.filter((row) => row.problems.length).length
      },
      rows
    };
  }

  function nextOrderNoWithOffset(offset) {
    const base = nextOrderNo();
    const prefix = base.slice(0, 6);
    const sequence = Number(base.slice(prefix.length)) || 0;
    return formatOrderNo(prefix, sequence + offset);
  }

  function stableBackupText() {
    return JSON.stringify({ exportedAt: new Date().toISOString(), app: 'Eco Screen CRM Stable', data: state }, null, 2);
  }

  function downloadText(filename, text) {
    const blob = new Blob([text], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function importOldV2Backup(payload, selectedIds, options = {}) {
    if (!canManage() && !options.force) return { quotationsImported: 0, ordersImported: 0, skipped: 0, errors: ['Boss/Admin only'] };
    const preview = options.preview || previewOldV2Backup(payload, options);
    const selected = new Set(selectedIds || preview.rows.filter((row) => row.selected).map((row) => row.id));
    const selectedRows = preview.rows.filter((row) => selected.has(row.id));
    const batchSize = Number(options.batchSize || 50);
    const result = { quotationsImported: 0, ordersImported: 0, skipped: 0, errors: [], backup: stableBackupText(), imported: 0, total: selectedRows.length, batchSize };
    for (let index = 0; index < selectedRows.length; index += batchSize) {
      selectedRows.slice(index, index + batchSize).forEach((row) => {
        if (!row.importable) {
          result.skipped += 1;
          return;
        }
        if (row.type === 'Quotation') {
          if (state.quotations.some((item) => item.source === 'v2-import' && (item.oldRefNo === row.oldRefNo || (row.oldSourceId && item.oldSourceId === row.oldSourceId)))) {
            result.skipped += 1;
            return;
          }
          state.quotations.push(stableQuotationFromOld(row.record, true, false));
          result.quotationsImported += 1;
          result.imported += 1;
        }
        if (row.type === 'Order' || row.type === 'Archived Completed') {
          if (state.orders.some((item) => item.source === 'v2-import' && (item.oldRefNo === row.oldRefNo || (row.oldSourceId && item.oldSourceId === row.oldSourceId)))) {
            result.skipped += 1;
            return;
          }
          const quoteRecord = stableQuotationFromOld(row.record, false, true);
          quoteRecord.status = 'won';
          let quote = state.quotations.find((item) => item.source === 'v2-import' && item.oldRefNo === quoteRecord.oldRefNo);
          if (!quote) {
            quote = quoteRecord;
            state.quotations.push(quote);
          }
          const order = stableOrderFromOld(row.record, nextOrderNo(), quote.id);
          state.orders.push(order);
          if (order.productionStatus !== 'not_produced') state.productionJobs.push({ id: uid(), orderId: order.id, status: order.productionStatus, source: 'v2-import', oldRefNo: row.oldRefNo });
          if (order.installationStatus !== 'not_scheduled') state.installationJobs.push({ id: uid(), orderId: order.id, status: order.installationStatus, source: 'v2-import', oldRefNo: row.oldRefNo });
          if (order.installationStatus === 'installed') state.warrantyCards.push({ id: uid(), orderId: order.id, orderNo: order.orderNo, quoteNumber: order.quoteNumber, customerName: order.customerName, source: 'v2-import', oldRefNo: row.oldRefNo });
          result.ordersImported += 1;
          result.imported += 1;
        }
      });
      result.progress = Math.min(selectedRows.length, index + batchSize);
    }
    save();
    return result;
  }

  async function syncCloud() {
    const config = JSON.parse(localStorage.getItem(CLOUD_KEY) || 'null');
    if (!config || !config.url || !config.key) {
      setSync('Local Mode');
      return;
    }
    const payloads = COLLECTIONS.map((collection) => ({
      collection,
      data: state[collection] || [],
      updated_at: new Date().toISOString()
    }));
    const response = await fetch(`${config.url.replace(/\/$/, '')}/rest/v1/crm_stable_sync`, {
      method: 'POST',
      headers: {
        apikey: config.key,
        Authorization: `Bearer ${config.key}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates'
      },
      body: JSON.stringify(payloads)
    });
    setSync(response.ok ? 'Cloud Connected' : 'Sync Failed');
  }

  window.ecoScreenStableApi = {
    getState: () => state,
    reset: () => { state = defaults(); save(); render(); },
    calcQuote, convertQuotation, seedQuote, nextOrderNo,
    moveBackToFollowUp, sendToProduction, markProductionCompleted, sendToInstaller, scheduleInstallation, completeInstallation,
    printQuotation, printWarranty, previewOldV2Backup, importOldV2Backup, filteredMigrationRows,
    calcItemDetails, defaultProducts, restoreDefaultProducts
  };

  function login(username, password) {
    const user = state.users.find((item) => item.username === username && item.password === password);
    if (!user) return alert('Invalid login');
    state.session = { username: user.username, role: user.role };
    state.ui.page = 'dashboard';
    save();
    render();
  }

  function logout() {
    state.session = null;
    save();
    render();
  }

  function route(page) {
    state.ui.page = page;
    save();
    render();
  }

  function layout(content) {
    if (!state.session) return loginView();
    return `
      <aside class="sidebar">
        <div class="brand"><strong>Eco Screen</strong><span>CRM Stable</span></div>
        <nav>${['dashboard', 'quotations', 'orders', 'production', 'installation', 'warranty', 'products', 'settings', 'backup'].map((page) => `<button class="${state.ui.page === page ? 'active' : ''}" data-route="${page}">${label(page)}</button>`).join('')}</nav>
      </aside>
      <main class="main">
        <header class="topbar">
          <div><strong>${label(state.ui.page)}</strong><span>${state.session.username} / ${state.session.role}</span></div>
          <div class="row"><span class="sync">${state.syncStatus}</span><button data-lang>${state.lang === 'en' ? '中文' : 'EN'}</button><button data-logout>${label('logout')}</button></div>
        </header>
        ${content}
      </main>`;
  }

  function loginView() {
    return `
      <section class="login">
        <form data-login class="panel narrow">
          <h1>Eco Screen CRM Stable</h1>
          <label>Username<input name="username" value="boss1" autocomplete="username"></label>
          <label>Password<input name="password" type="password" value="1234" autocomplete="current-password"></label>
          <button class="primary">${label('login')}</button>
          <p>Default users: boss1, admin, secretary, sales, production, installer / 1234</p>
        </form>
      </section>`;
  }

  function dashboardView() {
    const now = new Date();
    const month = now.toISOString().slice(0, 7);
    const orders = activeOrders().filter((order) => (order.createdAt || '').startsWith(month));
    const total = orders.reduce((sum, order) => sum + Number(order.total || 0), 0);
    const collected = activeOrders().reduce((sum, order) => sum + Number(order.deposit || 0) + Number(order.collectedAfterInstall || 0), 0);
    const outstanding = activeOrders().reduce((sum, order) => sum + Number(order.balance || 0), 0);
    const cards = [
      ['This month new order total', money(total)], ['Total collected', money(collected)], ['Outstanding balance', money(outstanding)],
      ['Pending collection', activeOrders().filter((o) => o.installationStatus === 'pending_collection').length], ['Orders count', activeOrders().length],
      ['Follow up quotations', state.quotations.filter((q) => q.status === 'follow_up').length], ['Production pending', activeOrders().filter((o) => o.productionStatus !== 'completed').length],
      ['Installation pending', activeOrders().filter((o) => o.productionStatus === 'completed' && o.installationStatus !== 'installed').length]
    ];
    return `<section class="grid metrics">${cards.map(([name, value]) => `<div class="metric"><span>${name}</span><strong>${value}</strong></div>`).join('')}</section>`;
  }

  function quotationView() {
    const search = (state.ui.quotationSearch || '').toLowerCase();
    const filtered = state.quotations.filter((q) => {
      const text = `${q.quotationNo} ${q.customerName} ${q.phone}`.toLowerCase();
      return text.includes(search) && (state.ui.quotationStatus === 'all' || q.status === state.ui.quotationStatus);
    });
    const page = Math.max(1, state.ui.quotationPage || 1);
    const rows = filtered.slice((page - 1) * 20, page * 20);
    return `
      <section class="split">
        <div class="panel">
          <div class="panel-head"><h2>${label('quotations')}</h2><button data-new-quote>New</button></div>
          <div class="toolbar"><input data-quote-search placeholder="Search quote, customer, phone" value="${state.ui.quotationSearch || ''}"><label>Status<select data-quote-status>${['all', 'quoted', 'follow_up', 'won', 'lost'].map((option) => `<option value="${option}" ${option === state.ui.quotationStatus ? 'selected' : ''}>${label(option)}</option>`).join('')}</select></label></div>
          <div class="list">${rows.map((q) => {
            const totals = calcQuote(q);
            return `<button class="list-row" data-select-quote="${q.id}"><strong>${q.quotationNo}</strong><span>${q.customerName}</span><span>${label(q.status)} / ${money(totals.total)}</span></button>`;
          }).join('') || '<p>No quotations yet.</p>'}</div>
          <div class="pager"><button data-quote-page="${page - 1}" ${page === 1 ? 'disabled' : ''}>Prev</button><span>Page ${page} / ${Math.max(1, Math.ceil(filtered.length / 20))}</span><button data-quote-page="${page + 1}" ${page * 20 >= filtered.length ? 'disabled' : ''}>Next</button></div>
        </div>
        <div class="panel">${quoteForm()}</div>
      </section>`;
  }

  function quoteForm() {
    const q = state.quotations.find((item) => item.id === state.ui.selectedQuotationId) || {
      id: '', quotationNo: '', customerName: '', phone: '', area: '', address: '', appointmentDate: today(), status: 'quoted', discount: 0, deposit: 0, items: []
    };
    const totals = calcQuote(q);
    return `
      <form data-save-quote>
        <input type="hidden" name="id" value="${q.id}">
        <div class="form-grid">
          ${input('quotationNo', 'Quotation No', q.quotationNo)}${input('customerName', 'Customer', q.customerName)}${input('phone', 'Phone', q.phone)}
          ${input('area', 'Area', q.area)}${input('appointmentDate', 'Appointment', q.appointmentDate, 'date')}${select('status', 'Status', q.status, ['quoted', 'follow_up', 'won', 'lost'])}
        </div>
        <label>Address<textarea name="address">${q.address || ''}</textarea></label>
        <div data-items>${(q.items || []).map(itemFields).join('')}</div>
        <button type="button" data-add-item>Add Item</button>
        <div class="form-grid">${input('discount', 'Discount', q.discount, 'number')}${input('deposit', 'Deposit', q.deposit, 'number')}<label>Total<input readonly value="${money(totals.total)}"></label><label>Balance<input readonly value="${money(totals.balance)}"></label></div>
        <div class="actions"><button class="primary">${label('save')}</button><button type="button" data-print-quote="${q.id}">Print</button><button type="button" data-convert="${q.id}">Convert to Order</button>${canManage() ? `<button type="button" class="danger" data-delete-quote="${q.id}">Delete</button>` : ''}</div>
      </form>`;
  }

  function itemFields(item = {}) {
    const id = item.id || uid();
    const productName = item.product || 'Roller Window';
    const details = calcItemDetails({ ...item, product: productName });
    return `<fieldset class="item" data-item="${id}">
      <label>Product<select name="product">${state.products.filter((product) => product.active !== false).map((product) => `<option value="${product.name}" ${product.name === productName ? 'selected' : ''}>${product.name}</option>`).join('')}</select></label>
      ${input('width', 'Width mm', item.width || 1000, 'number')}${input('height', 'Height mm', item.height || 1000, 'number')}
      ${input('quantity', 'Qty', item.quantity || 1, 'number')}${input('color', 'Color', item.color || '')}${input('location', 'Location', item.location || '')}
      ${input('unitPrice', 'Unit Price', item.unitPrice || details.unitPrice, 'number')}${input('minimumSqft', 'Minimum Sqft', item.minimumSqft !== undefined ? item.minimumSqft : details.minimumSqft, 'number')}
      <label>Calculation Type<select name="calculationType"><option value="sqft" ${(item.calculationType || details.calculationType) === 'sqft' ? 'selected' : ''}>sqft</option><option value="fixed" ${(item.calculationType || details.calculationType) === 'fixed' ? 'selected' : ''}>fixed</option></select></label>
      <label>Powdercoat<select name="powdercoat"><option value="no" ${yes(item.powdercoat) ? '' : 'selected'}>No</option><option value="yes" ${yes(item.powdercoat) ? 'selected' : ''}>Yes</option></select></label>
      ${input('manualFinalPrice', 'Manual Final', item.manualFinalPrice || '', 'number')}${input('adjustmentRemark', 'Remark', item.adjustmentRemark || '')}
      <div class="calc-note">Sqft ${details.sqft.toFixed(2)} / Chargeable ${details.chargeableSqft.toFixed(2)} / Powdercoat ${money(details.powdercoatAmount)} / Final ${money(details.finalTotal)}</div>
    </fieldset>`;
  }

  function input(name, caption, value, type = 'text') {
    return `<label>${caption}<input name="${name}" type="${type}" value="${String(value ?? '').replace(/"/g, '&quot;')}"></label>`;
  }

  function select(name, caption, value, options) {
    return `<label>${caption}<select name="${name}">${options.map((option) => `<option value="${option}" ${option === value ? 'selected' : ''}>${label(option)}</option>`).join('')}</select></label>`;
  }

  function ordersView() {
    const search = (state.ui.orderSearch || '').toLowerCase();
    const filtered = state.orders.filter((order) => order.status !== 'moved_back').filter((o) => {
      const text = `${o.orderNo} ${o.quoteNumber} ${o.customerName} ${o.phone}`.toLowerCase();
      return text.includes(search) && (state.ui.orderStatus === 'all' || o.status === state.ui.orderStatus);
    });
    const page = Math.max(1, state.ui.orderPage);
    const rows = filtered.slice((page - 1) * 20, page * 20);
    return `<section class="panel">
      <div class="toolbar"><input data-order-search placeholder="Search order, quote, customer, phone" value="${state.ui.orderSearch || ''}"><label>Filter<select data-order-status>${['all', 'confirmed', 'completed', 'pending_collection', 'touch_up', 'archived'].map((option) => `<option value="${option}" ${option === state.ui.orderStatus ? 'selected' : ''}>${label(option)}</option>`).join('')}</select></label></div>
      <div class="table">${rows.map(orderRow).join('') || '<p>No confirmed orders.</p>'}</div>
      <div class="pager"><button data-page="${page - 1}" ${page === 1 ? 'disabled' : ''}>Prev</button><span>Page ${page}</span><button data-page="${page + 1}" ${page * 20 >= filtered.length ? 'disabled' : ''}>Next</button></div>
    </section>`;
  }

  function orderRow(o) {
    return `<div class="table-row">
      <strong>${o.orderNo}</strong><span>Quote ${o.quoteNumber}${o.oldRefNo ? `<br>Old Ref ${o.oldRefNo}` : ''}</span><span>${o.customerName}<br>${o.phone}</span><span>${money(o.total)} / ${money(o.deposit)} / ${money(o.balance)}</span>
      <span>${label(o.productionStatus)}<br>${label(o.installationStatus)}<br>${o.paymentStatus}</span>
      <span class="actions"><button data-prod="${o.id}">Send to Production</button><button data-inst="${o.id}">Send to Installer</button>${canManage() ? `<button data-follow="${o.id}">Move Back</button>` : ''}<button data-archive="${o.id}">Archive</button></span>
    </div>`;
  }

  function productionView() {
    const jobs = activeOrders().filter((o) => o.productionStatus !== 'completed');
    return `<section class="panel"><div class="table">${jobs.map((o) => `<div class="table-row"><strong>${o.orderNo}</strong><span>${o.customerName}</span><span>${label(o.productionStatus)}</span><button data-complete-prod="${o.id}">Mark Completed</button></div>`).join('') || '<p>No production jobs.</p>'}</div></section>`;
  }

  function installationView() {
    const jobs = activeOrders().filter((o) => o.productionStatus === 'completed' || o.installationStatus !== 'not_scheduled');
    return `<section class="panel"><div class="table">${jobs.map((o) => `<div class="table-row"><strong>${o.orderNo}</strong><span>${o.customerName}</span><span>${label(o.installationStatus)}</span><button data-schedule="${o.id}">Schedule</button><button data-finish-install="${o.id}">Complete</button></div>`).join('') || '<p>No installation jobs.</p>'}</div></section>`;
  }

  function warrantyView() {
    return `<section class="panel"><div class="table">${activeOrders().map((o) => `<div class="table-row"><strong>${o.orderNo}</strong><span>${o.quoteNumber}</span><span>${o.customerName}</span><button data-warranty="${o.id}">Print Warranty</button></div>`).join('') || '<p>No orders for warranty cards.</p>'}</div></section>`;
  }

  function productsView() {
    if (!canManage()) return `<section class="panel"><p>Boss/Admin only.</p></section>`;
    return `<section class="panel">
      <div class="actions"><button class="primary" data-restore-products>Restore Eco Screen Default Products</button></div>
      <form data-product class="product-form">${input('name', 'Product', '')}${input('category', 'Category', '')}${input('unitPrice', 'Unit Price', 0, 'number')}${input('calculationType', 'Calculation Type', 'sqft')}${input('minimumSqft', 'Minimum Sqft', 11, 'number')}<button>Add Product</button></form>
      <form data-products-edit class="list">${state.products.map((p) => `<div class="list-line product-row" data-product-row="${p.id}">${input('name', 'Product', p.name)}${input('category', 'Category', p.category || '')}${input('unitPrice', 'Unit Price', p.unitPrice, 'number')}${input('calculationType', 'Calculation Type', p.calculationType || 'sqft')}${input('minimumSqft', 'Minimum Sqft', p.minimumSqft ?? 0, 'number')}<label>Active<select name="active"><option value="true" ${p.active !== false ? 'selected' : ''}>Yes</option><option value="false" ${p.active === false ? 'selected' : ''}>No</option></select></label></div>`).join('')}<button>Save Products</button></form>
    </section>`;
  }

  function settingsView() {
    if (!canManage()) return `<section class="panel"><p>Boss/Admin only.</p></section>`;
    const settings = state.companySettings[0];
    return `<section class="panel narrow"><form data-settings>${input('name', 'Company', settings.name)}${input('phone', 'Company Phone', settings.phone)}<button class="primary">${label('save')}</button></form><h3>Supabase</h3><form data-supabase>${input('url', 'Supabase URL', '')}${input('key', 'Anon Key', '')}<button>Save Sync Settings</button></form></section>`;
  }

  function backupView() {
    if (!canManage()) return `<section class="panel"><p>Boss/Admin only.</p></section>`;
    const migration = state.ui.migration || {};
    const preview = migration.preview;
    const result = migration.result;
    return `<section class="panel">
      <div class="backup-grid">
        <div>
          <h3>Backup</h3>
          <button data-export>Export JSON Backup</button>
          <label>Import JSON Backup<textarea data-import-text></textarea></label>
          <button data-import>Import JSON Backup</button>
        </div>
        <div>
          <h3>Migration Tools</h3>
          <div class="migration-box">
            <strong>Import Old V2 Backup</strong>
            <input type="file" accept="application/json,.json" data-v2-file>
            <div class="checks">
              <label><input type="checkbox" data-v2-option="importQuotations" ${migration.importQuotations === false ? '' : 'checked'}> Import quotations as Follow Up</label>
              <label><input type="checkbox" data-v2-option="importOrders" ${migration.importOrders === false ? '' : 'checked'}> Import real confirmed orders as Orders</label>
              <label><input type="checkbox" data-v2-option="importCompletedArchived" ${migration.importCompletedArchived === false ? '' : 'checked'}> Import installed/completed as Archived Completed</label>
            </div>
            <div class="actions"><button data-v2-backup>Backup Stable First</button><button data-v2-preview>Preview Import</button><button class="primary" data-v2-import>Import Selected</button></div>
          </div>
        </div>
      </div>
      ${preview ? migrationPreviewView(preview) : '<p class="muted">Select an Old V2 backup JSON, then preview before importing.</p>'}
      ${migration.progress ? `<div class="result"><strong>Progress</strong><span>Imported ${migration.progress.imported} / ${migration.progress.total}</span></div>` : ''}
      ${result ? `<div class="result"><strong>Import result</strong><span>Quotations imported: ${result.quotationsImported}</span><span>Orders imported: ${result.ordersImported}</span><span>Skipped: ${result.skipped}</span><span>Errors: ${result.errors.length ? result.errors.join(', ') : 'None'}</span></div>` : ''}
    </section>`;
  }

  function migrationOptions() {
    const migration = state.ui.migration || {};
    return {
      importQuotations: migration.importQuotations !== false,
      importOrders: migration.importOrders !== false,
      importCompletedArchived: migration.importCompletedArchived !== false
    };
  }

  function migrationPreviewView(preview) {
    const migration = state.ui.migration || {};
    const rows = filteredMigrationRows(preview, migration);
    const page = Math.max(1, migration.page || 1);
    const pageRows = rows.slice((page - 1) * 20, page * 20);
    const selectedIds = new Set(migration.selectedIds || preview.rows.filter((row) => row.selected).map((row) => row.id));
    const selectedCount = selectedIds.size;
    const summary = preview.totals;
    return `<div class="migration-preview">
      <div class="summary">
        <span>Total records: ${summary.totalRecords}</span><span>Total valid: ${summary.valid}</span><span>Total selected: ${selectedCount}</span><span>Total skipped: ${summary.skipped}</span>
        <span>Total duplicates: ${summary.duplicates}</span><span>Old quotations: ${summary.oldQuotations}</span><span>Old orders: ${summary.oldOrders}</span><span>Problems: ${summary.potentialProblems}</span>
      </div>
      <div class="toolbar"><input data-v2-search placeholder="Search customer, phone, old ref no" value="${migration.search || ''}"><label>Filter<select data-v2-filter>${['all', 'Quotation', 'Order', 'Archived Completed', 'Skipped', 'Duplicate'].map((option) => `<option value="${option}" ${option === (migration.filter || 'all') ? 'selected' : ''}>${option}</option>`).join('')}</select></label></div>
      <div class="actions"><button data-v2-select-all>Select All Valid</button><button data-v2-unselect-all>Unselect All</button><button data-v2-select-page>Select Current Page</button><button data-v2-unselect-page>Unselect Current Page</button></div>
      <div class="migration-table">
        <div class="migration-head"><span>Import</span><span>Type</span><span>Old Ref No</span><span>New Order No</span><span>Customer</span><span>Phone</span><span>Total</span><span>Balance</span><span>Status</span><span>Problem warning</span></div>
        ${pageRows.map((row) => `<div class="migration-row">
          <span><input type="checkbox" data-v2-select="${row.id}" ${selectedIds.has(row.id) ? 'checked' : ''} ${row.importable ? '' : 'disabled'}></span>
          <span>${row.type}</span><span>${row.oldRefNo}</span><span>${row.newOrderNo || '-'}</span><span>${row.customer || '-'}</span><span>${row.phone || '-'}</span>
          <span>${money(row.total)}</span><span>${money(row.balance)}</span><span>${row.status}</span><span>${row.duplicate ? 'duplicate oldRefNo' : (row.problems.join(', ') || '-')}</span>
        </div>`).join('')}
      </div>
      <div class="pager"><button data-v2-page="${page - 1}" ${page === 1 ? 'disabled' : ''}>Previous</button><span>Page ${page} / ${Math.max(1, Math.ceil(rows.length / 20))} (${rows.length} shown)</span><button data-v2-page="${page + 1}" ${page * 20 >= rows.length ? 'disabled' : ''}>Next</button></div>
    </div>`;
  }

  function filteredMigrationRows(preview, migration = {}) {
    const search = String(migration.search || '').toLowerCase();
    const filter = migration.filter || 'all';
    return preview.rows.filter((row) => {
      const text = `${row.customer} ${row.phone} ${row.oldRefNo}`.toLowerCase();
      const matchesSearch = text.includes(search);
      const matchesFilter = filter === 'all' || row.type === filter || (filter === 'Skipped' && !row.importable) || (filter === 'Duplicate' && row.duplicate);
      return matchesSearch && matchesFilter;
    });
  }

  function currentMigrationSelectedIds() {
    const migration = state.ui.migration || {};
    if (migration.selectedIds) return new Set(migration.selectedIds);
    const preview = migration.preview;
    return new Set(preview ? preview.rows.filter((row) => row.selected).map((row) => row.id) : []);
  }

  function setMigrationSelectedIds(ids) {
    state.ui.migration = state.ui.migration || {};
    state.ui.migration.selectedIds = [...ids];
  }

  function saveQuote(form) {
    const data = Object.fromEntries(new FormData(form).entries());
    const items = [...form.querySelectorAll('[data-item]')].map((field) => {
      const item = { id: field.dataset.item };
      field.querySelectorAll('input, select').forEach((inputEl) => { item[inputEl.name] = inputEl.value; });
      return item;
    });
    let quote = state.quotations.find((q) => q.id === data.id);
    if (!quote) {
      quote = { id: uid() };
      state.quotations.push(quote);
      state.ui.selectedQuotationId = quote.id;
    }
    Object.assign(quote, data, { items });
    save();
    render();
  }

  function deleteQuotation(id) {
    if (!canManage()) return alert('Boss/Admin only');
    const quote = state.quotations.find((q) => q.id === id);
    if (!quote || quote.convertedOrderId) return alert('Converted quotations cannot be deleted.');
    if (prompt('Type DELETE to confirm') !== 'DELETE') return;
    state.quotations = state.quotations.filter((q) => q.id !== id);
    save();
    render();
  }

  function sendToProduction(id) {
    const order = state.orders.find((o) => o.id === id);
    if (!order) return;
    order.productionStatus = 'in_production';
    if (!state.productionJobs.find((job) => job.orderId === id)) state.productionJobs.push({ id: uid(), orderId: id, status: 'in_production' });
    save();
  }

  function markProductionCompleted(id) {
    const order = state.orders.find((o) => o.id === id);
    if (!order) return;
    order.productionStatus = 'completed';
    const job = state.productionJobs.find((item) => item.orderId === id);
    if (job) job.status = 'completed';
    save();
  }

  function sendToInstaller(id) {
    const order = state.orders.find((o) => o.id === id);
    if (!order) return;
    if (!state.installationJobs.find((job) => job.orderId === id)) state.installationJobs.push({ id: uid(), orderId: id, status: 'not_scheduled' });
    save();
  }

  function scheduleInstallation(id) {
    const order = state.orders.find((o) => o.id === id);
    if (!order) return;
    order.installationStatus = 'scheduled';
    const job = state.installationJobs.find((item) => item.orderId === id) || { id: uid(), orderId: id };
    job.status = 'scheduled';
    if (!state.installationJobs.includes(job)) state.installationJobs.push(job);
    save();
  }

  function completeInstallation(id, collected = 0, touchUp = false, remark = '') {
    const order = state.orders.find((o) => o.id === id);
    if (!order) return;
    order.collectedAfterInstall = Number(order.collectedAfterInstall || 0) + Number(collected || 0);
    order.balance = Math.max(0, Number(order.balance || 0) - Number(collected || 0));
    order.installDate = today();
    order.installationStatus = touchUp ? 'touch_up' : (order.balance <= 0 ? 'installed' : 'pending_collection');
    order.paymentStatus = order.balance <= 0 ? 'paid' : 'partial';
    order.touchUpRemark = remark;
    save();
  }

  function moveBackToFollowUp(id, force = false) {
    if (!canManage() && !force) return alert('Boss/Admin only');
    if (!force && prompt('Type FOLLOW UP to confirm') !== 'FOLLOW UP') return;
    const order = state.orders.find((o) => o.id === id);
    if (!order) return;
    order.status = 'moved_back';
    state.productionJobs = state.productionJobs.filter((job) => job.orderId !== id);
    state.installationJobs = state.installationJobs.filter((job) => job.orderId !== id);
    state.warrantyCards = state.warrantyCards.filter((card) => card.orderId !== id);
    const quote = state.quotations.find((q) => q.id === order.quotationId);
    if (quote) {
      quote.status = 'follow_up';
      delete quote.convertedOrderId;
    }
    save();
  }

  function printDoc(title, body) {
    const settings = state.companySettings[0];
    const win = window.open('', '_blank');
    win.document.write(`<title>${title}</title><body><h1>${title}</h1><p>Eco Screen ${settings.phone}</p>${body}</body>`);
    win.document.close();
    win.print();
  }

  function printQuotation(id) {
    const quote = state.quotations.find((q) => q.id === id);
    if (!quote) return;
    const totals = calcQuote(quote);
    printDoc(`Quotation ${quote.quotationNo}`, `<p>${quote.customerName}</p><p>Total ${money(totals.total)}</p><p>Balance ${money(totals.balance)}</p>`);
  }

  function printWarranty(id) {
    const order = state.orders.find((o) => o.id === id);
    if (!order) return;
    printDoc(`Warranty ${order.orderNo}`, `<p>Quote No ${order.quoteNumber}</p><p>Customer ${order.customerName}</p><p>Products ${(order.items || []).map((i) => i.product).join(', ')}</p><p>Install date ${order.installDate || '-'}</p>`);
  }

  function render() {
    const views = { dashboard: dashboardView, quotations: quotationView, orders: ordersView, production: productionView, installation: installationView, warranty: warrantyView, products: productsView, settings: settingsView, backup: backupView };
    app.innerHTML = layout((views[state.ui.page] || dashboardView)());
  }

  document.addEventListener('submit', (event) => {
    const form = event.target;
    if (form.matches('[data-login]')) { event.preventDefault(); login(form.username.value, form.password.value); }
    if (form.matches('[data-save-quote]')) { event.preventDefault(); saveQuote(form); }
    if (form.matches('[data-product]')) {
      event.preventDefault();
      state.products.push({
        id: uid(),
        name: form.name.value,
        category: form.category.value,
        unitPrice: Number(form.unitPrice.value),
        calculationType: form.calculationType.value || 'sqft',
        minimumSqft: Number(form.minimumSqft.value),
        active: true
      });
      save();
      render();
    }
    if (form.matches('[data-products-edit]')) {
      event.preventDefault();
      form.querySelectorAll('[data-product-row]').forEach((row) => {
        const product = state.products.find((item) => item.id === row.dataset.productRow);
        if (product) {
          product.name = row.querySelector('[name="name"]').value;
          product.category = row.querySelector('[name="category"]').value;
          product.unitPrice = Number(row.querySelector('[name="unitPrice"]').value);
          product.calculationType = row.querySelector('[name="calculationType"]').value || 'sqft';
          product.minimumSqft = Number(row.querySelector('[name="minimumSqft"]').value);
          product.active = row.querySelector('[name="active"]').value === 'true';
        }
      });
      save();
      render();
    }
    if (form.matches('[data-settings]')) { event.preventDefault(); state.companySettings[0] = { id: 'company', name: form.name.value, phone: form.phone.value }; save(); render(); }
    if (form.matches('[data-supabase]')) { event.preventDefault(); localStorage.setItem(CLOUD_KEY, JSON.stringify({ url: form.url.value, key: form.key.value })); syncCloud().then(render); }
  });

  document.addEventListener('click', (event) => {
    const el = event.target;
    if (el.matches('[data-route]')) route(el.dataset.route);
    if (el.matches('[data-lang]')) { state.lang = state.lang === 'en' ? 'zh' : 'en'; save(); render(); }
    if (el.matches('[data-logout]')) logout();
    if (el.matches('[data-new-quote]')) { const q = seedQuote('Q-' + Date.now().toString().slice(-5), 0); state.ui.selectedQuotationId = q.id; render(); }
    if (el.matches('[data-restore-products]')) { if (prompt('Type RESTORE PRODUCTS to confirm') === 'RESTORE PRODUCTS') { restoreDefaultProducts(true); render(); } }
    if (el.matches('[data-select-quote]')) { state.ui.selectedQuotationId = el.dataset.selectQuote; render(); }
    if (el.matches('[data-add-item]')) { el.closest('form').querySelector('[data-items]').insertAdjacentHTML('beforeend', itemFields()); }
    if (el.matches('[data-print-quote]')) printQuotation(el.dataset.printQuote);
    if (el.matches('[data-convert]')) { convertQuotation(el.dataset.convert); state.ui.page = 'orders'; render(); }
    if (el.matches('[data-delete-quote]')) deleteQuotation(el.dataset.deleteQuote);
    if (el.matches('[data-prod]')) { sendToProduction(el.dataset.prod); render(); }
    if (el.matches('[data-complete-prod]')) { markProductionCompleted(el.dataset.completeProd); render(); }
    if (el.matches('[data-inst]')) { sendToInstaller(el.dataset.inst); render(); }
    if (el.matches('[data-schedule]')) { scheduleInstallation(el.dataset.schedule); render(); }
    if (el.matches('[data-finish-install]')) { const amount = prompt('Amount collected', '0') || 0; const touch = confirm('Touch up required?'); completeInstallation(el.dataset.finishInstall, amount, touch); render(); }
    if (el.matches('[data-follow]')) { moveBackToFollowUp(el.dataset.follow); render(); }
    if (el.matches('[data-archive]')) { const order = state.orders.find((o) => o.id === el.dataset.archive); if (order) order.status = 'archived'; save(); render(); }
    if (el.matches('[data-warranty]')) printWarranty(el.dataset.warranty);
    if (el.matches('[data-page]')) { state.ui.orderPage = Number(el.dataset.page); save(); render(); }
    if (el.matches('[data-export]')) { navigator.clipboard.writeText(JSON.stringify(state, null, 2)); alert('Backup copied to clipboard'); }
    if (el.matches('[data-import]')) { if (prompt('Type RESTORE to confirm') === 'RESTORE') { state = JSON.parse(document.querySelector('[data-import-text]').value); save(); render(); } }
    if (el.matches('[data-v2-backup]')) downloadText('eco-screen-crm-stable-backup-before-v2-import.json', stableBackupText());
    if (el.matches('[data-v2-preview]')) {
      const migration = state.ui.migration || {};
      if (!migration.rawText) return alert('Select Old V2 Backup JSON first.');
      try {
        migration.preview = previewOldV2Backup(JSON.parse(migration.rawText), migrationOptions());
        migration.selectedIds = migration.preview.rows.filter((row) => row.selected).map((row) => row.id);
        migration.page = 1;
        migration.progress = null;
        migration.result = null;
        state.ui.migration = migration;
        save();
        render();
      } catch (error) {
        alert('Could not read Old V2 backup JSON: ' + error.message);
      }
    }
    if (el.matches('[data-v2-import]')) {
      const migration = state.ui.migration || {};
      if (!migration.preview || !migration.rawText) return alert('Preview import first.');
      const selectedIds = migration.selectedIds || [];
      const beforeBackup = stableBackupText();
      downloadText('eco-screen-crm-stable-auto-backup-before-v2-import.json', beforeBackup);
      migration.progress = { imported: 0, total: selectedIds.length };
      state.ui.migration = migration;
      save();
      const result = importOldV2Backup(JSON.parse(migration.rawText), selectedIds, { ...migrationOptions(), preview: migration.preview });
      migration.result = result;
      migration.progress = { imported: result.imported, total: selectedIds.length };
      migration.preview = previewOldV2Backup(JSON.parse(migration.rawText), migrationOptions());
      migration.selectedIds = migration.preview.rows.filter((row) => row.selected).map((row) => row.id);
      state.ui.migration = migration;
      save();
      render();
    }
    if (el.matches('[data-v2-page]')) { state.ui.migration.page = Math.max(1, Number(el.dataset.v2Page)); save(); render(); }
    if (el.matches('[data-v2-select-all]')) {
      const preview = state.ui.migration.preview;
      setMigrationSelectedIds(preview.rows.filter((row) => row.importable).map((row) => row.id));
      save();
      render();
    }
    if (el.matches('[data-v2-unselect-all]')) { setMigrationSelectedIds([]); save(); render(); }
    if (el.matches('[data-v2-select-page]')) {
      const ids = currentMigrationSelectedIds();
      filteredMigrationRows(state.ui.migration.preview, state.ui.migration)
        .slice(((state.ui.migration.page || 1) - 1) * 20, (state.ui.migration.page || 1) * 20)
        .filter((row) => row.importable)
        .forEach((row) => ids.add(row.id));
      setMigrationSelectedIds(ids);
      save();
      render();
    }
    if (el.matches('[data-v2-unselect-page]')) {
      const ids = currentMigrationSelectedIds();
      filteredMigrationRows(state.ui.migration.preview, state.ui.migration)
        .slice(((state.ui.migration.page || 1) - 1) * 20, (state.ui.migration.page || 1) * 20)
        .forEach((row) => ids.delete(row.id));
      setMigrationSelectedIds(ids);
      save();
      render();
    }
    if (el.matches('[data-quote-page]')) { state.ui.quotationPage = Math.max(1, Number(el.dataset.quotePage)); save(); render(); }
  });

  document.addEventListener('input', (event) => {
    if (event.target.matches('[data-order-search]')) { state.ui.orderSearch = event.target.value; state.ui.orderPage = 1; save(); render(); }
    if (event.target.matches('[data-order-status]')) { state.ui.orderStatus = event.target.value; state.ui.orderPage = 1; save(); render(); }
    if (event.target.matches('[data-quote-search]')) { state.ui.quotationSearch = event.target.value; state.ui.quotationPage = 1; save(); render(); }
    if (event.target.matches('[data-quote-status]')) { state.ui.quotationStatus = event.target.value; state.ui.quotationPage = 1; save(); render(); }
    if (event.target.matches('[data-v2-option]')) {
      state.ui.migration = state.ui.migration || {};
      state.ui.migration[event.target.dataset.v2Option] = event.target.checked;
      state.ui.migration.preview = null;
      state.ui.migration.selectedIds = [];
      save();
      render();
    }
    if (event.target.matches('[data-v2-search]')) { state.ui.migration.search = event.target.value; state.ui.migration.page = 1; save(); render(); }
    if (event.target.matches('[data-v2-filter]')) { state.ui.migration.filter = event.target.value; state.ui.migration.page = 1; save(); render(); }
    if (event.target.matches('[data-v2-select]')) {
      const ids = currentMigrationSelectedIds();
      if (event.target.checked) ids.add(event.target.dataset.v2Select);
      else ids.delete(event.target.dataset.v2Select);
      setMigrationSelectedIds(ids);
      save();
    }
  });

  document.addEventListener('change', (event) => {
    if (event.target.matches('[data-v2-file]')) {
      const file = event.target.files && event.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        state.ui.migration = { ...state.ui.migration, rawText: String(reader.result || ''), fileName: file.name, preview: null, result: null };
        save();
        render();
      };
      reader.readAsText(file);
    }
  });

  render();
})();
