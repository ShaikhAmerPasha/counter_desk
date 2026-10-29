/* Counter Desk form engine: schema-driven documents (tabs > sections > columns > fields, plus child grids). */
(function () {
	const CD = window.CD, { $, $$, esc, flt, rnd, money } = CD;
	const F = (t, n, l, x) => Object.assign({ t, n, l }, x || {});
	const T = (n, l, cols, x) => F("Table", n, l, Object.assign({ cols }, x || {}));
	CD.F = F; CD.T = T;
	const NUMT = new Set(["Int", "Float", "Currency", "Percent"]);

	/* ---------- titles and link sources ---------- */
	CD.titles = {};
	CD.setTitle = (dt, name, title) => { if (name && title) (CD.titles[dt] = CD.titles[dt] || {})[name] = title; };
	CD.titleOf = (dt, n) => (CD.titles[dt] && CD.titles[dt][n]) || n || "";
	const STATIC = { Warehouse: () => CD.boot.warehouses, UOM: () => CD.boot.uoms, "Item Group": () => CD.boot.item_groups, "Price List": () => CD.boot.price_lists, Territory: () => CD.boot.territories, "Customer Group": () => CD.boot.customer_groups,
		"Payment Terms Template": () => CD.boot.payment_terms, "Letter Head": () => CD.boot.letter_heads, "Sales Taxes and Charges Template": () => CD.boot.tax_templates.map((t) => t.name), "Mode of Payment": () => CD.boot.modes_of_payment.map((m) => m.name), Company: () => [CD.boot.company.name], Currency: () => [CD.boot.company.currency] };
	const DESC = { Customer: (r) => [r.customer_group, r.tax_id].filter(Boolean).join(" · "), Item: (r) => r.item_name + (r.stock_uom ? " · " + r.stock_uom : ""), Account: (r) => r.account_type || "", Address: (r) => r.address_line1 || "", "Mode of Payment": (r) => r.type || "" };
	const TITLE = { Customer: "customer_name", Item: "item_name" };
	CD.linkOpts = async function (dt, txt, flt_) {
		if (dt === "ItemAdd") dt = "Item";
		if (dt === "SIOut") { const rows = await CD.call("payment.invoice_options", { party: CD.form && CD.form.doc.party || null, txt: txt || "" }); return rows.map((r) => ({ v: r.name, s: (r.customer_name || r.customer) + " · outstanding " + CD.money(r.outstanding_amount) + " · due " + r.due_date })); }
		const q = (txt || "").toLowerCase();
		if (STATIC[dt] && !flt_) return STATIC[dt]().filter((v) => !q || v.toLowerCase().includes(q)).slice(0, 40).map((v) => ({ v, s: "" }));
		const rows = await CD.call("common.link_search", { doctype: dt, txt: txt || "", filters: flt_ ? { account_type: flt_ } : undefined });
		return rows.map((r) => { const title = TITLE[dt] ? r[TITLE[dt]] : ""; if (title) CD.setTitle(dt, r.name, title); return { v: r.name, t: title, s: (DESC[dt] ? DESC[dt](r) : ""), x: r }; });
	};
	CD.resolveLink = async function (dt, v) {
		const q = v.trim().toLowerCase(); if (!q) return "";
		const opts = await CD.linkOpts(dt, v, null);
		const hit = opts.find((o) => o.v.toLowerCase() === q || (o.t || "").toLowerCase() === q) || (opts.length === 1 ? opts[0] : null);
		return hit ? hit.v : null;
	};

	/* ---------- dropdown ---------- */
	const dd = () => $("#dd");
	let ddIn = null, ddItems = [], ddSel = 0, ddTimer = 0, ddSeq = 0;
	function ddHide() { dd().style.display = "none"; ddIn = null; }
	async function ddShow(inp) {
		ddIn = inp; const seq = ++ddSeq, dt = inp.dataset.link, txt = inp.value;
		let opts = []; try { opts = await CD.linkOpts(dt, dt === "ItemAdd" ? txt : (CD.titleOf(dt, txt) === txt ? txt : ""), inp.dataset.flt || null); } catch (e) { opts = []; }
		if (seq !== ddSeq || ddIn !== inp) return;
		ddItems = opts; ddSel = opts.length ? 0 : -1;
		let h = opts.map((x, i) => '<button data-di="' + i + '" class="' + (i === 0 ? "on" : "") + '"><span>' + esc(x.t || x.v) + "</span>" + (x.s || (x.t ? x.v : "") ? "<small>" + esc(x.s || x.v) + "</small>" : "") + "</button>").join("");
		const f = CD.form && CD.form.hooks.canCreate && CD.form.hooks.canCreate(dt);
		if (f) h += '<button class="new" data-dnew="' + esc(dt) + '">+ Create a new ' + esc(f) + (txt ? ' "' + esc(txt) + '"' : "") + "</button>";
		if (!h) h = '<div class="empty" style="padding:14px">No results</div>';
		const d = dd(); d.innerHTML = h; const r = inp.getBoundingClientRect();
		d.style.display = "block"; d.style.left = Math.min(r.left, innerWidth - 250) + "px"; d.style.width = Math.max(r.width, 260) + "px";
		const below = innerHeight - r.bottom > 220; d.style.top = below ? r.bottom + 4 + "px" : "auto"; d.style.bottom = below ? "auto" : innerHeight - r.top + 4 + "px";
	}
	function ddPick(i) { const x = ddItems[i]; if (!x || !ddIn) return; const inp = ddIn; ddHide(); if (CD.form) CD.form.pickLink(inp, x); }
	(() => {
		dd().addEventListener("mousedown", (e) => {
			e.preventDefault(); const b = e.target.closest("[data-di]"); if (b) return ddPick(+b.dataset.di);
			const n = e.target.closest("[data-dnew]"); if (n && ddIn) { const inp = ddIn, v = inp.value; ddHide(); CD.form.hooks.quickCreate(n.dataset.dnew, v, inp); }
		});
	})();
	document.addEventListener("input", (e) => { const el = e.target; if (el.dataset && el.dataset.link && CD.form && CD.form.host.contains(el)) { clearTimeout(ddTimer); ddTimer = setTimeout(() => ddShow(el), 160); } });
	document.addEventListener("focusin", (e) => { const el = e.target; if (el.dataset && el.dataset.link && CD.form && CD.form.host.contains(el) && !el.readOnly && !el.disabled) { el.select && el.select(); ddShow(el); } });
	document.addEventListener("focusout", (e) => { if (e.target.dataset && e.target.dataset.link) setTimeout(ddHide, 150); });
	document.addEventListener("keydown", (e) => {
		if (e.key === "Escape") ddHide();
		if (ddIn && dd().style.display === "block" && ["ArrowDown", "ArrowUp", "Enter"].includes(e.key)) {
			e.preventDefault(); if (e.key === "Enter") return ddPick(Math.max(0, ddSel));
			ddSel = Math.max(0, Math.min(ddItems.length - 1, ddSel + (e.key === "ArrowDown" ? 1 : -1))); $$("#dd [data-di]").forEach((b, i) => b.classList.toggle("on", i === ddSel));
		}
	});

	/* ---------- the form ---------- */
	class Form {
		constructor(cfg) { Object.assign(this, cfg); this.tab = 0; this.dirty = false; this.exp = null; this.deps = []; this.hooks = cfg.hooks || {}; this.index = {}; this.indexSchema(); }
		indexSchema() {
			this.schema.tabs.forEach((tb) => (tb.secs || []).forEach((s) => { (s.cols || []).forEach((c) => c.forEach((f) => (this.index["|" + f.n] = f))); (s.foot || []).forEach((tf) => { this.index["@" + tf.n] = tf; tf.cols.forEach((c) => (this.index[tf.n + "|" + c.n] = c)); (tf.detail || []).forEach((c) => (this.index[tf.n + "|" + c.n] = this.index[tf.n + "|" + c.n] || c)); }); }));
		}
		fd(t, n) { return this.index[(t || "") + "|" + n]; }
		get locked() { return this.hooks.locked ? this.hooks.locked(this) : (this.doc.docstatus || 0) !== 0; }
		mount() {
			CD.form = this; this.host = CD.main();
			this.host.innerHTML = CD.crumbs('<a data-go="' + this.dtk + '">' + esc(this.dtLabel) + '</a><span>/</span><span id="crn"></span>') + '<div class="fhead" id="fhead"></div><div class="tabs" role="tablist" id="tabs"></div><div class="fbody"><div class="fmain" id="fmain"></div><aside class="rail" id="rail"></aside></div>';
			this.bind(); this.renderTabs(); this.renderTab(); this.refresh(); this.renderHead(); this.renderRail(); this.fh();
		}
		fh() { const h = $("#fhead"); if (h) document.documentElement.style.setProperty("--fh", h.offsetHeight + "px"); }
		bind() {
			const h = this.host;
			h.onclick = (e) => this.click(e);
			h.oninput = (e) => { const el = e.target; if (!el.dataset || !el.dataset.f || el.dataset.link || ["checkbox", "date", "time"].includes(el.type) || el.tagName === "SELECT") return; this.set(el, el.value); };
			h.onchange = async (e) => {
				const el = e.target; if (!el.dataset || !el.dataset.f) return;
				if (el.dataset.link) { await this.commitLink(el); return; }
				if (el.type === "checkbox") this.set(el, el.checked); else if (el.tagName === "SELECT" || ["date", "time"].includes(el.type)) this.set(el, el.value);
			};
			h.onkeydown = (e) => { if (this.hooks.keydown) this.hooks.keydown(this, e); };
		}
		/* ---- rendering ---- */
		fieldHTML(f, sc) {
			const t = sc.t || "", r = sc.r == null ? "" : sc.r, cell = !!sc.cell; let dk = "";
			if (f.dep) { this.deps.push(f.dep); dk = ' data-dk="' + (this.deps.length - 1) + '"'; }
			const id = "f-" + t + "-" + r + "-" + f.n, at = ' data-f="' + f.n + '" data-t="' + t + '" data-r="' + r + '" id="' + id + '"'; let inp;
			if (f.t === "Check") return '<div class="fld"' + dk + ' data-fn="' + f.n + '"><label class="chk"><input type="checkbox"' + at + "><span>" + esc(f.l) + "</span></label>" + (f.desc ? '<span class="d">' + esc(f.desc) + "</span>" : "") + "</div>";
			if (f.t === "Select") inp = '<select class="in"' + at + ">" + f.o.map((o) => '<option value="' + esc(o) + '">' + esc(o || " ") + "</option>").join("") + "</select>";
			else if (f.t === "Link") inp = '<input class="in" type="text" autocomplete="off" placeholder="' + esc(f.ph || "") + '" data-link="' + esc(f.o) + '" data-flt="' + esc(f.flt || "") + '"' + at + ">";
			else if (f.t === "Text") inp = '<textarea class="in" rows="' + (f.rows || 3) + '"' + at + "></textarea>";
			else if (f.t === "Date") inp = '<input class="in" type="date"' + at + ">";
			else if (f.t === "Time") inp = '<input class="in" type="time" step="1"' + at + ">";
			else if (NUMT.has(f.t)) inp = '<input class="in" ' + (f.ro ? 'type="text"' : 'type="number" step="any"') + at + ">";
			else inp = '<input class="in" type="text"' + (f.ph ? ' placeholder="' + esc(f.ph) + '"' : "") + (f.ar ? ' dir="rtl" style="font-family:var(--ar)"' : "") + at + ">";
			return '<div class="fld' + (NUMT.has(f.t) ? " num-f" : "") + '"' + dk + ' data-fn="' + f.n + '">' + (cell ? "" : '<label for="' + id + '">' + esc(f.l) + (f.req ? '<span class="req">*</span>' : "") + "</label>") + inp + (f.desc && !cell ? '<span class="d">' + esc(f.desc) + "</span>" : "") + "</div>";
		}
		tableHTML(f) {
			const doc = this.doc, rows = doc[f.n] || [], cols = f.cols.filter((c) => !c.dep || c.dep(doc));
			const head = cols.map((c) => '<th class="' + (NUMT.has(c.t) ? "r" : "") + '" style="min-width:' + (c.w || 100) + 'px">' + esc(c.l) + (c.req ? '<span class="req">*</span>' : "") + "</th>").join("");
			const body = rows.map((r, i) => {
				const open = this.exp === f.n + ":" + i;
				let h = '<tr data-r="' + i + '"><td class="gi">' + (i + 1) + "</td>" + cols.map((c) => "<td>" + this.fieldHTML(c, { t: f.n, r: i, cell: 1 }) + "</td>").join("") + '<td class="gact">' + (f.detail ? '<button data-exp="' + f.n + ":" + i + '" aria-label="Edit row" title="Edit row">' + (open ? "▴" : "▾") + "</button>" : "") + '<button data-del="' + f.n + ":" + i + '" aria-label="Delete row" title="Delete row">✕</button></td></tr>';
				if (open) h += '<tr class="gdet"><td colspan="' + (cols.length + 2) + '"><div class="gdet-g">' + f.detail.map((d) => this.fieldHTML(d, { t: f.n, r: i })).join("") + "</div></td></tr>";
				return h;
			}).join("") || '<tr><td class="gempty" colspan="' + (cols.length + 2) + '">' + esc(f.empty || "No rows yet") + "</td></tr>";
			return '<div class="tbl-w" data-tn="' + f.n + '"><div class="gscroll"><table class="gt"><thead><tr><th class="gi">#</th>' + head + "<th></th></tr></thead><tbody>" + body + "</tbody></table></div>" + (f.noadd ? "" : '<div class="gfoot"><button class="btn sm" data-add="' + f.n + '">+ Add Row</button>' + (f.tools ? f.tools(this) : "") + "</div>") + "</div>";
		}
		secHTML(s) {
			let dk = ""; if (s.dep) { this.deps.push(s.dep); dk = ' data-dk="' + (this.deps.length - 1) + '"'; }
			const cols = (s.cols || []).filter((c) => c.length);
			return '<section class="sec' + (s.col ? " col" : "") + (s.shut ? " shut" : "") + (s.nolabel ? " nolabel" : "") + '"' + dk + '><h3 data-tog>' + esc(s.l || "") + "</h3>" +
				(cols.length ? '<div class="cols" style="grid-template-columns:repeat(' + cols.length + ',minmax(0,1fr))">' + cols.map((c) => '<div class="col-c">' + c.map((f) => this.fieldHTML(f, {})).join("") + "</div>").join("") + "</div>" : "") +
				(s.foot || []).map((f) => { let k = ""; if (f.dep) { this.deps.push(f.dep); k = ' data-dk="' + (this.deps.length - 1) + '"'; } return '<div class="sbody"' + k + ">" + this.tableHTML(f) + "</div>"; }).join("") + "</section>";
		}
		renderTabs() { this.tabsVisible = this.schema.tabs.map((t, i) => [t, i]).filter(([t]) => !t.dep || t.dep(this.doc)); $("#tabs").innerHTML = this.tabsVisible.map(([t, i]) => '<button class="tab" role="tab" data-tab="' + i + '" aria-selected="' + (i === this.tab) + '">' + esc(t.l) + "</button>").join(""); }
		renderTab() {
			const tab = this.schema.tabs[this.tab]; this.deps = [];
			const h = tab.html ? this.hooks.tabHtml[tab.html](this) : (tab.secs || []).map((s) => this.secHTML(s)).join("");
			$("#fmain").innerHTML = (this.tab === 0 && this.hooks.before ? this.hooks.before(this) : "") + h + (this.tab === 0 && this.hooks.after ? this.hooks.after(this) : "");
			$("#fmain").classList.toggle("locked", this.locked);
		}
		renderTable(tn) { const w = $('[data-tn="' + tn + '"]', this.host); if (w) w.outerHTML = this.tableHTML(this.index["@" + tn]); }
		renderHead() {
			const h = this.hooks.head(this), el = $("#fhead"); if (!el) return;
			$("#crn").textContent = h.title;
			el.innerHTML = '<button class="back" data-go="' + this.dtk + '" aria-label="Back to list">←</button><div class="tt"><h1>' + esc(h.title) + (this.dirty || h.unsaved ? '<span class="pill bad">Not Saved</span>' : h.status || "") + (h.chips || "") + '</h1><span class="muted">' + (h.sub || "") + "</span></div><div class=\"acts\">" +
				(h.acts || []).map((a) => '<button class="btn' + (a.primary ? " primary" : "") + '" data-act="' + a.k + '"' + (a.title ? ' title="' + esc(a.title) + '"' : "") + ">" + (a.html || esc(a.l)) + "</button>").join("") + "</div>";
			this.fh();
		}
		renderRail() { const r = $("#rail"); if (r && this.hooks.rail) { r.innerHTML = this.hooks.rail(this) || ""; if (this.hooks.railBound) this.hooks.railBound(this); } }
		refresh() {
			const d = this.doc, locked = this.locked;
			$$("#fmain [data-f]").forEach((el) => {
				const t = el.dataset.t, r = el.dataset.r, obj = t ? (d[t] || [])[+r] : d; if (!obj) return;
				const f = this.fd(t, el.dataset.f); if (!f) return; let v = obj[f.n];
				if (el.type === "checkbox") el.checked = !!flt(v);
				else if (el !== document.activeElement || f.ro) {
					let sv = v == null ? "" : v;
					if (f.t === "Link" && sv) sv = CD.titleOf(f.o, sv);
					else if (f.ro && NUMT.has(f.t)) sv = f.t === "Int" || f.t === "Float" ? sv : money(sv);
					if (el.value !== String(sv)) el.value = sv;
				}
				const fe = el.closest(".fld"); if (fe && !t) fe.classList.toggle("blank", locked && f.t !== "Check" && (v == null || v === "" || v === 0));
				const rol = f.ro || (f.roIf && f.roIf(d, obj, this));
				el.readOnly = !!rol; el.disabled = (locked && !f.aos) || (!!rol && (el.tagName === "SELECT" || el.type === "checkbox"));
			});
			$$("#fmain [data-dk]").forEach((el) => { const fn = this.deps[+el.dataset.dk]; const row = el.closest("tr"); const o = row && row.dataset.r != null ? d[row.closest("[data-tn]").dataset.tn][+row.dataset.r] : d; el.hidden = !fn(d, o); });
			if (this.hooks.afterRefresh) this.hooks.afterRefresh(this);
			if (this.tabsVisible && this.tabsVisible.length !== this.schema.tabs.filter((t) => !t.dep || t.dep(d)).length) this.renderTabs();
		}
		markErr(names) { $$("#fmain .fld").forEach((e) => e.classList.remove("err")); (names || []).forEach((n) => { const e = $('#fmain [data-fn="' + n + '"]'); if (e) e.classList.add("err"); }); }
		setDirty(v = true) { this.dirty = v; CD.guard = v ? () => !this.dirty : null; }
		/* ---- value changes ---- */
		async set(el, v) {
			const d = this.doc, t = el.dataset.t, r = +el.dataset.r, n = el.dataset.f, obj = t ? d[t][r] : d, f = this.fd(t, n); if (!f) return;
			if (NUMT.has(f.t)) v = flt(v); else if (f.t === "Check") v = v ? 1 : 0;
			obj[n] = v; this.setDirty();
			let rr = null; if (this.hooks.change) rr = await this.hooks.change(this, obj, t, n, r, f);
			this.after(rr, n);
		}
		after(rr, n) {
			if (rr === "tab") this.renderTab(); else if (rr) [].concat(rr).forEach((x) => this.renderTable(x));
			if (this.hooks.recalc) this.hooks.recalc(this);
			this.refresh(); this.renderHead(); this.renderRail();
		}
		async commitLink(el) {
			const f = this.fd(el.dataset.t, el.dataset.f), v = el.value.trim();
			if (this.hooks.linkRaw && (await this.hooks.linkRaw(this, el, v))) return;
			if (f.o === "ItemAdd") return;
			if (!v) return this.set(el, "");
			const cur = (el.dataset.t ? this.doc[el.dataset.t][+el.dataset.r] : this.doc)[f.n];
			if (CD.titleOf(f.o, cur) === v || cur === v) { this.refresh(); return; }
			let hit = null; try { hit = await CD.resolveLink(f.o, v); } catch (e) { hit = null; }
			if (hit) this.set(el, hit); else { CD.toast("Could not find " + v); this.refresh(); }
		}
		pickLink(inp, x) {
			if (this.hooks.linkPick && this.hooks.linkPick(this, inp, x)) return;
			if (x.t) CD.setTitle(inp.dataset.link, x.v, x.t); inp.value = x.t || x.v; this.set(inp, x.v);
		}
		click(e) {
			const g = e.target.closest("[data-go]"); if (g) return CD.nav(g.dataset.go);
			if (e.target.closest("#cmdk")) return CD.palette && CD.palette();
			const tab = e.target.closest("[data-tab]"); if (tab) { this.tab = +tab.dataset.tab; this.renderTabs(); this.renderTab(); this.refresh(); return; }
			const tg = e.target.closest("[data-tog]"); if (tg && tg.parentElement.classList.contains("col")) { tg.parentElement.classList.toggle("shut"); return; }
			const add = e.target.closest("[data-add]");
			if (add) { const tn = add.dataset.add, f = this.index["@" + tn]; (this.doc[tn] = this.doc[tn] || []).push(f.newRow ? f.newRow(this) : {}); this.setDirty(); if (this.hooks.recalc) this.hooks.recalc(this); this.renderTable(tn); this.refresh(); this.renderHead(); this.renderRail(); const last = $$('[data-tn="' + tn + '"] tbody tr[data-r]').pop(); if (last) { const i = $("input,select", last); if (i) i.focus(); } return; }
			const del = e.target.closest("[data-del]");
			if (del) { const [tn, i] = del.dataset.del.split(":"); const gone = this.doc[tn].splice(+i, 1)[0]; this.exp = null; this.setDirty(); if (this.hooks.recalc) this.hooks.recalc(this); this.renderTable(tn); this.refresh(); this.renderHead(); this.renderRail(); CD.toast("Row removed", () => { this.doc[tn].splice(+i, 0, gone); this.setDirty(); if (this.hooks.recalc) this.hooks.recalc(this); this.renderTable(tn); this.refresh(); this.renderRail(); }); return; }
			const ex = e.target.closest("[data-exp]"); if (ex) { this.exp = this.exp === ex.dataset.exp ? null : ex.dataset.exp; this.renderTable(ex.dataset.exp.split(":")[0]); this.refresh(); return; }
			const a = e.target.closest("[data-act]"); if (a && this.hooks.act) return this.hooks.act(this, a.dataset.act, a);
			if (this.hooks.click) this.hooks.click(this, e);
		}
	}
	CD.Form = Form;
	document.addEventListener("keydown", (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s" && CD.form && CD.form.host && CD.form.host.isConnected && !CD.form.locked) { e.preventDefault(); if (CD.form.hooks.act) CD.form.hooks.act(CD.form, "save"); } });
})();
