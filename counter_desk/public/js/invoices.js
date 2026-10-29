/* Sales Invoice: list, document form with server-side totals, submit/cancel/return, ZATCA status, print preview. */
(function () {
	const CD = window.CD, { $, $$, esc, flt, rnd, money, F, T } = CD;
	const st = (CD.state = CD.state || {}); st.si = st.si || { q: "", tab: "All", per: "All", sort: "date", dir: "desc", sel: {} };
	const cur = () => CD.boot.company.currency;
	const STC = { Draft: "n", Cancelled: "bad", Return: "n", "Credit Note Issued": "n", Paid: "ok", Overdue: "bad", "Overdue and Discounted": "bad", "Partly Paid": "warn", Unpaid: "warn", "Unpaid and Discounted": "warn", "Partly Paid and Discounted": "warn", Submitted: "info" };
	const zc = (s) => (/^(reported|cleared)$/i.test(s || "") ? "ok" : !s || /not submitted/i.test(s) ? "n" : /pending|process/i.test(s) ? "warn" : "bad");
	const zerr = (d) => { let r = d.custom_zatca_full_response; if (!r) return ""; try { const j = typeof r === "string" ? JSON.parse(r) : r; const e = ((j.validationResults || {}).errorMessages || [])[0]; if (e) return (e.code ? e.code + ": " : "") + (e.message || ""); } catch (x) { /* plain text */ } return String(r).slice(0, 180); };
	const zdone = (s) => /^(reported|cleared)$/i.test(s || "");
	CD.sidebarStatus = STC;

	/* ---------- schema ---------- */
	const itemCols = [F("Link", "item_code", "Item code", { o: "Item", w: 130, req: 1 }), F("Data", "item_name", "Name", { ro: 1, w: 170 }), F("Float", "qty", "Qty", { w: 70 }), F("Link", "uom", "UOM", { o: "UOM", w: 80 }), F("Currency", "rate", "Rate", { w: 88 }), F("Percent", "discount_percentage", "Disc %", { w: 70 }),
		F("Currency", "amount", "Amount", { ro: 1, w: 96 }), F("Link", "warehouse", "Warehouse", { o: "Warehouse", w: 150, dep: (d) => d.update_stock }), F("Float", "actual_qty", "In stock", { ro: 1, w: 70, dep: (d) => d.update_stock })];
	const itemDetail = [F("Text", "description", "Description"), F("Data", "barcode", "Barcode"), F("Float", "conversion_factor", "UOM Conversion Factor"), F("Float", "stock_qty", "Qty as per Stock UOM", { ro: 1 }), F("Currency", "price_list_rate", "Price List Rate", { ro: 1 }),
		F("Select", "margin_type", "Margin Type", { o: ["", "Percentage", "Amount"] }), F("Float", "margin_rate_or_amount", "Margin Rate or Amount", { dep: (d, r) => r.margin_type }), F("Currency", "rate_with_margin", "Rate With Margin", { ro: 1, dep: (d, r) => r.margin_type }),
		F("Currency", "discount_amount", "Discount Amount"), F("Currency", "net_rate", "Net Rate", { ro: 1 }), F("Currency", "net_amount", "Net Amount", { ro: 1 }), F("Link", "income_account", "Income Account", { o: "Account", flt: "Income Account" }), F("Link", "cost_center", "Cost Center", { o: "Cost Center" }),
		F("Link", "item_tax_template", "Item Tax Template", { o: "Item Tax Template" }), F("Link", "warehouse", "Warehouse", { o: "Warehouse" }), F("Check", "allow_zero_valuation_rate", "Allow Zero Valuation Rate"), F("Check", "page_break", "Page Break")];
	const taxCols = [F("Select", "charge_type", "Type", { o: ["Actual", "On Net Total", "On Previous Row Amount", "On Previous Row Total", "On Item Quantity"], w: 170 }), F("Int", "row_id", "Ref Row #", { w: 70, dep: (d) => d.taxes.some((t) => /Previous/.test(t.charge_type)) }), F("Link", "account_head", "Account Head", { o: "Account", w: 160 }),
		F("Data", "description", "Description", { w: 170 }), F("Check", "included_in_print_rate", "Incl. in rate", { w: 80 }), F("Float", "rate", "Tax Rate", { w: 80 }), F("Currency", "tax_amount", "Amount", { w: 100 }), F("Currency", "total", "Total", { ro: 1, w: 100 })];
	const SCHEMA = { tabs: [
		{ l: "Invoice", secs: [
			{ nolabel: 1, cols: [
				[F("Link", "customer", "Customer", { o: "Customer", req: 1 }), F("Data", "tax_id", "VAT number", { ro: 1, dep: (d) => d.customer }), F("Check", "is_pos", "Take payment now (POS)", { roIf: (d) => d.is_return }), F("Check", "is_return", "Is Return (Credit Note)", { ro: 1 })],
				[F("Date", "posting_date", "Invoice date", { req: 1, roIf: (d) => !d.set_posting_time }), F("Link", "payment_terms_template", "Payment terms", { o: "Payment Terms Template", dep: (d) => !d.is_pos && !d.is_return }), F("Date", "due_date", "Due date", { dep: (d) => !d.is_pos }), F("Link", "selling_price_list", "Price list", { o: "Price List", req: 1 })],
				[F("Check", "set_posting_time", "Edit posting time"), F("Time", "posting_time", "Posting time", { dep: (d) => d.set_posting_time }), F("Link", "return_against", "Return against", { o: "Sales Invoice", dep: (d) => d.is_return, ro: 1 }), F("Link", "amended_from", "Amended from", { o: "Sales Invoice", ro: 1, dep: (d) => d.amended_from })]] },
			{ l: "Items", cols: [[F("Link", "scan_barcode", "Add item", { o: "ItemAdd", ph: "Search by name or code, or scan a barcode" })], [F("Check", "update_stock", "Update stock (deduct on submit)"), F("Link", "set_warehouse", "Source warehouse", { o: "Warehouse", dep: (d) => d.update_stock })]],
				foot: [T("items", "Items", itemCols, { detail: itemDetail, newRow: (f) => ({ item_code: "", qty: f.doc.is_return ? -1 : 1, uom: "", rate: 0, warehouse: f.doc.set_warehouse }), tools: () => '<span class="muted" style="font-size:12px">or use Add item above</span>' })] },
			{ l: "Taxes and discount", cols: [[F("Link", "taxes_and_charges", "Tax template", { o: "Sales Taxes and Charges Template" }), F("Select", "apply_discount_on", "Apply additional discount on", { o: ["Grand Total", "Net Total"] })], [F("Float", "additional_discount_percentage", "Additional discount %"), F("Currency", "discount_amount", "Additional discount amount")]] },
			{ l: "Totals", nolabel: 1, cols: [[F("Float", "total_qty", "Total quantity", { ro: 1 }), F("Currency", "total", "Total", { ro: 1 }), F("Currency", "net_total", "Net total", { ro: 1 }), F("Currency", "total_taxes_and_charges", "Total taxes", { ro: 1 })],
				[F("Currency", "grand_total", "Grand total", { ro: 1 }), F("Currency", "rounding_adjustment", "Rounding adjustment", { ro: 1, dep: (d) => !d.disable_rounded_total }), F("Currency", "rounded_total", "Rounded total", { ro: 1, dep: (d) => !d.disable_rounded_total }), F("Data", "in_words", "In words", { ro: 1 }), F("Check", "disable_rounded_total", "Disable rounded total")],
				[F("Currency", "total_advance", "Total advance", { ro: 1 }), F("Currency", "outstanding_amount", "Outstanding", { ro: 1 })]] },
			{ l: "Payment received", dep: (d) => d.is_pos, cols: [[F("Link", "cash_bank_account", "Cash/Bank Account", { o: "Account", flt: "Cash" }), F("Currency", "paid_amount", "Paid amount", { ro: 1 })], [F("Currency", "change_amount", "Change to give back", { ro: 1 }), F("Link", "account_for_change_amount", "Account for change", { o: "Account", flt: "Cash" })]],
				foot: [T("payments", "Sales Invoice Payment", [F("Link", "mode_of_payment", "Mode of Payment", { o: "Mode of Payment", w: 170, req: 1 }), F("Currency", "amount", "Amount", { w: 120 }), F("Link", "account", "Account", { o: "Account", ro: 1, w: 200 }), F("Data", "type", "Type", { ro: 1, w: 80 }), F("Data", "reference_no", "Reference No", { w: 140 })], { newRow: (f) => ({ mode_of_payment: "Cash", amount: Math.max(0, flt(f.doc.outstanding_amount)), account: modeAcct("Cash"), type: "Cash", reference_no: "" }) })] },
			{ l: "Payment schedule", col: 1, shut: 1, dep: (d) => !d.is_pos && !d.is_return && d.payment_schedule.length > 0, foot: [T("payment_schedule", "Payment Schedule", [F("Data", "payment_term", "Payment Term", { w: 140 }), F("Data", "description", "Description", { w: 160 }), F("Date", "due_date", "Due Date", { ro: 1, w: 130 }), F("Percent", "invoice_portion", "Invoice Portion", { w: 110 }), F("Currency", "payment_amount", "Payment Amount", { ro: 1, w: 120 })], { noadd: 1 })] },
			{ l: "Tax rows", col: 1, shut: 1, foot: [T("taxes", "Sales Taxes and Charges", taxCols, { newRow: () => ({ charge_type: "On Net Total", account_head: "", description: "", rate: 0, tax_amount: 0, total: 0 }) })] },
			{ l: "Notes", cols: [[F("Text", "remarks", "Remarks")], [F("Data", "po_no", "Customer's purchase order"), F("Date", "po_date", "PO date")]] }] },
		{ l: "Address & Contact", secs: [{ l: "Billing Address", cols: [[F("Link", "customer_address", "Customer Address", { o: "Address" }), F("Text", "address_display", "Address", { ro: 1 }), F("Link", "contact_person", "Contact Person", { o: "Contact" }), F("Text", "contact_display", "Contact", { ro: 1 }), F("Link", "territory", "Territory", { o: "Territory" })], [F("Link", "shipping_address_name", "Shipping Address Name", { o: "Address" }), F("Text", "shipping_address", "Shipping Address", { ro: 1 }), F("Link", "company_address", "Company Address Name", { o: "Address" })]] }] },
		{ l: "Accounting", secs: [{ l: "Document", cols: [[F("Link", "company", "Company", { o: "Company", ro: 1 })], [F("Link", "cost_center", "Cost Center", { o: "Cost Center" }), F("Link", "project", "Project", { o: "Project" })]] },
			{ l: "Currency and Price List", col: 1, shut: 1, cols: [[F("Link", "currency", "Currency", { o: "Currency", req: 1 }), F("Float", "conversion_rate", "Exchange Rate", { req: 1 })], [F("Link", "price_list_currency", "Price List Currency", { o: "Currency", ro: 1 }), F("Float", "plc_conversion_rate", "Price List Exchange Rate"), F("Check", "ignore_pricing_rule", "Ignore Pricing Rule")]] },
			{ l: "Accounting Details", cols: [[F("Link", "debit_to", "Debit To", { o: "Account", flt: "Receivable", req: 1 }), F("Select", "is_opening", "Is Opening Entry", { o: ["No", "Yes"] })], [F("Link", "campaign", "Campaign", { o: "Campaign" }), F("Link", "source", "Source", { o: "Lead Source" })]] },
			{ l: "Write Off", col: 1, shut: 1, cols: [[F("Currency", "write_off_amount", "Write Off Amount"), F("Check", "write_off_outstanding_amount_automatically", "Write Off Outstanding Amount")], [F("Link", "write_off_account", "Write Off Account", { o: "Account", flt: "Expense Account" }), F("Link", "write_off_cost_center", "Write Off Cost Center", { o: "Cost Center" })]] },
			{ l: "Commission", col: 1, shut: 1, cols: [[F("Link", "sales_partner", "Sales Partner", { o: "Sales Partner" })], [F("Float", "commission_rate", "Commission Rate (%)"), F("Currency", "total_commission", "Total Commission", { ro: 1 })]] }] },
		{ l: "Print & Terms", secs: [{ l: "Print Settings", cols: [[F("Link", "letter_head", "Letter Head", { o: "Letter Head" }), F("Check", "group_same_items", "Group same items")], [F("Link", "select_print_heading", "Print Heading", { o: "Print Heading" }), F("Select", "language", "Print Language", { o: ["", "en", "ar"] })]] },
			{ l: "Terms and Conditions", cols: [[F("Link", "tc_name", "Terms", { o: "Terms and Conditions" }), F("Text", "terms", "Terms and Conditions Details", { rows: 5 })], []] }] },
		{ l: "Connections", html: "conn" }] };
	const modeAcct = (m) => { const x = CD.boot.modes_of_payment.find((y) => y.name === m); return x ? x.account : ""; };
	const modeType = (m) => { const x = CD.boot.modes_of_payment.find((y) => y.name === m); return x ? x.type : ""; };

	/* ---------- server calls ---------- */
	const clean = (d) => { const o = CD.clone(d); ["pay_hist", "returns", "stock_moves", "timeline", "customer_title", "__saved", "custom_zatca_status", "custom_zatca_full_response"].forEach((k) => delete o[k]); return o; };
	const COMPUTED = ["total_qty", "total", "net_total", "total_taxes_and_charges", "grand_total", "rounding_adjustment", "rounded_total", "in_words", "total_advance", "outstanding_amount", "paid_amount", "change_amount", "due_date", "total_commission"];
	let calcSeq = 0, calcTimer = 0;
	function scheduleCalc(f) {
		clearTimeout(calcTimer); f.calcPending = true; const seq = ++calcSeq;
		calcTimer = setTimeout(async () => {
			try {
				const c = await CD.call("invoice.calculate", { doc: JSON.stringify(clean(f.doc)) });
				if (seq !== calcSeq || CD.form !== f) return;
				const d = f.doc; COMPUTED.forEach((k) => (d[k] = c[k]));
				if (!(flt(d.additional_discount_percentage) > 0 && f._discEdit === "amount")) { d.discount_amount = c.discount_amount; }
				if (c.items.length === d.items.length) c.items.forEach((r, i) => Object.assign(d.items[i], r));
				if (c.taxes.length === d.taxes.length) c.taxes.forEach((r, i) => Object.assign(d.taxes[i], r));
				const sameSched = c.payment_schedule.length === d.payment_schedule.length;
				d.payment_schedule = c.payment_schedule.map((r, i) => Object.assign({}, d.payment_schedule[i] || {}, r));
				f.calcPending = false; if (f._fillPay) { f._fillPay = false; if (d.payments[0]) d.payments[0].amount = Math.max(0, flt(d.grand_total)); scheduleCalc(f); }
				f.refresh(); f.renderHead(); f.renderRail(); if (!sameSched) f.renderTable("payment_schedule");
				pvSchedule(f);
			} catch (e) { f.calcPending = false; if (!e.network) CD.toast(e.message.slice(0, 120)); }
		}, 280);
	}
	async function fetchRow(f, row, extra) {
		const d = f.doc;
		const r = await CD.call("invoice.item_details", Object.assign({ item_code: row.item_code, qty: row.qty || 1, uom: row.uom || null, customer: d.customer, selling_price_list: d.selling_price_list, warehouse: row.warehouse || d.set_warehouse, posting_date: d.posting_date, update_stock: d.update_stock, is_return: d.is_return }, extra || {}));
		const keep = flt(row.qty) || (d.is_return ? -1 : 1);
		["item_name", "description", "uom", "stock_uom", "conversion_factor", "price_list_rate", "rate", "discount_percentage", "discount_amount", "warehouse", "income_account", "expense_account", "cost_center", "item_tax_template", "item_tax_rate", "margin_type", "margin_rate_or_amount", "actual_qty", "barcode"].forEach((k) => { if (r[k] !== undefined) row[k] = r[k]; });
		row.qty = keep; row.is_stock_item = r.is_stock_item; row.max_discount = r.max_discount;
		if (!d.update_stock || !r.is_stock_item) row.warehouse = r.is_stock_item ? row.warehouse : "";
	}
	async function applyParty(f) {
		const d = f.doc; if (!d.customer) return;
		const p = await CD.call("invoice.party_details", { customer: d.customer, posting_date: d.posting_date });
		CD.setTitle("Customer", d.customer, p.customer_name);
		Object.keys(p).forEach((k) => { if (k !== "due_date" && p[k] !== undefined) d[k] = p[k]; });
		if (d.is_pos || d.is_return) d.payment_terms_template = "";
		if (p.taxes_and_charges) d.taxes = await CD.call("invoice.tax_rows", { template: p.taxes_and_charges });
		for (const r of d.items) if (r.item_code) { const q = r.qty; await fetchRow(f, r); r.qty = q; }
	}

	/* ---------- form hooks ---------- */
	const SIMPLE_ROW_RECALC = ["qty", "rate", "discount_percentage", "discount_amount", "margin_type", "margin_rate_or_amount", "conversion_factor"];
	function rowSync(o, n) {
		const plr = flt(o.price_list_rate), mt = o.margin_type, mv = flt(o.margin_rate_or_amount);
		const rwm = plr ? plr + (mt === "Percentage" ? plr * mv / 100 : mt === "Amount" ? mv : 0) : 0;
		if (n === "rate" && rwm) { o.discount_amount = rnd(rwm - flt(o.rate), 4); o.discount_percentage = rwm ? rnd(o.discount_amount / rwm * 100, 4) : 0; }
		else if (n === "discount_percentage" && rwm) { o.discount_amount = rnd(rwm * flt(o.discount_percentage) / 100, 4); o.rate = rnd(rwm - o.discount_amount, 4); }
		else if (n === "discount_amount" && rwm) { o.discount_percentage = rnd(flt(o.discount_amount) / rwm * 100, 4); o.rate = rnd(rwm - flt(o.discount_amount), 4); }
		else if ((n === "margin_type" || n === "margin_rate_or_amount") && rwm) o.rate = rnd(rwm - flt(o.discount_amount), 4);
		o.amount = rnd(flt(o.qty) * flt(o.rate));
	}
	async function change(f, o, t, n) {
		const d = f.doc;
		try {
			if (!t) {
				if (n === "customer") { await applyParty(f); scheduleCalc(f); return "tab"; }
				if (n === "taxes_and_charges") { d.taxes = await CD.call("invoice.tax_rows", { template: d.taxes_and_charges }); scheduleCalc(f); return "taxes"; }
				if (n === "selling_price_list") { for (const r of d.items) if (r.item_code) { const q = r.qty; await fetchRow(f, r); r.qty = q; } scheduleCalc(f); return "items"; }
				if (n === "update_stock") { scheduleCalc(f); return "items"; }
				if (n === "set_warehouse") { d.items.forEach((r) => { if (r.is_stock_item !== 0 && r.item_code) r.warehouse = d.set_warehouse; }); scheduleCalc(f); return "items"; }
				if (n === "is_pos") { if (d.is_pos) { d.payment_terms_template = ""; d.payment_schedule = []; if (!d.payments.length) d.payments = [{ mode_of_payment: "Cash", amount: 0, account: modeAcct("Cash"), type: "Cash", reference_no: "" }]; } else d.payments = []; f._fillPay = d.is_pos; scheduleCalc(f); return "tab"; }
				if (n === "set_posting_time" && !d.set_posting_time) d.posting_date = CD.today;
				if (n === "discount_amount") { d.additional_discount_percentage = 0; f._discEdit = "amount"; }
				if (n === "additional_discount_percentage") { f._discEdit = "pct"; }
				if (n === "payment_terms_template") { scheduleCalc(f); return "payment_schedule"; }
				scheduleCalc(f); return null;
			}
			if (t === "items") {
				if (n === "item_code") { if (!o.item_code) return null; try { await fetchRow(f, o); } catch (e) { o.item_code = ""; throw e; } scheduleCalc(f); return "items"; }
				if (n === "uom") { const q = o.qty; await fetchRow(f, o, { uom: o.uom }); o.qty = q; scheduleCalc(f); return "items"; }
				if (n === "warehouse") { const r = await CD.call("invoice.item_details", { item_code: o.item_code, qty: o.qty, uom: o.uom, customer: d.customer, selling_price_list: d.selling_price_list, warehouse: o.warehouse, posting_date: d.posting_date, update_stock: d.update_stock }); o.actual_qty = r.actual_qty; }
				if (SIMPLE_ROW_RECALC.includes(n)) { rowSync(o, n); const mx = flt(o.max_discount); if (n === "discount_percentage" && mx && flt(o.discount_percentage) > mx) CD.toast("Maximum discount for " + o.item_code + " is " + mx + "%"); }
				scheduleCalc(f); return null;
			}
			if (t === "payments" && n === "mode_of_payment") { o.account = modeAcct(o.mode_of_payment); o.type = modeType(o.mode_of_payment); }
			scheduleCalc(f);
		} catch (e) { CD.fail(e, "Could not update the invoice"); }
		return null;
	}
	async function addItem(f, code) {
		const d = f.doc, ex = d.items.find((r) => r.item_code === code);
		try {
			if (ex) ex.qty = flt(ex.qty) + (d.is_return ? -1 : 1);
			else { const row = { item_code: code, qty: d.is_return ? -1 : 1 }; d.items.push(row); await fetchRow(f, row); }
			f.setDirty(); rowSync(ex || d.items[d.items.length - 1], "qty"); scheduleCalc(f); f.renderTable("items"); f.refresh(); f.renderHead(); f.renderRail();
			CD.toast((CD.titleOf("Item", code) || code) + " added");
		} catch (e) { if (!ex) d.items.pop(); f.renderTable("items"); CD.fail(e, "Could not add item"); }
	}
	function ztext(d) { return CD.boot.zatca ? (d.custom_zatca_status || "Not Submitted") : ""; }
	function head(f) {
		const d = f.doc, ds = d.docstatus || 0, saved = !!d.name, s = d.status || "Draft", z = CD.boot.zatca;
		const can = CD.boot.can["Sales Invoice"], pay = ds === 1 && flt(d.outstanding_amount) > 0.005 && !d.is_return;
		const acts = [];
		if (ds === 0) { acts.push({ k: "menu", l: "···", html: "···" }); acts.push({ k: "save", l: "Save", primary: f.dirty || !saved }); if (saved && !f.dirty && can.submit) acts.push({ k: "submit", l: "Submit", primary: 1 }); }
		else if (ds === 1) { acts.push({ k: "menu", l: "···", html: "···" }); if (z && !zdone(d.custom_zatca_status) && d.custom_zatca_status !== "Pending") acts.push({ k: "retryz", l: "Retry ZATCA" }); acts.push({ k: "print", l: "Print", primary: !pay }); if (pay && CD.pages["payment-entry"] && CD.pages["payment-entry"].newFrom) acts.push({ k: "pay", l: "Record payment", primary: 1 }); }
		else acts.push({ k: "print", l: "Print" }, { k: "amend", l: "Amend", primary: 1 });
		return { title: d.name || "New Sales Invoice", unsaved: !saved, status: '<span class="pill ' + (STC[s] || "n") + '">' + esc(saved || ds ? s : "Draft") + "</span>",
			chips: z && ds === 1 ? '<span class="pill ' + zc(d.custom_zatca_status) + '" title="custom_zatca_status">ZATCA · ' + esc(d.custom_zatca_status || "Not Submitted") + "</span>" : "",
			sub: d.customer ? esc(CD.titleOf("Customer", d.customer)) + (d.tax_id ? " · VAT " + esc(d.tax_id) : "") : "", acts };
	}
	function journey(d) {
		const ds = d.docstatus || 0, z = CD.boot.zatca, zs = d.custom_zatca_status, s = d.status || "Draft";
		const steps = [["Draft", ds === 0 ? "cur" : "ok"], ["Submitted", ds === 1 ? "ok" : ds === 2 ? "bad" : ""]];
		if (z) steps.push(["ZATCA", ds !== 1 ? "" : zdone(zs) ? "ok" : /pending|process/i.test(zs || "") ? "warn" : !zs || /not submitted/i.test(zs) ? "warn" : "bad"]);
		steps.push(["Payment", ds !== 1 ? "" : s === "Paid" || s === "Credit Note Issued" ? "ok" : /Overdue/.test(s) ? "bad" : "warn"]);
		let m = "";
		if (ds === 0) m = d.name ? "Saved as draft. Check the preview, then submit." : "Not saved yet.";
		else if (ds === 2) m = "Cancelled. Amend to create a corrected copy.";
		else if (z && !zdone(zs)) m = '<span style="font-weight:600;color:var(--' + (/pending/i.test(zs || "") ? "warn" : "bad") + ')">ZATCA: ' + esc(zs || "Not Submitted") + '</span><span class="muted">' + (zerr(d) ? esc(zerr(d)) : /not submitted/i.test(zs || "Not Submitted") ? "This invoice has not reached ZATCA yet." : "Open Connections for the full response.") + '</span><div><button class="btn sm" data-act="retryz">Retry ZATCA</button></div>';
		else if (s === "Paid") m = "Fully paid.";
		else if (s === "Return") m = "Credit note against " + esc(d.return_against) + ".";
		else m = esc(cur()) + " " + money(d.outstanding_amount) + " due " + (d.due_date || "") + (/Overdue/.test(s) ? ' · <b style="color:var(--bad)">overdue</b>' : "");
		const canPay = ds === 1 && flt(d.outstanding_amount) > 0.005 && !d.is_return && CD.pages["payment-entry"] && CD.pages["payment-entry"].newFrom;
		return '<div class="card"><div class="journey" style="grid-template-columns:repeat(' + steps.length + ',1fr)">' + steps.map((x) => '<div class="jstep ' + x[1] + '"><i></i>' + x[0] + "</div>").join("") + '</div><div class="jmsg">' + m + (canPay ? '<div><button class="btn sm primary" data-act="pay">Record payment</button></div>' : "") + "</div></div>";
	}
	function rail(f) {
		const d = f.doc, ds = d.docstatus || 0, fm = CD.boot.print_formats["Sales Invoice"];
		const stock = d.update_stock ? d.items.filter((x) => x.item_code && x.is_stock_item !== 0) : [];
		let h = '<div class="pvp">' + journey(d) +
			'<div class="card sum"><span class="label">Grand total</span><div class="big num">' + esc(cur()) + " " + money(d.disable_rounded_total || !flt(d.rounded_total) ? d.grand_total : d.rounded_total) + (f.calcPending ? ' <small class="muted" style="font-size:12px;font-weight:500">updating…</small>' : "") + '</div><div class="r"><span class="muted">Net total</span><span class="num">' + money(d.net_total) + "</span></div>" + (flt(d.discount_amount) ? '<div class="r"><span class="muted">Discount</span><span class="num">−' + money(d.discount_amount) + "</span></div>" : "") +
			'<div class="r"><span class="muted">VAT</span><span class="num">' + money(d.total_taxes_and_charges) + "</span></div>" + (d.is_pos ? '<div class="r"><span class="muted">Paid</span><span class="num">' + money(d.paid_amount) + "</span></div>" + (flt(d.change_amount) ? '<div class="r"><span class="muted">Change</span><span class="num">' + money(d.change_amount) + "</span></div>" : "") : "") +
			'<hr><div class="r"><b>Outstanding</b><b class="num" style="color:' + (flt(d.outstanding_amount) > 0.005 ? "var(--warn)" : "var(--ok)") + '">' + money(d.outstanding_amount) + '</b></div><div class="muted" style="font-size:12px">' + esc(d.in_words || "") + "</div></div>" +
			'<div class="card"><div class="pvh"><span class="label">Live preview</span><span style="display:flex;gap:6px"><select id="pvf" class="in" aria-label="Print format" style="width:auto;min-height:30px;padding:3px 8px;max-width:160px"><option value="">Default format</option>' + fm.map((x) => "<option" + (x === f.pvFmt ? " selected" : "") + ">" + esc(x) + "</option>").join("") + '</select><button class="btn sm" data-act="print">Print</button></span></div><div class="pvbox2" id="pvbox2"><div class="pvempty muted">Add items to see the invoice.</div></div></div>';
		if (stock.length) h += '<div class="card zs"><span class="label">Stock impact</span>' + stock.map((x) => { const after = ds === 0 ? rnd(flt(x.actual_qty) - flt(x.stock_qty || x.qty), 3) : flt(x.actual_qty); const low = ds === 0 && after < 0; return '<div style="display:flex;justify-content:space-between;gap:8px;font-size:13px"><span style="min-width:0;overflow-wrap:anywhere">' + esc(x.item_code) + '</span><span class="num" style="' + (low ? "color:var(--bad);font-weight:700" : "") + '">' + (ds === 0 ? flt(x.actual_qty) + " → " + after : "−" + Math.abs(flt(x.stock_qty || x.qty))) + "</span></div>"; }).join("") + "</div>";
		if ((d.pay_hist || []).length) h += '<div class="card zs"><span class="label">Payments</span>' + d.pay_hist.map((p) => '<div style="display:flex;justify-content:space-between;gap:8px;font-size:13px;cursor:pointer" data-open-pe="' + esc(p.name) + '"><span><b class="num">' + esc(p.name) + '</b><div class="muted" style="font-size:12px">' + p.posting_date + " · " + esc(p.mode_of_payment || "") + (p.reference_no ? " · " + esc(p.reference_no) : "") + '</div></span><b class="num">' + money(p.amount) + "</b></div>").join("") + "</div>";
		h += '<div class="card"><div class="label" style="padding:14px 16px 0">Activity</div><div class="tl">' + ((d.timeline || []).slice().reverse().map((e) => "<div><span>" + esc(e.m) + "<small>" + esc(e.t) + "</small></span></div>").join("") || '<span class="muted">No activity yet.</span>') + "</div></div></div>";
		return h;
	}
	function railBound(f) {
		const pf = $("#pvf"); if (pf) pf.onchange = (e) => { f.pvFmt = e.target.value; f._pvKey = ""; pvSchedule(f, true); };
		pvSchedule(f, true);
	}
	/* live preview: server-rendered print format, shown scaled inside an iframe */
	let pvTimer = 0, pvSeq = 0;
	function pvPaint(f) {
		const box = $("#pvbox2"); if (!box || !f._pvHtml) return;
		let fr = box.querySelector("iframe");
		if (!fr) { box.innerHTML = '<div class="pvscale"><iframe title="Invoice preview" sandbox="allow-same-origin" scrolling="no"></iframe></div>'; fr = box.querySelector("iframe"); }
		if (fr._h !== f._pvHtml) { fr._h = f._pvHtml; fr.srcdoc = f._pvHtml; }
		const sc = box.clientWidth / 794; fr.parentElement.style.height = 1123 * sc + "px"; fr.style.transform = "scale(" + sc + ")";
	}
	function pvSchedule(f, now) {
		if (!f.doc.items.some((r) => r.item_code) && !f.doc.name) return;
		const d = f.doc, key = JSON.stringify([f.pvFmt, d.name, d.modified, d.grand_total, d.items.map((r) => [r.item_code, r.qty, r.rate]), d.customer, d.docstatus, d.custom_zatca_status, d.letter_head, d.language]);
		if (f._pvKey === key) return pvPaint(f);
		clearTimeout(pvTimer); const seq = ++pvSeq;
		pvTimer = setTimeout(async () => {
			try {
				const args = { print_format: f.pvFmt || null, letter_head: d.letter_head || null, lang: d.language || null };
				if (d.name && d.docstatus !== 0) args.name = d.name; else if (d.items.some((r) => r.item_code)) args.doc = JSON.stringify(clean(d)); else args.name = d.name;
				const r = await CD.call("invoice.print_html", args);
				if (seq !== pvSeq || CD.form !== f) return; f._pvKey = key; f._pvHtml = r.html; pvPaint(f);
			} catch (e) { const box = $("#pvbox2"); if (box && !f._pvHtml) box.innerHTML = '<div class="pvempty muted">Preview unavailable: ' + esc(e.message.slice(0, 140)) + "</div>"; }
		}, now ? 120 : 900);
	}
	function connections(f) {
		const d = f.doc; if (!d.name) return '<section class="sec"><div class="sbody" style="padding-top:16px"><p class="muted" style="margin:0">Connections appear once the invoice is saved.</p></div></section>';
		const rows = []; if (d.return_against) rows.push(["Return Against", d.return_against, "sales-invoice"]); (d.returns || []).forEach((n) => rows.push(["Credit Note", n, "sales-invoice"])); (d.pay_hist || []).forEach((p) => rows.push(["Payment Entry", p.name, "payment-entry"]));
		let h = '<section class="sec"><h3>Linked documents</h3><div class="sbody">' + (rows.length ? '<table class="tbl"><tbody>' + rows.map((r) => '<tr class="click" data-open="' + r[2] + "|" + esc(r[1]) + '"><td>' + r[0] + '</td><td class="num">' + esc(r[1]) + "</td></tr>").join("") + "</tbody></table>" : '<p class="muted" style="margin:0">None yet.</p>') + "</div></section>";
		h += '<section class="sec"><h3>Stock Ledger entries</h3><div class="sbody scroll">' + ((d.stock_moves || []).length ? '<table class="tbl"><thead><tr><th>Item</th><th>Warehouse</th><th class="r">Qty</th><th class="r">Balance after</th></tr></thead><tbody>' + d.stock_moves.map((e) => "<tr><td>" + esc(e.item_code) + "</td><td>" + esc(e.warehouse) + '</td><td class="r num">' + e.actual_qty + '</td><td class="r num">' + e.qty_after_transaction + "</td></tr>").join("") + "</tbody></table>" : '<p class="muted" style="margin:0">' + (d.docstatus ? "This invoice did not move stock." : "Stock moves when you submit.") + "</p>") + "</div></section>";
		if (CD.boot.zatca) h += '<section class="sec"><h3>ZATCA response</h3><div class="sbody">' + (d.custom_zatca_full_response ? '<pre class="num" style="margin:0;font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere;background:var(--surface2);padding:12px;border-radius:8px;max-height:320px;overflow:auto">' + esc(typeof d.custom_zatca_full_response === "string" ? d.custom_zatca_full_response : JSON.stringify(d.custom_zatca_full_response, null, 2)) + "</pre>" : '<p class="muted" style="margin:0">' + (d.docstatus ? "No response recorded yet." : "Available after submit.") + "</p>") + "</div></section>";
		return h;
	}
	function hooks() { return {
		head: (f) => head(f), locked: (f) => (f.doc.docstatus || 0) !== 0, change, rail, railBound, afterRefresh: (f) => stockWarn(f),
		tabHtml: { conn: connections },
		canCreate: (dt) => (dt === "Customer" && CD.boot.can.Customer.create ? "Customer" : dt === "ItemAdd" && CD.boot.can.Item.create ? "Item" : null),
		quickCreate: (dt, v, inp) => {
			const f0 = CD.form, snap = CD.clone(f0.doc), back = () => { snap.__dirty = 1; CD.pending = snap; CD.go("sales-invoice", snap.name || "__new"); };
			if (dt === "Customer") CD.quickCustomer(v, (r) => { if (CD.form === f0 && CD.form.host.isConnected && !CD.resume) { f0.doc.customer = r.name; CD.setTitle("Customer", r.name, r.customer_name); f0.setDirty(); change(f0, f0.doc, "", "customer").then(() => f0.after("tab", "customer")); } else { snap.customer = r.name; snap._resume = 1; snap.__dirty = 1; CD.pending = snap; CD.go("sales-invoice", snap.name || "__new"); } }, back);
			else CD.quickItem(v, (r) => { if (CD.form === f0 && !CD.resume) addItem(f0, r.name); else { snap._addItem = r.name; snap._resume = 1; snap.__dirty = 1; CD.pending = snap; CD.go("sales-invoice", snap.name || "__new"); } }, back);
		},
		linkPick: (f, inp, x) => { if (inp.dataset.link === "ItemAdd") { inp.value = ""; addItem(f, x.v); return true; } return false; },
		linkRaw: async (f, el, v) => { if (el.dataset.link !== "ItemAdd") return false; el.value = ""; if (!v) return true; const rows = await CD.call("common.link_search", { doctype: "Item", txt: v }); const hit = rows.find((r) => r.name.toLowerCase() === v.toLowerCase()) || (rows.length === 1 ? rows[0] : null); if (hit) addItem(f, hit.name); else CD.toast("No item matches " + v); return true; },
		keydown: (f, e) => { if (e.key === "Enter" && e.target.dataset && e.target.dataset.f === "scan_barcode" && e.target.value.trim()) { e.preventDefault(); const v = e.target.value.trim(); e.target.value = ""; CD.call("common.link_search", { doctype: "Item", txt: v }).then((rows) => { const hit = rows.find((r) => r.name.toLowerCase() === v.toLowerCase()) || (rows.length === 1 ? rows[0] : null); if (hit) addItem(f, hit.name); else CD.toast("No item matches " + v); }); } },
		click: (f, e) => { const o = e.target.closest("[data-open]"); if (o) { const [k, n] = o.dataset.open.split("|"); CD.nav(k, n); } const p = e.target.closest("[data-open-pe]"); if (p) CD.nav("payment-entry", p.dataset.openPe); },
		act: (f, k, el) => act(f, k, el),
	}; }
	function stockWarn(f) {
		const d = f.doc; $$('[data-tn="items"] tbody tr[data-r]').forEach((tr) => {
			const r = d.items[+tr.dataset.r]; const sh = !!(r && d.update_stock && r.is_stock_item !== 0 && d.docstatus === 0 && !d.is_return && flt(r.actual_qty) < flt(r.stock_qty || r.qty) && r.item_code);
			tr.classList.toggle("short", sh); tr.title = sh ? "Only " + flt(r.actual_qty) + " in stock at " + (r.warehouse || "") : "";
		});
	}

	/* ---------- actions ---------- */
	async function save(f) {
		const d = f.doc, miss = [], mf = [];
		if (!d.customer) { miss.push("Customer"); mf.push("customer"); }
		if (!d.items.filter((r) => r.item_code).length) { miss.push("Items"); }
		if (miss.length) { f.markErr(mf); CD.msg("Missing Fields", "Please fill the following: " + miss.join(", ")); return false; }
		try {
			const r = await CD.call("invoice.save", { doc: JSON.stringify(clean(d)) });
			f.setDirty(false); CD.toast("Sales Invoice " + r.name + " saved"); CD.pending = r; CD.go("sales-invoice", r.name); return true;
		} catch (e) { CD.fail(e, "Cannot save invoice"); return false; }
	}
	function submit(f) {
		const d = f.doc;
		CD.confirm("Submit " + d.name + "?", "Submitting posts the invoice to accounts" + (d.update_stock ? " and deducts stock" : "") + (CD.boot.zatca ? ", then sends it to ZATCA" : "") + ". You cannot edit it after this.", "Submit", async () => {
			try { const r = await CD.call("invoice.submit", { name: d.name, modified: d.modified }); CD.toast(d.name + " submitted"); CD.pending = r; CD.go("sales-invoice", d.name); if (CD.boot.zatca) pollZatca(d.name); }
			catch (e) { CD.fail(e, "Cannot submit"); return false; }
		});
	}
	function approve(why, cb) {
		if (CD.boot.user.is_manager) return cb(null);
		CD.dlg({ title: "Manager approval needed", body: '<p style="margin:0">' + esc(why) + '</p><label class="fld"><span class="lb">Manager PIN</span><input class="in num" id="apin" type="password" inputmode="numeric" autocomplete="off"></label>',
			actions: [{ l: "Cancel" }, { l: "Approve", primary: 1, fn: async () => { const pin = $("#apin").value; if (!pin) { CD.toast("Enter the PIN"); return false; } setTimeout(() => cb(pin), 0); } }] });
	}
	function cancel(f) {
		const d = f.doc;
		approve("Cancelling a submitted invoice needs manager approval.", (pin) => CD.confirm("Cancel " + d.name + "?", "This reverses the stock and accounting entries.", "Yes, cancel", async () => {
			try { const r = await CD.call("invoice.cancel", { name: d.name, pin }); CD.toast(d.name + " cancelled"); CD.pending = r; CD.go("sales-invoice", d.name); } catch (e) { CD.fail(e, "Cannot cancel"); return false; }
		}, true));
	}
	function makeReturn(f) {
		const d = f.doc;
		approve("Returns need manager approval.", async (pin) => { try { const r = await CD.call("invoice.make_return", { name: d.name, pin }); openNew(r); } catch (e) { CD.fail(e, "Cannot start a return"); } });
	}
	async function duplicate(f, amend) { try { openNew(await CD.call("invoice.duplicate", { name: f.doc.name, amend: amend ? 1 : 0 })); } catch (e) { CD.fail(e, "Cannot copy invoice"); } }
	function openNew(doc) { CD.pending = Object.assign({}, doc, { name: null, docstatus: 0, status: "Draft" }); CD.go("sales-invoice", "__new"); }
	let zTimer = 0;
	function pollZatca(name, n = 0) {
		clearTimeout(zTimer); if (n > 24) return;
		zTimer = setTimeout(async () => {
			try {
				const z = await CD.call("invoice.zatca", { name }); const f = CD.form;
				if (f && f.doc && f.doc.name === name && z.enabled) { f.doc.custom_zatca_status = z.status; f.doc.custom_zatca_full_response = z.response; f.renderHead(); f.renderRail(); if (f.schema.tabs[f.tab].html) f.renderTab(); }
				if (!z.enabled || zdone(z.status)) return; pollZatca(name, n + 1);
			} catch (e) { /* stop polling on error */ }
		}, n === 0 ? 1200 : 2500);
	}
	async function act(f, k, el) {
		const d = f.doc;
		if (k === "save") return save(f);
		if (k === "submit") return submit(f);
		if (k === "print") return printDlg(d);
		if (k === "pay") return CD.pages["payment-entry"].newFrom(d.name);
		if (k === "amend") return duplicate(f, true);
		if (k === "retryz") { try { await CD.call("zatca.retry", { name: d.name }); CD.toast("Sent to ZATCA again"); pollZatca(d.name); } catch (e) { CD.fail(e, "ZATCA retry failed"); } return; }
		if (k === "menu") {
			const it = [];
			if (d.name && d.docstatus === 0) it.push({ l: "Delete", danger: 1, fn: () => CD.confirm("Delete " + d.name + "?", "This draft will be removed.", "Delete", async () => { try { await CD.call("invoice.delete", { name: d.name }); f.setDirty(false); CD.toast("Deleted"); CD.go("sales-invoice"); } catch (e) { CD.fail(e, "Cannot delete"); return false; } }, true) });
			if (d.name) it.push({ l: "Duplicate", fn: () => duplicate(f, false) });
			if (d.docstatus === 1) { if (flt(d.outstanding_amount) > 0.005 && !d.is_return && CD.pages["payment-entry"] && CD.pages["payment-entry"].newFrom) it.push({ l: "Create Payment Entry", fn: () => CD.pages["payment-entry"].newFrom(d.name) }); if (!d.is_return) it.push({ l: "Return / Credit Note", fn: () => makeReturn(f) }); it.push({ l: "Cancel", danger: 1, fn: () => cancel(f) }); }
			if (it.length) CD.menu(el, it);
		}
	}

	/* ---------- print dialog ---------- */
	function printDlg(d) {
		const b = CD.boot, fm = b.print_formats["Sales Invoice"], state = { fmt: d.__fmt || b.settings.print_format || "", lh: d.letter_head || b.settings.letter_head || "", lang: d.language || "" };
		const url = (path) => path + "?doctype=Sales%20Invoice&name=" + encodeURIComponent(d.name) + "&format=" + encodeURIComponent(state.fmt) + "&no_letterhead=" + (state.lh ? 0 : 1) + (state.lh ? "&letterhead=" + encodeURIComponent(state.lh) : "") + (state.lang ? "&_lang=" + state.lang : "");
		const draw = async () => {
			const box = $("#pvs"); box.innerHTML = '<div class="pvempty muted">Loading preview…</div>';
			try {
				const args = { print_format: state.fmt || null, letter_head: state.lh || null, lang: state.lang || null }; if (d.name) args.name = d.name; else args.doc = JSON.stringify(clean(d));
				const r = await CD.call("invoice.print_html", args); box.innerHTML = '<iframe title="Print preview" sandbox="allow-same-origin" style="width:100%;height:68vh;border:0;background:#fff"></iframe>'; box.firstChild.srcdoc = r.html;
			} catch (e) { box.innerHTML = '<div class="pvempty muted">' + esc(e.message) + "</div>"; }
		};
		CD.dlg({ wide: 1, title: "Print · " + (d.name || "Draft"), body: '<div class="pv"><div class="stage" id="pvs"></div><div style="display:grid;gap:12px;align-content:start"><label class="fld"><span class="lb">Print Format</span><select class="in" id="pf"><option value="">Default</option>' + fm.map((x) => "<option" + (x === state.fmt ? " selected" : "") + ">" + esc(x) + "</option>").join("") + '</select></label><label class="fld"><span class="lb">Letter Head</span><select class="in" id="plh"><option value="">No letter head</option>' + b.letter_heads.map((x) => "<option" + (x === state.lh ? " selected" : "") + ">" + esc(x) + "</option>").join("") + '</select></label><label class="fld"><span class="lb">Language</span><select class="in" id="pln"><option value="">Default</option><option value="en"' + (state.lang === "en" ? " selected" : "") + '>English</option><option value="ar"' + (state.lang === "ar" ? " selected" : "") + '>العربية</option></select></label><p class="muted" style="font-size:12px;margin:0">These are the Print Formats set up for Sales Invoice in ERPNext.</p></div></div>',
			actions: [{ l: "Close" }, { l: "Download PDF", fn: () => { if (!d.name) { CD.toast("Save the invoice first"); return false; } window.open(url("/api/method/frappe.utils.print_format.download_pdf"), "_blank"); return false; } },
				{ l: "Print", primary: 1, fn: () => { if (!d.name) { CD.toast("Save the invoice first"); return false; } window.open(url("/printview") + "&trigger_print=1&settings=%7B%7D", "_blank"); return false; } }],
			after: () => { $("#pf").onchange = (e) => { state.fmt = e.target.value; d.__fmt = state.fmt; draw(); }; $("#plh").onchange = (e) => { state.lh = e.target.value; draw(); }; $("#pln").onchange = (e) => { state.lang = e.target.value; draw(); }; draw(); } });
	}

	/* ---------- opening a document ---------- */
	async function prepare(doc) {
		if (!doc._resume) return doc;
		delete doc._resume; const fake = { doc };
		if (doc._addItem) { const row = { item_code: doc._addItem, qty: doc.is_return ? -1 : 1 }; delete doc._addItem; doc.items.push(row); await fetchRow(fake, row); rowSync(row, "qty"); }
		if (doc.customer && !doc.customer_name_loaded) { await applyParty(fake); }
		const c = await CD.call("invoice.calculate", { doc: JSON.stringify(clean(doc)) }); COMPUTED.forEach((k) => (doc[k] = c[k])); doc.discount_amount = c.discount_amount;
		if (c.items.length === doc.items.length) c.items.forEach((r, i) => Object.assign(doc.items[i], r)); if (c.taxes.length === doc.taxes.length) c.taxes.forEach((r, i) => Object.assign(doc.taxes[i], r)); doc.payment_schedule = c.payment_schedule;
		return doc;
	}
	function show(doc) {
		doc.__saved = !!doc.name; CD.setTitle("Customer", doc.customer, doc.customer_title || doc.customer_name);
		const f = new CD.Form({ dt: "Sales Invoice", dtLabel: "Sales Invoice", dtk: "sales-invoice", schema: SCHEMA, doc, hooks: hooks() }); f.mount();
		if ((!doc.name && CD.pendingDirty !== false) || doc.__dirty) { delete doc.__dirty; f.setDirty(true); f.renderHead(); }
		return f;
	}
	CD.quickItem = function (pre, done, cancel) {
		const b = CD.boot;
		CD.dlg({ title: "New Item", body: '<label class="fld"><span class="lb">Item Code *</span><input class="in" id="qc" value="' + esc(pre) + '"></label><label class="fld"><span class="lb">Item Name</span><input class="in" id="qn"></label><div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><label class="fld"><span class="lb">Item Group *</span><select class="in" id="qg">' + b.item_groups.map((g) => "<option>" + esc(g) + "</option>").join("") + '</select></label><label class="fld"><span class="lb">Unit *</span><select class="in" id="qu">' + b.uoms.map((g) => "<option" + (g === "Nos" ? " selected" : "") + ">" + esc(g) + "</option>").join("") + '</select></label><label class="fld"><span class="lb">Selling Rate</span><input class="in num" id="qr" type="number" step="any"></label><label class="fld"><span class="lb">Opening Stock</span><input class="in num" id="qs" type="number" step="any" value="0"></label></div><label class="fld"><span class="lb">Valuation Rate (needed with opening stock)</span><input class="in num" id="qv" type="number" step="any"></label><p class="muted" style="margin:0;font-size:12px">Use the Items page for the full form.</p>',
			actions: [{ l: "Edit full form", fn: () => CD.openFull("item", { item_code: $("#qc").value.trim(), item_name: $("#qn").value.trim(), item_group: $("#qg").value, stock_uom: $("#qu").value, standard_rate: flt($("#qr").value), valuation_rate: flt($("#qv").value), opening_stock: flt($("#qs").value) }, done, cancel) }, { l: "Cancel" }, { l: "Save", primary: 1, fn: async () => {
				const c = $("#qc").value.trim(); if (!c) { CD.toast("Item Code is required"); return false; }
				try { const r = await CD.call("item.save", { doc: JSON.stringify({ item_code: c, item_name: $("#qn").value || c, item_group: $("#qg").value, stock_uom: $("#qu").value, is_stock_item: 1, standard_rate: flt($("#qr").value), valuation_rate: flt($("#qv").value), opening_stock: flt($("#qs").value), uoms: [{ uom: $("#qu").value, conversion_factor: 1 }], item_defaults: [{ company: b.company.name, default_warehouse: b.settings.warehouse }] }) }); CD.setTitle("Item", r.name, r.item_name); CD.toast("Item " + r.item_name + " created"); if (done) done(r); }
				catch (e) { CD.fail(e, "Cannot create item"); return false; } } }] });
	};

	/* ---------- list ---------- */
	let data = { rows: [], more: false, counts: {}, kpis: {}, zatca: false };
	async function load(reset) {
		const s = st.si; const r = await CD.call("invoice.list", { tab: s.tab, txt: s.q, period: s.per, sort: s.sort, dir: s.dir, start: reset ? 0 : data.rows.length, page_len: 30 });
		data = Object.assign(r, { rows: reset ? r.rows : data.rows.concat(r.rows) }); CD.setCount("sales-invoice", r.counts.All);
	}
	function rowsHtml() {
		const s = st.si, z = data.zatca;
		$("#lcnt").textContent = data.rows.length + (data.more ? "+" : "") + " shown";
		$("#lb").innerHTML = data.rows.map((i) => '<tr class="click" data-oi="' + esc(i.name) + '"><td><input type="checkbox" data-sel="' + esc(i.name) + '" aria-label="Select ' + esc(i.name) + '"' + (s.sel[i.name] ? " checked" : "") + ' style="width:16px;height:16px;accent-color:var(--accent)"></td><td class="num"><b>' + esc(i.name) + "</b></td><td>" + esc(i.customer_name || i.customer) + '</td><td class="num muted">' + i.posting_date + '</td><td class="r num">' + money(i.grand_total) + '</td><td class="r num">' + (i.docstatus === 1 ? money(i.outstanding_amount) : "—") + '</td><td><span class="pill ' + (STC[i.status] || "n") + '">' + esc(i.status) + "</span></td>" +
			(z ? "<td>" + (i.docstatus === 1 ? '<span class="pill ' + zc(i.custom_zatca_status) + '">' + esc(i.custom_zatca_status || "Not Submitted") + "</span>" : '<span class="muted">—</span>') + "</td>" : "") + '<td class="r"><button class="btn sm ghost rowact" data-ra="' + esc(i.name) + '" aria-label="Row actions">⋯</button></td></tr>').join("") || '<tr><td colspan="9" class="empty">No invoices here.</td></tr>';
		const ns = Object.keys(s.sel).filter((k) => s.sel[k]).length;
		$("#bulk").innerHTML = ns ? '<div class="bulk"><span>' + ns + ' selected</span><button class="btn sm" id="bc">Clear</button></div>' : "";
		$("#more").hidden = !data.more; const bc = $("#bc"); if (bc) bc.onclick = () => { s.sel = {}; rowsHtml(); };
	}
	async function list() {
		CD.form = null; const s = st.si;
		CD.main().innerHTML = CD.crumbs("<span>Sales</span><span>/</span><span>Sales Invoice</span>") + '<div class="page"><div class="lhead"><h1>Sales Invoices</h1>' + (CD.boot.can["Sales Invoice"].create ? '<button class="btn primary" id="newSI">+ New invoice</button>' : "") + '</div><div id="kp"></div><div class="stabs" role="tablist" id="stabs"></div>' +
			'<div class="filters"><input class="in" id="lq" placeholder="Search invoice or customer" aria-label="Search" value="' + esc(s.q) + '" style="min-width:260px"><select class="in" id="lp" aria-label="Period">' + [["All", "All time"], ["0", "Today"], ["7", "Last 7 days"], ["30", "Last 30 days"]].map((p) => '<option value="' + p[0] + '"' + (p[0] === s.per ? " selected" : "") + ">" + p[1] + "</option>").join("") + '</select><span class="muted" id="lcnt" style="margin-left:auto"></span></div><div id="bulk"></div>' +
			'<div class="card scroll"><table class="tbl"><thead id="lh"></thead><tbody id="lb"><tr><td colspan="9" class="empty">Loading…</td></tr></tbody></table></div><button class="btn" id="more" hidden style="justify-self:center">Load more</button></div>';
		const paintHead = () => {
			const k = data.kpis || {}, a = k.aging || { current: 0, d30: 0, d31: 0 }, tot = k.to_collect || 1, c = CD.boot.company.currency;
			$("#kp").innerHTML = '<div class="kgrid"><div class="kpi"><span class="label">Sales today</span><b class="num">' + c + " " + money(k.sales_today) + '</b><span class="muted" style="font-size:12px">' + (k.sales_today_n || 0) + ' invoices</span></div><div class="kpi"><span class="label">To collect</span><b class="num">' + c + " " + money(k.to_collect) + '</b><span class="muted" style="font-size:12px">' + (k.open_n || 0) + ' open</span></div><div class="kpi"><span class="label">Overdue</span><b class="num" style="color:' + (k.overdue ? "var(--bad)" : "var(--fg)") + '">' + c + " " + money(k.overdue) + '</b></div><div class="kpi"><span class="label">Drafts</span><b class="num">' + (k.drafts || 0) + '</b><span class="muted" style="font-size:12px">not submitted</span></div>' +
				'<div class="kpi aging" style="padding:14px 16px"><span class="label">Receivables by age</span><div class="agbar"><i style="width:' + a.current / tot * 100 + '%;background:var(--ok)"></i><i style="width:' + a.d30 / tot * 100 + '%;background:var(--warn)"></i><i style="width:' + a.d31 / tot * 100 + '%;background:var(--bad)"></i></div><div class="aglg"><span style="--c:var(--ok)">Not due <b class="num">' + money(a.current) + '</b></span><span style="--c:var(--warn)">1–30 d <b class="num">' + money(a.d30) + '</b></span><span style="--c:var(--bad)">31+ d <b class="num">' + money(a.d31) + "</b></span></div></div></div>";
			const tabs = ["All", "Draft", "Unpaid", "Overdue", "Paid"].concat(data.zatca ? ["ZATCA issues"] : []);
			$("#stabs").innerHTML = tabs.map((t) => '<button class="stab" role="tab" data-st="' + t + '" aria-selected="' + (t === s.tab) + '">' + t + '<span class="c">' + (data.counts[t] || 0) + "</span></button>").join("");
			$$(".stab").forEach((b) => (b.onclick = () => { s.tab = b.dataset.st; reload(); }));
			const arrow = (k) => (s.sort === k ? (s.dir === "desc" ? " ↓" : " ↑") : "");
			$("#lh").innerHTML = '<tr><th style="width:34px"></th><th class="sortable" data-sort="name">Invoice</th><th>Customer</th><th class="sortable" data-sort="date">Date' + arrow("date") + '</th><th class="r sortable" data-sort="total">Grand total' + arrow("total") + '</th><th class="r sortable" data-sort="out">Outstanding' + arrow("out") + "</th><th>Status</th>" + (data.zatca ? "<th>ZATCA</th>" : "") + "<th></th></tr>";
			$$("th[data-sort]").forEach((h) => (h.onclick = () => { const k = h.dataset.sort; if (s.sort === k) s.dir = s.dir === "desc" ? "asc" : "desc"; else { s.sort = k; s.dir = "desc"; } reload(); }));
		};
		const reload = () => load(true).then(() => { paintHead(); rowsHtml(); }).catch((e) => CD.fail(e));
		let tm = 0; $("#lq").oninput = (e) => { s.q = e.target.value; clearTimeout(tm); tm = setTimeout(reload, 280); }; $("#lp").onchange = (e) => { s.per = e.target.value; reload(); };
		$("#more").onclick = () => load(false).then(rowsHtml).catch((e) => CD.fail(e));
		if ($("#newSI")) $("#newSI").onclick = () => CD.nav("sales-invoice", "__new");
		$("#lb").onclick = (e) => {
			const sel = e.target.closest("[data-sel]"); if (sel) { s.sel[sel.dataset.sel] = sel.checked; rowsHtml(); return; }
			const ra = e.target.closest("[data-ra]");
			if (ra) { e.stopPropagation(); const row = data.rows.find((r) => r.name === ra.dataset.ra), it = [{ l: "Open", fn: () => CD.nav("sales-invoice", row.name) }, { l: "Print", fn: () => printDlg({ name: row.name }) }];
				if (row.docstatus === 1 && flt(row.outstanding_amount) > 0.005 && !row.is_return && CD.pages["payment-entry"] && CD.pages["payment-entry"].newFrom) it.push({ l: "Create Payment Entry", fn: () => CD.pages["payment-entry"].newFrom(row.name) }); CD.menu(ra, it); return; }
			const r = e.target.closest("[data-oi]"); if (r) CD.nav("sales-invoice", r.dataset.oi);
		};
		$("#cmdk").onclick = () => CD.palette && CD.palette(); await reload();
	}
	CD.page("sales-invoice", {
		list,
		open: async (name) => {
			if (name === "__new") { const p = CD.pending; CD.pending = null; return show(p && !p.name ? await prepare(p) : await CD.call("invoice.new_doc", {})); }
			const p = CD.pending; CD.pending = null; const doc = p && p.name === name ? await prepare(p) : await CD.call("invoice.get", { name });
			const f = show(doc); if (CD.boot.zatca && doc.docstatus === 1 && !zdone(doc.custom_zatca_status)) pollZatca(name); return f;
		},
		newWith: async (o) => { try { CD.pending = await CD.call("invoice.new_doc", { customer: o.customer || null, item: o.item || null }); CD.go("sales-invoice", "__new"); } catch (e) { CD.fail(e, "Cannot start an invoice"); } },
	});
})();
