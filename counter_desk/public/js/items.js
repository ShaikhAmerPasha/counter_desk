/* Items: list, create/edit form, stock dashboard, stock adjustment. */
(function () {
	const CD = window.CD, { $, $$, esc, flt, money, F, T } = CD;
	const st = (CD.state = CD.state || {}); st.items = st.items || { q: "", g: "All", s: "All" };
	const naming = () => CD.boot.item_naming_by === "Naming Series";

	const SCHEMA = { tabs: [
		{ l: "Details", secs: [
			{ nolabel: 1, cols: [
				[F("Data", "item_code", "Item Code", { req: 1, ph: "", roIf: (d) => d.__saved || naming(), desc: "" }), F("Data", "item_name", "Item Name", { req: 1 }), F("Link", "item_group", "Item Group", { o: "Item Group", req: 1 }), F("Link", "stock_uom", "Default Unit of Measure", { o: "UOM", req: 1, roIf: (d) => d.__saved && d.has_transactions })],
				[F("Check", "disabled", "Disabled"), F("Check", "allow_alternative_item", "Allow Alternative Item"), F("Check", "is_stock_item", "Maintain Stock"), F("Check", "include_item_in_manufacturing", "Include Item In Manufacturing"),
					F("Float", "opening_stock", "Opening Stock", { dep: (d) => !d.__saved && d.is_stock_item, desc: "Posted to the default warehouse when you save." }), F("Currency", "valuation_rate", "Valuation Rate", { dep: (d) => d.is_stock_item }), F("Currency", "standard_rate", "Standard Selling Rate")]] },
			{ l: "Description", cols: [[F("Link", "brand", "Brand", { o: "Brand" })], [F("Text", "description", "Description", { rows: 4 })]] },
			{ l: "Barcodes", foot: [T("barcodes", "Barcodes", [F("Data", "barcode", "Barcode", { req: 1, w: 200 }), F("Select", "barcode_type", "Barcode Type", { o: ["", "EAN", "UPC-A", "CODE-39", "EAN-8", "GS1", "GTIN", "ISBN", "JAN"], w: 140 }), F("Link", "uom", "UOM", { o: "UOM", w: 110 })], { tools: () => '<button class="btn sm" data-act="genbc">Generate EAN-13</button>' })] }] },
		{ l: "Inventory", dep: (d) => d.is_stock_item, secs: [
			{ cols: [[F("Int", "shelf_life_in_days", "Shelf Life In Days"), F("Date", "end_of_life", "End of Life"), F("Select", "valuation_method", "Valuation Method", { o: ["", "FIFO", "Moving Average", "LIFO"] })], [F("Data", "warranty_period", "Warranty Period (in days)"), F("Float", "weight_per_unit", "Weight Per Unit"), F("Link", "weight_uom", "Weight UOM", { o: "UOM" }), F("Check", "allow_negative_stock", "Allow Negative Stock")]] },
			{ l: "Auto re-order", foot: [T("reorder_levels", "Reorder level based on Warehouse", [F("Link", "warehouse", "Request for", { o: "Warehouse", w: 200, req: 1 }), F("Float", "warehouse_reorder_level", "Re-order Level", { w: 110 }), F("Float", "warehouse_reorder_qty", "Re-order Qty", { w: 110 }), F("Select", "material_request_type", "Material Request Type", { o: ["Purchase", "Transfer", "Material Issue", "Manufacture"], w: 170 })], { newRow: () => ({ warehouse: CD.boot.settings.warehouse, warehouse_reorder_level: 0, warehouse_reorder_qty: 0, material_request_type: "Purchase" }) })] },
			{ l: "Units of Measure", foot: [T("uoms", "UOMs", [F("Link", "uom", "UOM", { o: "UOM", req: 1, w: 140 }), F("Float", "conversion_factor", "Conversion Factor", { w: 140 })], { newRow: () => ({ uom: "", conversion_factor: 1 }) })] },
			{ l: "Serial Nos and Batches", col: 1, shut: 1, cols: [[F("Check", "has_batch_no", "Has Batch No"), F("Check", "create_new_batch", "Automatically Create New Batch", { dep: (d) => d.has_batch_no }), F("Check", "has_expiry_date", "Has Expiry Date", { dep: (d) => d.has_batch_no })], [F("Check", "has_serial_no", "Has Serial No"), F("Data", "serial_no_series", "Serial Number Series", { dep: (d) => d.has_serial_no })]] }] },
		{ l: "Sales", secs: [{ nolabel: 1, cols: [[F("Link", "sales_uom", "Default Sales Unit of Measure", { o: "UOM" }), F("Check", "is_sales_item", "Allow Sales")], [F("Float", "max_discount", "Max Discount (%)"), F("Check", "grant_commission", "Grant Commission")]] }] },
		{ l: "Accounting", secs: [{ nolabel: 1, foot: [T("item_defaults", "Item Defaults", [F("Link", "company", "Company", { o: "Company", w: 150, ro: 1 }), F("Link", "default_warehouse", "Default Warehouse", { o: "Warehouse", w: 190 }), F("Link", "default_price_list", "Default Price List", { o: "Price List", w: 150 }), F("Link", "income_account", "Default Income Account", { o: "Account", flt: "Income Account", w: 200 }), F("Link", "selling_cost_center", "Default Selling Cost Center", { o: "Cost Center", w: 170 })], { newRow: () => ({ company: CD.boot.company.name }) })] }] },
		{ l: "Tax", secs: [{ nolabel: 1, foot: [T("taxes", "Taxes", [F("Link", "item_tax_template", "Item Tax Template", { o: "Item Tax Template", w: 220 }), F("Link", "tax_category", "Tax Category", { o: "Tax Category", w: 170 }), F("Date", "valid_from", "Valid From", { w: 140 }), F("Float", "minimum_net_rate", "Minimum Net Rate", { w: 130 })])] }] },
		{ l: "Dashboard", html: "idash" }] };

	function blank() {
		const b = CD.boot, s = b.settings;
		return { __saved: false, item_code: "", item_name: "", item_group: "", stock_uom: b.uoms.includes("Nos") ? "Nos" : (b.uoms[0] || ""), disabled: 0, allow_alternative_item: 0, is_stock_item: 1, include_item_in_manufacturing: 0, opening_stock: 0, valuation_rate: 0, standard_rate: 0, brand: "", description: "",
			barcodes: [], uoms: [], reorder_levels: [], taxes: [], item_defaults: [{ company: b.company.name, default_warehouse: s.warehouse, default_price_list: s.price_list, income_account: "", selling_cost_center: b.company.cost_center }], sales_uom: "", is_sales_item: 1, max_discount: 0, grant_commission: 1, valuation_method: "", end_of_life: "", allow_negative_stock: 0, stock: { bins: [], moves: [] } };
	}
	function dash(f) {
		const it = f.doc; if (!it.__saved) return '<section class="sec"><div class="sbody" style="padding-top:16px"><p class="muted" style="margin:0">Save the item to see stock by warehouse and recent movements.</p></div></section>';
		if (!it.is_stock_item) return '<section class="sec"><div class="sbody" style="padding-top:16px"><p class="muted" style="margin:0">This item does not maintain stock.</p></div></section>';
		const bins = it.stock.bins, moves = it.stock.moves;
		return '<section class="sec"><h3>Stock by warehouse</h3><div class="sbody scroll"><table class="tbl"><thead><tr><th>Warehouse</th><th class="r">Actual Qty</th><th class="r">Reserved</th><th class="r">Projected</th><th class="r">Reorder level</th><th>Status</th></tr></thead><tbody>' +
			bins.map((b) => '<tr><td>' + esc(b.warehouse) + '</td><td class="r num">' + b.actual_qty + '</td><td class="r num">' + b.reserved_qty + '</td><td class="r num">' + b.projected_qty + '</td><td class="r num">' + b.reorder_level + '</td><td>' + (b.actual_qty <= 0 ? '<span class="pill bad">Out of stock</span>' : b.actual_qty <= b.reorder_level ? '<span class="pill warn">Low</span>' : '<span class="pill ok">OK</span>') + "</td></tr>").join("") + "</tbody></table></div></section>" +
			'<section class="sec"><h3>Recent stock movements</h3><div class="sbody scroll"><table class="tbl"><thead><tr><th>Date</th><th>Voucher</th><th>Warehouse</th><th class="r">Qty</th><th class="r">Balance</th></tr></thead><tbody>' +
			(moves.map((m) => '<tr><td class="num">' + m.posting_date + "</td><td>" + esc(m.voucher_type) + ' <span class="num muted">' + esc(m.voucher_no) + "</span></td><td>" + esc(m.warehouse) + '</td><td class="r num" style="color:' + (m.actual_qty < 0 ? "var(--bad)" : "var(--ok)") + '">' + (m.actual_qty > 0 ? "+" : "") + m.actual_qty + '</td><td class="r num">' + m.qty_after_transaction + "</td></tr>").join("") || '<tr><td colspan="5" class="empty">No movements yet.</td></tr>') + "</tbody></table></div></section>";
	}
	const eanCheck = () => { let n = "628"; while (n.length < 12) n += Math.floor(Math.random() * 10); let s = 0; for (let i = 0; i < 12; i++) s += +n[i] * (i % 2 ? 3 : 1); return n + ((10 - (s % 10)) % 10); };

	function hooks() { return {
		head: (f) => { const d = f.doc; return { title: d.__saved ? d.item_name || d.item_code : "New Item", unsaved: !d.__saved, status: '<span class="pill ' + (d.disabled ? "bad" : "ok") + '">' + (d.disabled ? "Disabled" : "Enabled") + "</span>", sub: d.__saved ? esc(d.name) + " · " + esc(d.item_group || "") : "Create and manage what you sell",
			acts: [].concat(d.__saved && d.is_stock_item ? [{ k: "adjust", l: "Adjust stock" }] : [], CD.boot.can.Item.write || !d.__saved ? [{ k: "save", l: "Save", primary: 1 }] : []) }; },
		locked: () => false,
		before: () => CD.resumeBanner("item"),
		click: (f, e) => { if (e.target.closest("[data-resume-cancel]")) CD.cancelFull(); },
		tabHtml: { idash: dash },
		change: (f, o, t, n) => { if (!t && n === "stock_uom" && !f.doc.uoms.some((u) => u.uom === f.doc.stock_uom)) { f.doc.uoms.unshift({ uom: f.doc.stock_uom, conversion_factor: 1 }); return "uoms"; } if (!t && n === "description") f._manualDesc = true; if (!t && n === "item_name" && !f.doc.__saved && !f._manualDesc) f.doc.description = f.doc.item_name; return null; },
		rail: (f) => { const it = f.doc, bins = it.stock.bins, tot = bins.reduce((s, b) => s + b.actual_qty, 0), mg = flt(it.standard_rate) ? CD.rnd((it.standard_rate - flt(it.valuation_rate)) / it.standard_rate * 100, 1) : 0;
			return '<div class="card sum"><span class="label">Stock on hand</span><div class="big num">' + (it.is_stock_item ? (it.__saved ? tot : 0) + " " + esc(it.stock_uom || "") : "Not tracked") + "</div>" + (it.is_stock_item ? bins.map((b) => '<div class="r"><span class="muted">' + esc(b.warehouse) + '</span><span class="num">' + b.actual_qty + "</span></div>").join("") + '<hr><div class="r"><span class="muted">Stock value</span><span class="num">' + money(bins.reduce((s, b) => s + b.actual_qty * (b.valuation_rate || it.valuation_rate || 0), 0)) + "</span></div>" : '<span class="muted">Service item. No stock ledger entries.</span>') + "</div>" +
				'<div class="card sum"><span class="label">Selling price</span><div class="big num">' + esc(CD.boot.company.currency) + " " + money(it.standard_rate) + "</div>" + (it.is_stock_item && flt(it.valuation_rate) ? '<div class="r"><span class="muted">Cost</span><span class="num">' + money(it.valuation_rate) + '</span></div><div class="r"><span class="muted">Margin</span><b class="num" style="color:' + (mg < 10 ? "var(--warn)" : "var(--ok)") + '">' + mg + "%</b></div>" : "") + (it.__saved && CD.pages["sales-invoice"] && CD.pages["sales-invoice"].newWith ? '<button class="btn" data-act="sell">Create Sales Invoice with this item</button>' : "") + "</div>"; },
		act: async (f, k) => {
			const d = f.doc;
			if (k === "save") return save(f);
			if (k === "genbc") { d.barcodes.push({ barcode: eanCheck(), barcode_type: "EAN", uom: d.stock_uom }); f.setDirty(); f.renderTable("barcodes"); f.refresh(); f.renderHead(); return; }
			if (k === "adjust") return adjust(f);
			if (k === "sell") return CD.pages["sales-invoice"].newWith({ item: d.name });
		},
	}; }
	function clean(d) { const o = CD.clone(d); delete o.stock; delete o.__saved; return o; }
	async function save(f) {
		const d = f.doc, miss = [], mf = [];
		if (!d.__saved && !naming() && !d.item_code) { miss.push("Item Code"); mf.push("item_code"); }
		if (!d.item_name && !d.item_code) { miss.push("Item Name"); mf.push("item_name"); }
		if (!d.item_group) { miss.push("Item Group"); mf.push("item_group"); }
		if (!d.stock_uom) { miss.push("Default Unit of Measure"); mf.push("stock_uom"); }
		if (miss.length) { f.markErr(mf); return CD.msg("Missing Fields", "Please fill the following: " + miss.join(", ")); }
		try {
			const r = await CD.call("item.save", { doc: JSON.stringify(clean(d)) });
			open_(r); CD.toast("Item " + (r.item_name || r.name) + " saved"); f.setDirty(false); CD.setTitle("Item", r.name, r.item_name); if (!CD.finishFull(r)) CD.go("item", r.name);
		} catch (e) { CD.fail(e, "Cannot save item"); }
	}
	function adjust(f) {
		const o = f.doc, b = CD.boot;
		CD.dlg({ title: "Adjust stock · " + o.name, body: '<label class="fld"><span class="lb">Warehouse</span><select class="in" id="sw">' + b.warehouses.map((w) => "<option>" + esc(w) + "</option>").join("") + '</select></label><div class="card" style="padding:12px 14px;display:flex;justify-content:space-between"><span class="muted">Current quantity</span><b class="num" id="scur"></b></div><label class="fld"><span class="lb">New quantity *</span><input class="in num" id="sq" type="number" step="any"></label><label class="fld"><span class="lb">Valuation Rate</span><input class="in num" id="sv" type="number" step="any" value="' + (o.valuation_rate || "") + '"></label><p class="muted" style="margin:0;font-size:12px">Posts a Stock Reconciliation. The difference goes to Stock Adjustment.</p>',
			after: () => { const cur = () => { const bn = o.stock.bins.find((x) => x.warehouse === $("#sw").value); $("#scur").textContent = bn ? bn.actual_qty : 0; $("#sq").value = bn ? bn.actual_qty : 0; }; $("#sw").onchange = cur; $("#sw").value = b.settings.warehouse || b.warehouses[0]; cur(); },
			actions: [{ l: "Cancel" }, { l: "Post adjustment", primary: 1, fn: async () => {
				const q = $("#sq").value; if (q === "" || flt(q) < 0) { CD.toast("Enter the new quantity"); return false; }
				try { const r = await CD.call("item.adjust_stock", { item_code: o.name, warehouse: $("#sw").value, qty: q, valuation_rate: $("#sv").value }); o.stock = r.stock; CD.toast("Stock adjusted · " + r.name); f.renderTab(); f.refresh(); f.renderRail(); } catch (e) { CD.fail(e, "Cannot adjust stock"); return false; } } }] });
	}
	function open_(data) { const d = Object.assign({}, data, { __saved: true }); if (!d.item_defaults.length) d.item_defaults = blank().item_defaults; CD.setTitle("Item", d.name, d.item_name); return d; }
	function show(doc) {
		const f = new CD.Form({ dt: "Item", dtLabel: "Item", dtk: "item", schema: SCHEMA, doc, hooks: hooks() }); f.mount(); return f;
	}

	/* ---------- list ---------- */
	let rows = [], more = false;
	async function load(reset) {
		const s = st.items;
		const r = await CD.call("item.list", { txt: s.q, group: s.g, stock: s.s, start: reset ? 0 : rows.length, page_len: 30 });
		rows = reset ? r.rows : rows.concat(r.rows); more = r.more; CD.setCount("item", r.total); return r;
	}
	function table() {
		$("#lcnt").textContent = rows.length + (more ? "+" : "") + " shown";
		$("#lb").innerHTML = rows.map((i) => { const low = i.is_stock_item && i.qty <= i.reorder; return '<tr class="click" data-oi="' + esc(i.name) + '"><td><b>' + esc(i.item_name) + '</b><div class="num muted" style="font-size:12px">' + esc(i.name) + "</div></td><td>" + esc(i.item_group) + "</td><td>" + esc(i.stock_uom) + '</td><td class="r num">' + money(i.rate) + '</td><td class="r num">' + (i.is_stock_item ? i.qty : "—") + "</td><td>" +
			(i.disabled ? '<span class="pill n">Disabled</span>' : !i.is_stock_item ? '<span class="pill info">Service</span>' : i.qty <= 0 ? '<span class="pill bad">Out of stock</span>' : low ? '<span class="pill warn">Low</span>' : '<span class="pill ok">In stock</span>') + "</td></tr>"; }).join("") || '<tr><td colspan="6" class="empty">No items match.</td></tr>';
		$("#more").hidden = !more;
	}
	async function list() {
		CD.form = null; const s = st.items;
		CD.main().innerHTML = CD.crumbs("<span>Stock</span><span>/</span><span>Item</span>") + '<div class="page"><div class="lhead"><h1>Items</h1>' + (CD.boot.can.Item.create ? '<button class="btn primary" id="newIt">+ Add Item</button>' : "") + '</div><div class="filters"><input class="in" id="lq" placeholder="Search code, name or barcode" aria-label="Search" value="' + esc(s.q) + '" style="min-width:260px"><select class="in" id="lg" aria-label="Item group">' +
			["All"].concat(CD.boot.item_groups).map((g) => "<option" + (g === s.g ? " selected" : "") + ">" + esc(g) + "</option>").join("") + '</select><select class="in" id="lst" aria-label="Stock">' + ["All", "In stock", "Low / out of stock", "Disabled"].map((g) => "<option" + (g === s.s ? " selected" : "") + ">" + g + "</option>").join("") +
			'</select><span class="muted" id="lcnt" style="margin-left:auto"></span></div><div class="card scroll"><table class="tbl"><thead><tr><th>Item</th><th>Group</th><th>UOM</th><th class="r">Selling rate</th><th class="r">In stock</th><th>Status</th></tr></thead><tbody id="lb"><tr><td colspan="6" class="empty">Loading…</td></tr></tbody></table></div><button class="btn" id="more" hidden style="justify-self:center">Load more</button></div>';
		let tm = 0; const re = () => load(true).then(table).catch((e) => CD.fail(e));
		$("#lq").oninput = (e) => { s.q = e.target.value; clearTimeout(tm); tm = setTimeout(re, 250); };
		$("#lg").onchange = (e) => { s.g = e.target.value; re(); }; $("#lst").onchange = (e) => { s.s = e.target.value; re(); };
		$("#more").onclick = () => load(false).then(table).catch((e) => CD.fail(e));
		if ($("#newIt")) $("#newIt").onclick = () => CD.nav("item", "__new");
		$("#lb").onclick = (e) => { const r = e.target.closest("[data-oi]"); if (r) CD.nav("item", r.dataset.oi); };
		$("#cmdk").onclick = () => CD.palette && CD.palette(); await re();
	}
	CD.page("item", {
		list,
		open: async (name) => { if (name === "__new") { const b = blank(); if (CD.prefill) { Object.assign(b, CD.prefill); CD.prefill = null; } const f = show(b); f.setDirty(true); f.renderHead(); return f; } const r = await CD.call("item.get", { name }); show(open_(r)); },
		show, blank,
	});
})();
