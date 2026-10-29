/* Customers: list, create/edit form, quick-create dialog used from invoices and payments. */
(function () {
	const CD = window.CD, { $, esc, money, F } = CD;
	const st = (CD.state = CD.state || {}); st.cust = st.cust || { q: "", g: "All" };
	const SCHEMA = { tabs: [{ l: "Details", secs: [
		{ nolabel: 1, cols: [
			[F("Data", "customer_name", "Customer Name", { req: 1, roIf: (d) => d.__saved }), F("Select", "customer_type", "Customer Type", { o: ["Company", "Individual"], req: 1 }), F("Link", "customer_group", "Customer Group", { o: "Customer Group", req: 1 }), F("Link", "territory", "Territory", { o: "Territory" }), F("Data", "tax_id", "VAT number", { desc: "15 digits, starting and ending with 3. Needed for business invoices sent to ZATCA." }), F("Check", "disabled", "Disabled")],
			[F("Data", "mobile_no", "Mobile No"), F("Data", "email_id", "Email Id"), F("Link", "default_price_list", "Default Price List", { o: "Price List" }), F("Link", "payment_terms", "Default Payment Terms Template", { o: "Payment Terms Template" }), F("Link", "default_currency", "Billing Currency", { o: "Currency" })]] },
		{ l: "Address", cols: [[F("Data", "address_line1", "Address Line 1"), F("Data", "city", "City")], [F("Link", "country", "Country", { o: "Country" })]] },
		{ l: "More", col: 1, shut: 1, cols: [[F("Text", "customer_details", "Customer Details")], []] }] }] };
	function blank() { const b = CD.boot; return { __saved: false, customer_name: "", customer_type: "Individual", customer_group: b.customer_groups.includes("Individual") ? "Individual" : "", territory: "", tax_id: "", disabled: 0, mobile_no: "", email_id: "", default_price_list: "", payment_terms: "", default_currency: "", address_line1: "", city: "", country: b.company.country, customer_details: "", summary: { invoices: 0, billed: 0, outstanding: 0, recent: [] } }; }
	function hooks() { return {
		head: (f) => { const d = f.doc; return { title: d.__saved ? d.customer_name : "New Customer", unsaved: !d.__saved, status: d.__saved ? '<span class="pill ' + (d.disabled ? "bad" : "ok") + '">' + (d.disabled ? "Disabled" : "Enabled") + "</span>" : "", sub: d.__saved ? esc(d.name) + " · " + esc(d.customer_group || "") : "", acts: [{ k: "save", l: "Save", primary: 1 }] }; },
		locked: () => false,
		before: () => CD.resumeBanner("customer"),
		change: (f, o, t, n) => { if (n === "tax_id" && f.doc.tax_id && f.doc.customer_type === "Individual") f.doc.customer_type = "Company"; return null; },
		rail: (f) => { const s = f.doc.summary, cur = CD.boot.company.currency;
			return '<div class="card sum"><span class="label">Outstanding</span><div class="big num">' + cur + " " + money(s.outstanding) + '</div><div class="r"><span class="muted">Invoices</span><span class="num">' + s.invoices + '</span></div><div class="r"><span class="muted">Billed</span><span class="num">' + money(s.billed) + "</span></div>" + (f.doc.__saved && CD.pages["sales-invoice"] && CD.pages["sales-invoice"].newWith ? '<button class="btn" data-act="sellc">Create Sales Invoice</button>' : "") + "</div>" +
				(s.recent.length ? '<div class="card zs"><span class="label">Recent invoices</span>' + s.recent.map((i) => '<div style="display:flex;justify-content:space-between;gap:8px;font-size:13px;cursor:pointer" data-inv="' + esc(i.name) + '"><span><b class="num">' + esc(i.name) + '</b><div class="muted" style="font-size:12px">' + i.posting_date + " · " + esc(i.status) + '</div></span><b class="num">' + money(i.grand_total) + "</b></div>").join("") + "</div>" : ""); },
		click: (f, e) => { if (e.target.closest("[data-resume-cancel]")) return CD.cancelFull(); const r = e.target.closest("[data-inv]"); if (r) CD.nav("sales-invoice", r.dataset.inv); },
		act: async (f, k) => {
			if (k === "save") return save(f);
			if (k === "sellc") return CD.pages["sales-invoice"].newWith({ customer: f.doc.name });
		},
	}; }
	async function save(f) {
		const d = f.doc;
		if (!d.customer_name) { f.markErr(["customer_name"]); return CD.msg("Missing Fields", "Please fill the following: Customer Name"); }
		try { const doc = CD.clone(d); delete doc.summary; delete doc.__saved; const r = await CD.call("customer.save", { doc: JSON.stringify(doc) }); f.setDirty(false); CD.toast("Customer " + r.customer_name + " saved"); CD.setTitle("Customer", r.name, r.customer_name); if (!CD.finishFull(r)) CD.go("customer", r.name); }
		catch (e) { CD.fail(e, "Cannot save customer"); }
	}
	function show(doc) { const f = new CD.Form({ dt: "Customer", dtLabel: "Customer", dtk: "customer", schema: SCHEMA, doc, hooks: hooks() }); f.mount(); return f; }

	/* quick create from a link dropdown */
	CD.quickCustomer = function (pre, done, cancel) {
		CD.dlg({ title: "New Customer", body: '<label class="fld"><span class="lb">Customer Name *</span><input class="in" id="qn" value="' + esc(pre) + '"></label><label class="fld"><span class="lb">Customer Group</span><select class="in" id="qg">' + CD.boot.customer_groups.map((g) => "<option" + (g === "Individual" ? " selected" : "") + ">" + esc(g) + "</option>").join("") + '</select></label><label class="fld"><span class="lb">VAT number (15 digits, for businesses)</span><input class="in num" id="qt"></label><label class="fld"><span class="lb">Mobile No</span><input class="in num" id="qm"></label>',
			actions: [{ l: "Edit full form", fn: () => { const t = $("#qt").value.trim(); CD.openFull("customer", { customer_name: $("#qn").value.trim(), customer_group: $("#qg").value, tax_id: t, customer_type: t ? "Company" : "Individual", mobile_no: $("#qm").value }, done, cancel); } }, { l: "Cancel" }, { l: "Save", primary: 1, fn: async () => {
				const n = $("#qn").value.trim(); if (!n) { CD.toast("Customer Name is required"); return false; }
				const t = $("#qt").value.trim();
				try { const r = await CD.call("customer.save", { doc: JSON.stringify({ customer_name: n, customer_group: $("#qg").value, customer_type: t ? "Company" : "Individual", tax_id: t, mobile_no: $("#qm").value }) }); CD.setTitle("Customer", r.name, r.customer_name); CD.toast("Customer " + r.customer_name + " created"); if (done) done(r); }
				catch (e) { CD.fail(e, "Cannot create customer"); return false; } } }] });
	};

	let rows = [], more = false;
	async function load(reset) { const s = st.cust; const r = await CD.call("customer.list", { txt: s.q, group: s.g, start: reset ? 0 : rows.length, page_len: 30 }); rows = reset ? r.rows : rows.concat(r.rows); more = r.more; rows.forEach((x) => CD.setTitle("Customer", x.name, x.customer_name)); }
	function table() {
		$("#lcnt").textContent = rows.length + (more ? "+" : "") + " shown";
		$("#lb").innerHTML = rows.map((c) => '<tr class="click" data-oi="' + esc(c.name) + '"><td><b>' + esc(c.customer_name) + '</b><div class="num muted" style="font-size:12px">' + esc(c.name) + "</div></td><td>" + esc(c.customer_group) + '</td><td class="num muted">' + (c.tax_id || "—") + '</td><td class="num muted">' + (c.mobile_no || "—") + '</td><td class="r num">' + (c.outstanding ? '<span class="pill warn">' + money(c.outstanding) + "</span>" : "0.00") + "</td></tr>").join("") || '<tr><td colspan="5" class="empty">No customers match.</td></tr>';
		$("#more").hidden = !more;
	}
	async function list() {
		CD.form = null; const s = st.cust;
		CD.main().innerHTML = CD.crumbs("<span>Selling</span><span>/</span><span>Customer</span>") + '<div class="page"><div class="lhead"><h1>Customers</h1>' + (CD.boot.can.Customer.create ? '<button class="btn primary" id="newC">+ Add Customer</button>' : "") + '</div><div class="filters"><input class="in" id="lq" placeholder="Search name, VAT number or mobile" aria-label="Search" value="' + esc(s.q) + '" style="min-width:260px"><select class="in" id="lg" aria-label="Customer group">' + ["All"].concat(CD.boot.customer_groups).map((g) => "<option" + (g === s.g ? " selected" : "") + ">" + esc(g) + "</option>").join("") +
			'</select><span class="muted" id="lcnt" style="margin-left:auto"></span></div><div class="card scroll"><table class="tbl"><thead><tr><th>Customer</th><th>Group</th><th>VAT no.</th><th>Mobile</th><th class="r">Outstanding</th></tr></thead><tbody id="lb"><tr><td colspan="5" class="empty">Loading…</td></tr></tbody></table></div><button class="btn" id="more" hidden style="justify-self:center">Load more</button></div>';
		let tm = 0; const re = () => load(true).then(table).catch((e) => CD.fail(e));
		$("#lq").oninput = (e) => { s.q = e.target.value; clearTimeout(tm); tm = setTimeout(re, 250); }; $("#lg").onchange = (e) => { s.g = e.target.value; re(); };
		$("#more").onclick = () => load(false).then(table).catch((e) => CD.fail(e));
		if ($("#newC")) $("#newC").onclick = () => CD.nav("customer", "__new");
		$("#lb").onclick = (e) => { const r = e.target.closest("[data-oi]"); if (r) CD.nav("customer", r.dataset.oi); };
		$("#cmdk").onclick = () => CD.palette && CD.palette(); await re();
	}
	CD.page("customer", { list, open: async (name) => { if (name === "__new") { const b = blank(); if (CD.prefill) { Object.assign(b, CD.prefill); CD.prefill = null; } const f = show(b); f.setDirty(true); f.renderHead(); return f; } const r = await CD.call("customer.get", { name }); CD.setTitle("Customer", r.name, r.customer_name); show(Object.assign(r, { __saved: true })); }, show, blank });
})();
