/* Payment Entry: money received from customers, allocated to invoices. */
(function () {
	const CD = window.CD, { $, $$, esc, flt, rnd, money, F, T } = CD;
	const st = (CD.state = CD.state || {}); st.pe = st.pe || { q: "", tab: "All", per: "All" };
	const cur = () => CD.boot.company.currency;
	const modeType = (m) => { const x = CD.boot.modes_of_payment.find((y) => y.name === m); return x ? x.type : ""; };
	const modeAcct = (m) => { const x = CD.boot.modes_of_payment.find((y) => y.name === m); return x ? x.account : ""; };
	const bank = (d) => modeType(d.mode_of_payment) === "Bank";
	const SCHEMA = { tabs: [
		{ l: "Payment", secs: [
			{ nolabel: 1, cols: [
				[F("Select", "payment_type", "Payment Type", { o: ["Receive"], ro: 1 }), F("Date", "posting_date", "Posting Date", { req: 1 }), F("Link", "mode_of_payment", "Mode of Payment", { o: "Mode of Payment", req: 1 }), F("Link", "party", "Customer", { o: "Customer", req: 1 }), F("Data", "party_name", "Customer Name", { ro: 1, dep: (d) => d.party })],
				[F("Link", "paid_from", "Account Paid From", { o: "Account", ro: 1 }), F("Link", "paid_to", "Account Paid To", { o: "Account", req: 1, ro: 1 }), F("Currency", "paid_amount", "Amount Received", { req: 1 }), F("Data", "reference_no", "Cheque / Reference No", { dep: bank }), F("Date", "reference_date", "Cheque / Reference Date", { dep: bank })]] },
			{ l: "Payment References", foot: [T("references", "Payment References", [F("Link", "reference_name", "Sales Invoice", { o: "SIOut", w: 210 }), F("Date", "due_date", "Due Date", { ro: 1, w: 120 }), F("Currency", "total_amount", "Grand Total", { ro: 1, w: 110 }), F("Currency", "outstanding_amount", "Outstanding", { ro: 1, w: 110 }), F("Currency", "allocated_amount", "Allocated", { w: 110 })],
				{ newRow: () => ({ reference_doctype: "Sales Invoice", reference_name: "", allocated_amount: 0 }), tools: () => '<button class="btn sm" data-act="getout">Get outstanding invoices</button>', empty: "No invoice yet. Add one, or use Get outstanding invoices." })] },
			{ l: "Totals", nolabel: 1, cols: [[F("Currency", "total_allocated_amount", "Total Allocated Amount", { ro: 1 })], [F("Currency", "unallocated_amount", "Unallocated Amount", { ro: 1, desc: "Stays on the customer account as an advance." })]] },
			{ l: "Remarks", cols: [[F("Text", "remarks", "Remarks")], []] }] },
		{ l: "More Info", secs: [{ l: "Accounting", cols: [[F("Link", "company", "Company", { o: "Company", ro: 1 })], [F("Link", "cost_center", "Cost Center", { o: "Cost Center" }), F("Link", "project", "Project", { o: "Project" })]] }] },
		{ l: "Connections", html: "conn" }] };
	const clean = (d) => { const o = CD.clone(d); ["timeline", "__saved"].forEach((k) => delete o[k]); return o; };
	function recalc(f) {
		const d = f.doc; d.paid_amount = flt(d.paid_amount); d.received_amount = d.paid_amount;
		d.total_allocated_amount = rnd(d.references.reduce((s, r) => s + flt(r.allocated_amount), 0)); d.unallocated_amount = rnd(d.paid_amount - d.total_allocated_amount);
	}
	async function change(f, o, t, n) {
		const d = f.doc;
		if (!t) {
			if (n === "party") { d.party_name = CD.titleOf("Customer", d.party); d.references = []; d.paid_from = null; return "references"; }
			if (n === "mode_of_payment") { d.paid_to = modeAcct(d.mode_of_payment); if (!bank(d)) { d.reference_no = ""; d.reference_date = null; } return "tab"; }
			if (n === "paid_amount") { let left = flt(d.paid_amount); d.references.forEach((r) => { const a = rnd(Math.max(0, Math.min(flt(r.outstanding_amount), left))); left -= a; r.allocated_amount = a; }); return d.references.length ? "references" : null; }
		}
		if (t === "references") {
			if (n === "reference_name") {
				if (!o.reference_name) return null;
				try {
					const r = await CD.call("payment.invoice_row", { name: o.reference_name });
					if (d.party && r.customer !== d.party) { CD.toast("That invoice belongs to " + r.customer_name); o.reference_name = ""; return "references"; }
					if (!d.party) { d.party = r.customer; d.party_name = r.customer_name; CD.setTitle("Customer", r.customer, r.customer_name); }
					Object.assign(o, r); if (!flt(d.paid_amount)) d.paid_amount = r.outstanding_amount;
					const others = d.references.reduce((s, x) => s + (x === o ? 0 : flt(x.allocated_amount)), 0); o.allocated_amount = rnd(Math.max(0, Math.min(flt(r.outstanding_amount), flt(d.paid_amount) - others)));
				} catch (e) { o.reference_name = ""; CD.fail(e); }
				return "tab";
			}
			if (n === "allocated_amount") { const mx = flt(o.outstanding_amount); o.allocated_amount = Math.max(0, mx ? Math.min(flt(o.allocated_amount), mx) : flt(o.allocated_amount)); }
		}
		return null;
	}
	async function getOutstanding(f) {
		const d = f.doc; if (!d.party) return CD.toast("Select a customer first");
		try {
			const r = await CD.call("payment.get_outstanding", { party: d.party, paid_amount: d.paid_amount });
			if (!r.references.length) return CD.toast(CD.titleOf("Customer", d.party) + " has no outstanding invoices");
			d.paid_amount = r.paid_amount; d.references = r.references; f.setDirty(); recalc(f); f.renderTable("references"); f.refresh(); f.renderHead(); f.renderRail();
		} catch (e) { CD.fail(e); }
	}
	function head(f) {
		const d = f.doc, ds = d.docstatus || 0, saved = !!d.name, can = CD.boot.can["Payment Entry"], acts = [];
		if (ds === 0) { acts.push({ k: "menu", l: "···", html: "···" }, { k: "save", l: "Save", primary: f.dirty || !saved }); if (saved && !f.dirty && can.submit) acts.push({ k: "submit", l: "Submit", primary: 1 }); }
		else acts.push(...(ds === 1 ? [{ k: "menu", l: "···", html: "···" }] : []), { k: "print", l: "Print receipt", primary: 1 });
		return { title: d.name || "New Payment Entry", unsaved: !saved, status: '<span class="pill ' + (ds === 1 ? "ok" : ds === 2 ? "bad" : "n") + '">' + ["Draft", "Submitted", "Cancelled"][ds] + "</span>", sub: d.party ? esc(CD.titleOf("Customer", d.party)) + " · " + esc(cur()) + " " + money(d.paid_amount) : "", acts };
	}
	function rail(f) {
		const d = f.doc, ds = d.docstatus || 0, fm = CD.boot.print_formats["Payment Entry"] || [];
		return '<div class="pvp"><div class="card"><div class="journey" style="grid-template-columns:repeat(2,1fr)"><div class="jstep ' + (ds === 0 ? "cur" : "ok") + '"><i></i>Draft</div><div class="jstep ' + (ds === 1 ? "ok" : ds === 2 ? "bad" : "") + '"><i></i>' + (ds === 2 ? "Cancelled" : "Submitted") + '</div></div><div class="jmsg">' + (ds === 0 ? (d.name ? "Saved as draft. Submit to update the invoices." : "Not saved yet.") : ds === 2 ? "Cancelled. Invoice balances were restored." : "Posted. Invoice balances are updated.") + "</div></div>" +
			'<div class="card sum"><span class="label">Amount received</span><div class="big num">' + esc(cur()) + " " + money(d.paid_amount) + '</div><div class="r"><span class="muted">Applied to invoices</span><span class="num">' + money(d.total_allocated_amount) + '</span></div><div class="r"><span class="muted">Unallocated (advance)</span><b class="num" style="color:' + (flt(d.unallocated_amount) > 0.005 ? "var(--warn)" : flt(d.unallocated_amount) < -0.005 ? "var(--bad)" : "var(--fg)") + '">' + money(d.unallocated_amount) + '</b></div><div class="r"><span class="muted">Mode</span><span>' + esc(d.mode_of_payment || "") + "</span></div></div>" +
			(d.references.length ? '<div class="card zs"><span class="label">Invoices</span>' + d.references.map((x) => { const left = ds === 0 ? rnd(flt(x.outstanding_amount) - flt(x.allocated_amount)) : null; return '<div style="display:flex;justify-content:space-between;gap:8px;font-size:13px;cursor:pointer" data-open-inv="' + esc(x.reference_name) + '"><span><b class="num">' + esc(x.reference_name || "—") + '</b><div class="muted" style="font-size:12px">' + (left === null ? "Allocated" : left <= 0.005 ? "Fully paid" : "Balance after: " + money(left)) + '</div></span><b class="num">' + money(x.allocated_amount) + "</b></div>"; }).join("") + "</div>" : "") +
			'<div class="card"><div class="pvh"><span class="label">Receipt preview</span><span style="display:flex;gap:6px"><select id="pvf" class="in" aria-label="Print format" style="width:auto;min-height:30px;padding:3px 8px;max-width:160px"><option value="">Default format</option>' + fm.map((x) => "<option" + (x === f.pvFmt ? " selected" : "") + ">" + esc(x) + "</option>").join("") + '</select><button class="btn sm" data-act="print">Print</button></span></div><div class="pvbox2" id="pvbox2"><div class="pvempty muted">Pick a customer and amount to see the receipt.</div></div></div>' +
			'<div class="card"><div class="label" style="padding:14px 16px 0">Activity</div><div class="tl">' + ((d.timeline || []).slice().reverse().map((e) => "<div><span>" + esc(e.m) + "<small>" + esc(e.t) + "</small></span></div>").join("") || '<span class="muted">No activity yet.</span>') + "</div></div></div>";
	}
	let pvTimer = 0, pvSeq = 0;
	function pvPaint(f) { const box = $("#pvbox2"); if (!box || !f._pvHtml) return; let fr = box.querySelector("iframe"); if (!fr) { box.innerHTML = '<div class="pvscale"><iframe title="Receipt preview" sandbox="allow-same-origin" scrolling="no"></iframe></div>'; fr = box.querySelector("iframe"); } if (fr._h !== f._pvHtml) { fr._h = f._pvHtml; fr.srcdoc = f._pvHtml; } const sc = box.clientWidth / 794; fr.parentElement.style.height = 1123 * sc + "px"; fr.style.transform = "scale(" + sc + ")"; }
	function pvSchedule(f, now) {
		const d = f.doc; if (!d.party || !flt(d.paid_amount)) return;
		const key = JSON.stringify([f.pvFmt, d.name, d.modified, d.party, d.paid_amount, d.mode_of_payment, d.references.map((r) => [r.reference_name, r.allocated_amount]), d.docstatus, d.reference_no]);
		if (f._pvKey === key) return pvPaint(f); clearTimeout(pvTimer); const seq = ++pvSeq;
		pvTimer = setTimeout(async () => {
			try { const a = { print_format: f.pvFmt || null }; if (d.name && d.docstatus !== 0) a.name = d.name; else a.doc = JSON.stringify(clean(d)); const r = await CD.call("payment.print_html", a); if (seq !== pvSeq || CD.form !== f) return; f._pvKey = key; f._pvHtml = r.html; pvPaint(f); }
			catch (e) { const box = $("#pvbox2"); if (box && !f._pvHtml) box.innerHTML = '<div class="pvempty muted">Preview unavailable: ' + esc(e.message.slice(0, 140)) + "</div>"; }
		}, now ? 120 : 900);
	}
	function connections(f) {
		const d = f.doc;
		return '<section class="sec"><h3>Invoices</h3><div class="sbody">' + (d.references.length ? '<table class="tbl"><tbody>' + d.references.map((r) => '<tr class="click" data-open-inv="' + esc(r.reference_name) + '"><td class="num">' + esc(r.reference_name) + '</td><td class="r num">' + money(r.allocated_amount) + "</td></tr>").join("") + "</tbody></table>" : '<p class="muted" style="margin:0">No invoices allocated.</p>') + "</div></section>" +
			'<section class="sec"><h3>Accounting entries</h3><div class="sbody scroll">' + (d.docstatus === 1 ? '<table class="tbl"><thead><tr><th>Account</th><th class="r">Debit</th><th class="r">Credit</th></tr></thead><tbody><tr><td>' + esc(d.paid_to) + '</td><td class="r num">' + money(d.paid_amount) + '</td><td class="r num">0.00</td></tr><tr><td>' + esc(d.paid_from) + '</td><td class="r num">0.00</td><td class="r num">' + money(d.paid_amount) + "</td></tr></tbody></table>" : '<p class="muted" style="margin:0">' + (d.docstatus === 2 ? "Entries were reversed." : "Posted when you submit.") + "</p>") + "</div></section>";
	}
	function approve(why, cb) {
		if (CD.boot.user.is_manager) return cb(null);
		CD.dlg({ title: "Manager approval needed", body: '<p style="margin:0">' + esc(why) + '</p><label class="fld"><span class="lb">Manager PIN</span><input class="in num" id="apin" type="password" inputmode="numeric" autocomplete="off"></label>', actions: [{ l: "Cancel" }, { l: "Approve", primary: 1, fn: async () => { const pin = $("#apin").value; if (!pin) { CD.toast("Enter the PIN"); return false; } setTimeout(() => cb(pin), 0); } }] });
	}
	async function save(f) {
		const d = f.doc, miss = [], mf = [];
		if (!d.party) { miss.push("Customer"); mf.push("party"); } if (!flt(d.paid_amount)) { miss.push("Amount Received"); mf.push("paid_amount"); } if (!d.mode_of_payment) { miss.push("Mode of Payment"); mf.push("mode_of_payment"); }
		if (miss.length) { f.markErr(mf); return CD.msg("Missing Fields", "Please fill the following: " + miss.join(", ")); }
		if (bank(d) && (!d.reference_no || !d.reference_date)) { f.markErr(["reference_no", "reference_date"]); return CD.msg("Reference needed", "Reference No and Reference Date are mandatory for bank payments."); }
		if (flt(d.unallocated_amount) < -0.005) return CD.msg("Cannot save", "Total allocated amount cannot be more than the amount received.");
		try { const r = await CD.call("payment.save", { doc: JSON.stringify(clean(d)) }); f.setDirty(false); CD.toast("Payment " + r.name + " saved"); CD.pending = r; CD.go("payment-entry", r.name); } catch (e) { CD.fail(e, "Cannot save payment"); }
	}
	function submit(f) {
		const d = f.doc;
		CD.confirm("Submit " + d.name + "?", esc(cur()) + " " + money(d.paid_amount) + " will be posted to " + d.paid_to + " and applied to " + d.references.length + " invoice" + (d.references.length === 1 ? "" : "s") + "." + (flt(d.unallocated_amount) > 0.005 ? " " + money(d.unallocated_amount) + " stays as an advance." : ""), "Submit", async () => {
			try { const r = await CD.call("payment.submit", { name: d.name, modified: d.modified }); CD.toast(d.name + " submitted"); CD.pending = r; CD.go("payment-entry", d.name); } catch (e) { CD.fail(e, "Cannot submit"); return false; }
		});
	}
	function printDlg(d) {
		const fm = CD.boot.print_formats["Payment Entry"] || [], state = { fmt: "" };
		const url = (p) => p + "?doctype=Payment%20Entry&name=" + encodeURIComponent(d.name) + "&format=" + encodeURIComponent(state.fmt) + "&no_letterhead=1";
		const draw = async () => { const box = $("#pvs"); box.innerHTML = '<div class="pvempty muted">Loading preview…</div>'; try { const a = { print_format: state.fmt || null }; if (d.name) a.name = d.name; else a.doc = JSON.stringify(clean(d)); const r = await CD.call("payment.print_html", a); box.innerHTML = '<iframe title="Receipt" sandbox="allow-same-origin" style="width:100%;height:68vh;border:0;background:#fff"></iframe>'; box.firstChild.srcdoc = r.html; } catch (e) { box.innerHTML = '<div class="pvempty muted">' + esc(e.message) + "</div>"; } };
		CD.dlg({ wide: 1, title: "Print · " + (d.name || "Draft"), body: '<div class="pv"><div class="stage" id="pvs"></div><div style="display:grid;gap:12px;align-content:start"><label class="fld"><span class="lb">Print Format</span><select class="in" id="pf"><option value="">Default</option>' + fm.map((x) => "<option>" + esc(x) + "</option>").join("") + '</select></label><p class="muted" style="font-size:12px;margin:0">These are the Print Formats set up for Payment Entry in ERPNext.</p></div></div>',
			actions: [{ l: "Close" }, { l: "Download PDF", fn: () => { if (!d.name) { CD.toast("Save the payment first"); return false; } window.open(url("/api/method/frappe.utils.print_format.download_pdf"), "_blank"); return false; } }, { l: "Print", primary: 1, fn: () => { if (!d.name) { CD.toast("Save the payment first"); return false; } window.open(url("/printview") + "&trigger_print=1&settings=%7B%7D", "_blank"); return false; } }],
			after: () => { $("#pf").onchange = (e) => { state.fmt = e.target.value; draw(); }; draw(); } });
	}
	function hooks() { return {
		head, locked: (f) => (f.doc.docstatus || 0) !== 0, change: (f, o, t, n) => change(f, o, t, n), recalc, rail, afterRefresh: () => {}, tabHtml: { conn: connections },
		railBound: (f) => { const pf = $("#pvf"); if (pf) pf.onchange = (e) => { f.pvFmt = e.target.value; f._pvKey = ""; pvSchedule(f, true); }; pvSchedule(f, true); },
		click: (f, e) => { const o = e.target.closest("[data-open-inv]"); if (o && o.dataset.openInv) CD.nav("sales-invoice", o.dataset.openInv); },
		act: async (f, k, el) => {
			const d = f.doc;
			if (k === "save") return save(f); if (k === "submit") return submit(f); if (k === "print") return printDlg(d); if (k === "getout") return getOutstanding(f);
			if (k === "menu") {
				const it = [];
				if (d.name && d.docstatus === 0) it.push({ l: "Delete", danger: 1, fn: () => CD.confirm("Delete " + d.name + "?", "This draft will be removed.", "Delete", async () => { try { await CD.call("payment.delete", { name: d.name }); f.setDirty(false); CD.toast("Deleted"); CD.go("payment-entry"); } catch (e) { CD.fail(e); return false; } }, true) });
				if (d.docstatus === 1) it.push({ l: "Cancel", danger: 1, fn: () => approve("Cancelling a payment needs manager approval.", (pin) => CD.confirm("Cancel " + d.name + "?", "Invoice balances will be restored.", "Yes, cancel", async () => { try { const r = await CD.call("payment.cancel", { name: d.name, pin }); CD.toast(d.name + " cancelled"); CD.pending = r; CD.go("payment-entry", d.name); } catch (e) { CD.fail(e, "Cannot cancel"); return false; } }, true)) });
				if (it.length) CD.menu(el, it);
			}
		},
	}; }
	function show(doc) { doc.__saved = !!doc.name; if (doc.party) CD.setTitle("Customer", doc.party, doc.party_name); const f = new CD.Form({ dt: "Payment Entry", dtLabel: "Payment Entry", dtk: "payment-entry", schema: SCHEMA, doc, hooks: hooks() }); f.mount(); recalc(f); f.refresh(); f.renderRail(); if (!doc.name) { f.setDirty(true); f.renderHead(); } return f; }

	let data = { rows: [], more: false, counts: {}, kpis: {} };
	async function load(reset) { const s = st.pe; const r = await CD.call("payment.list", { tab: s.tab, txt: s.q, period: s.per, start: reset ? 0 : data.rows.length, page_len: 30 }); data = Object.assign(r, { rows: reset ? r.rows : data.rows.concat(r.rows) }); CD.setCount("payment-entry", r.counts.All); data.rows.forEach((x) => CD.setTitle("Customer", x.party, x.party_name)); }
	function rowsHtml() {
		$("#lcnt").textContent = data.rows.length + (data.more ? "+" : "") + " shown";
		$("#lb").innerHTML = data.rows.map((p) => '<tr class="click" data-oi="' + esc(p.name) + '"><td class="num"><b>' + esc(p.name) + "</b></td><td>" + esc(p.party_name || p.party) + '</td><td class="num muted">' + p.posting_date + "</td><td>" + esc(p.mode_of_payment || "") + (p.reference_no ? '<div class="muted num" style="font-size:12px">' + esc(p.reference_no) + "</div>" : "") + '</td><td class="num" style="font-size:12px">' + (p.applied.map((n) => esc(n.slice(-5))).join(", ") || '<span class="muted">Advance</span>') + '</td><td class="r num">' + money(p.paid_amount) + '</td><td><span class="pill ' + (p.docstatus === 1 ? "ok" : p.docstatus === 2 ? "bad" : "n") + '">' + ["Draft", "Submitted", "Cancelled"][p.docstatus] + '</span></td><td class="r"><button class="btn sm ghost rowact" data-ra="' + esc(p.name) + '" aria-label="Row actions">⋯</button></td></tr>').join("") || '<tr><td colspan="8" class="empty">No payments here.</td></tr>';
		$("#more").hidden = !data.more;
	}
	async function list() {
		CD.form = null; const s = st.pe;
		CD.main().innerHTML = CD.crumbs("<span>Sales</span><span>/</span><span>Payment Entry</span>") + '<div class="page"><div class="lhead"><h1>Payments</h1>' + (CD.boot.can["Payment Entry"].create ? '<button class="btn primary" id="newPE">+ New payment</button>' : "") + '</div><div id="kp"></div><div class="stabs" role="tablist" id="stabs"></div><div class="filters"><input class="in" id="lq" placeholder="Search payment, customer or reference" aria-label="Search" value="' + esc(s.q) + '" style="min-width:260px"><select class="in" id="lp" aria-label="Period">' + [["All", "All time"], ["0", "Today"], ["7", "Last 7 days"], ["30", "Last 30 days"]].map((p) => '<option value="' + p[0] + '"' + (p[0] === s.per ? " selected" : "") + ">" + p[1] + "</option>").join("") + '</select><span class="muted" id="lcnt" style="margin-left:auto"></span></div><div class="card scroll"><table class="tbl"><thead><tr><th>Payment</th><th>Customer</th><th>Date</th><th>Mode</th><th>Applied to</th><th class="r">Amount</th><th>Status</th><th></th></tr></thead><tbody id="lb"><tr><td colspan="8" class="empty">Loading…</td></tr></tbody></table></div><button class="btn" id="more" hidden style="justify-self:center">Load more</button></div>';
		const paint = () => {
			const k = data.kpis, c = cur();
			$("#kp").innerHTML = '<div class="kpis"><div class="kpi"><span class="label">Received today</span><b class="num">' + c + " " + money(k.today) + '</b><span class="muted" style="font-size:12px">' + (k.today_n || 0) + ' payments</span></div><div class="kpi"><span class="label">Last 7 days</span><b class="num">' + c + " " + money(k.week) + '</b></div><div class="kpi"><span class="label">Waiting to be collected</span><b class="num">' + c + " " + money(k.to_collect) + '</b><span class="muted" style="font-size:12px">' + (k.open_n || 0) + ' invoices</span></div><div class="kpi"><span class="label">Unallocated advances</span><b class="num">' + c + " " + money(k.unallocated) + "</b></div></div>";
			$("#stabs").innerHTML = ["All", "Draft", "Submitted", "Cancelled"].map((t) => '<button class="stab" role="tab" data-st="' + t + '" aria-selected="' + (t === s.tab) + '">' + t + '<span class="c">' + (data.counts[t] || 0) + "</span></button>").join("");
			$$(".stab").forEach((b) => (b.onclick = () => { s.tab = b.dataset.st; reload(); }));
		};
		const reload = () => load(true).then(() => { paint(); rowsHtml(); }).catch((e) => CD.fail(e));
		let tm = 0; $("#lq").oninput = (e) => { s.q = e.target.value; clearTimeout(tm); tm = setTimeout(reload, 280); }; $("#lp").onchange = (e) => { s.per = e.target.value; reload(); };
		$("#more").onclick = () => load(false).then(rowsHtml).catch((e) => CD.fail(e));
		if ($("#newPE")) $("#newPE").onclick = () => CD.nav("payment-entry", "__new");
		$("#lb").onclick = (e) => { const ra = e.target.closest("[data-ra]"); if (ra) { e.stopPropagation(); const name = ra.dataset.ra; CD.menu(ra, [{ l: "Open", fn: () => CD.nav("payment-entry", name) }, { l: "Print receipt", fn: () => printDlg({ name }) }]); return; } const r = e.target.closest("[data-oi]"); if (r) CD.nav("payment-entry", r.dataset.oi); };
		$("#cmdk").onclick = () => CD.palette && CD.palette(); await reload();
	}
	CD.page("payment-entry", {
		list,
		open: async (name) => { if (name === "__new") { const p = CD.pending; CD.pending = null; return show(p && !p.name ? p : await CD.call("payment.new_doc", {})); } const p = CD.pending; CD.pending = null; return show(p && p.name === name ? p : await CD.call("payment.get", { name })); },
		newFrom: async (invoice) => { try { CD.pending = await CD.call("payment.new_from_invoice", { invoice }); CD.go("payment-entry", "__new"); } catch (e) { CD.fail(e, "Cannot start a payment"); } },
	});
})();
