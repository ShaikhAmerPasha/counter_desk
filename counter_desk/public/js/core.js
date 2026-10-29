/* Counter Desk core: helpers, API client, dialogs, menus, router and shell. Screens register themselves with CD.page(). */
(function () {
	const CD = (window.CD = window.CD || {});
	const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
	CD.$ = $; CD.$$ = $$;
	CD.esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
	CD.flt = (v) => { v = parseFloat(v); return isNaN(v) ? 0 : v; };
	CD.rnd = (v, p = 2) => { const m = 10 ** p; return Math.round(v * m + (v >= 0 ? 1e-9 : -1e-9)) / m; };
	CD.money = (v) => Number(v || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
	CD.pad = (n, l = 2) => String(n).padStart(l, "0");
	CD.dstr = (d) => d.getFullYear() + "-" + CD.pad(d.getMonth() + 1) + "-" + CD.pad(d.getDate());
	CD.addDays = (s, n) => { const d = new Date(s + "T00:00:00"); d.setDate(d.getDate() + n); return CD.dstr(d); };
	CD.clone = (o) => JSON.parse(JSON.stringify(o));
	CD.strip = (h) => { const t = document.createElement("div"); t.innerHTML = h; return t.textContent || ""; };

	/* ---------- API ---------- */
	CD.api = async function (method, args = {}) {
		let r;
		try {
			r = await fetch("/api/method/" + method, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", Accept: "application/json", "X-Frappe-CSRF-Token": CD.csrf }, body: JSON.stringify(args) });
		} catch (e) { throw Object.assign(new Error("Cannot reach the server. Check your connection."), { network: true }); }
		const j = await r.json().catch(() => ({}));
		if (r.status === 401 || r.status === 403 && /session|login/i.test(JSON.stringify(j))) { location.href = "/login?redirect-to=/invoicing"; throw new Error("Session expired"); }
		if (!r.ok) throw CD.err(j, r.status);
		return j.message;
	};
	CD.err = function (j, status) {
		let msgs = [];
		try { msgs = JSON.parse(j._server_messages || "[]").map((m) => { try { return JSON.parse(m).message; } catch (e) { return m; } }); } catch (e) { /* ignore */ }
		const text = CD.strip(msgs.join("\n")) || (j.exception ? String(j.exception).split(":").slice(1).join(":").trim() : "") || "Request failed (" + status + ")";
		return Object.assign(new Error(text), { status, messages: msgs.map(CD.strip) });
	};
	CD.call = (m, a) => CD.api("counter_desk.api." + m, a);

	/* ---------- toast, dialogs, menus ---------- */
	CD.toast = function (m, undo) {
		const t = $("#toast");
		t.innerHTML = CD.esc(m) + (undo ? ' <button class="btn sm" id="tundo" style="margin-left:10px">Undo</button>' : "");
		t.style.pointerEvents = undo ? "auto" : "none"; t.classList.add("on");
		if (undo) $("#tundo").onclick = () => { undo(); t.classList.remove("on"); };
		clearTimeout(CD.toast.t); CD.toast.t = setTimeout(() => t.classList.remove("on"), undo ? 6000 : 2600);
	};
	CD.dlg = function (o) {
		const ov = $("#ov");
		ov.innerHTML = '<div class="dlg' + (o.wide ? " wide" : "") + '" role="dialog" aria-modal="true"><header><h2>' + CD.esc(o.title) + '</h2><button class="btn ghost sm" data-dx aria-label="Close">✕</button></header><div class="bd">' + o.body + "</div><footer>" +
			(o.actions || []).map((a, i) => '<button class="btn' + (a.primary ? " primary" : "") + (a.danger ? " danger" : "") + '" data-da="' + i + '">' + CD.esc(a.l) + "</button>").join("") + "</footer></div>";
		ov.classList.add("on"); ov._o = o; if (o.after) o.after();
		const f = $("input,select", ov); if (f && !o.wide) f.focus();
	};
	CD.closeDlg = () => { const ov = $("#ov"); ov.classList.remove("on"); ov.innerHTML = ""; };
	CD.msg = (title, lines) => CD.dlg({ title, body: '<ul class="msglist">' + [].concat(lines).map((l) => "<li>" + CD.esc(l) + "</li>").join("") + "</ul>", actions: [{ l: "OK", primary: 1 }] });
	CD.fail = (e, title) => {
		if (e && e.network) return CD.toast(e.message);
		const all = e && e.messages && e.messages.length ? e.messages : [(e && e.message) || "Unknown error"];
		const lines = [...new Set(all)].filter((a, i, arr) => !arr.some((b, j) => j !== i && b.length > a.length && b.includes(a)));
		CD.msg(title || "Something went wrong", lines);
	};
	CD.confirm = (title, text, label, fn, danger) => CD.dlg({ title, body: '<p style="margin:0">' + CD.esc(text) + "</p>", actions: [{ l: "Cancel" }, { l: label, primary: !danger, danger: !!danger, fn }] });
	let menuEl = null;
	CD.closeMenu = () => { if (menuEl) { menuEl.remove(); menuEl = null; } };
	CD.menu = function (anchor, items) {
		CD.closeMenu(); const m = document.createElement("div"); m.className = "menu";
		m.innerHTML = items.map((x, i) => '<button data-mi="' + i + '" class="' + (x.danger ? "danger" : "") + '">' + CD.esc(x.l) + "</button>").join("");
		document.body.appendChild(m); const r = anchor.getBoundingClientRect();
		m.style.top = r.bottom + 6 + "px"; m.style.left = Math.max(8, Math.min(r.right - 190, innerWidth - 200)) + "px";
		m.onclick = (e) => { const b = e.target.closest("[data-mi]"); if (b) { CD.closeMenu(); items[+b.dataset.mi].fn(); } }; m._ev = window.event; menuEl = m;
	};
	document.addEventListener("click", (e) => {
		if (!e.target.closest(".menu") && !(menuEl && menuEl._ev === e)) CD.closeMenu();
		const ov = $("#ov");
		if (ov.classList.contains("on")) {
			if (e.target === ov || e.target.closest("[data-dx]")) return CD.closeDlg();
			const b = e.target.closest("[data-da]");
			if (b) { const a = ov._o.actions[+b.dataset.da]; Promise.resolve(a.fn ? a.fn() : undefined).then((r) => { if (r !== false) CD.closeDlg(); }); }
		}
	});
	document.addEventListener("keydown", (e) => { if (e.key === "Escape") { CD.closeMenu(); if ($("#ov").classList.contains("on")) CD.closeDlg(); } });

	/* ---------- router and shell ---------- */
	/* "Edit full form" from a quick-create dialog: open the full form prefilled, then resume the document the user was editing */
	CD.openFull = (kind, vals, resume, cancel) => { CD.resume = { resume, cancel }; CD.prefill = vals; CD.guard = null; CD.go(kind, "__new"); };
	CD.finishFull = (r) => { const x = CD.resume; CD.resume = null; if (x) { x.resume(r); return true; } return false; };
	CD.cancelFull = () => { const x = CD.resume; CD.resume = null; if (x) x.cancel(); };
	CD.resumeBanner = (what) => (CD.resume ? '<section class="sec"><div class="sbody" style="padding-top:14px;display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap"><span>Creating a new ' + what + ' for the document you were editing. Save to go back to it.</span><button class="btn sm" data-resume-cancel>Back without saving</button></div></section>' : "");
	CD.pages = {};
	CD.page = (key, def) => { CD.pages[key] = def; };
	CD.NAV = [
		["sales-invoice", "Sales Invoice", '<path d="M7 3h8l4 4v14H7zM15 3v4h4M10 12h6M10 16h6"/>'],
		["payment-entry", "Payments", '<rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="M2.5 10h19M6 15h4"/>'],
		["item", "Items", '<path d="M21 8l-9-5-9 5 9 5zM3 8v8l9 5 9-5V8M12 13v8"/>'],
		["customer", "Customers", '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.7-3.6 3.2-5.5 6.5-5.5s5.8 1.9 6.5 5.5M16 4.8a3.5 3.5 0 010 6.4M18 14.8c2 .6 3.3 2.3 3.8 5.2"/>'],
	];
	CD.crumbs = (parts) => '<div class="topbar"><div class="crumbs">' + parts + '</div><button class="cmdk" id="cmdk"><span>Search invoices, items, customers</span><kbd>Ctrl K</kbd></button></div>';
	CD.main = () => $("#main");
	CD.route = () => { const h = location.hash.replace(/^#\/?/, ""); const [key, ...rest] = h.split("/"); return { key: key || "sales-invoice", arg: decodeURIComponent(rest.join("/") || "") }; };
	CD.go = (key, arg) => { const h = "#/" + key + (arg ? "/" + encodeURIComponent(arg) : ""); if (location.hash === h) CD.render(); else location.hash = h; };
	CD.guard = null; // a screen with unsaved edits sets this to a function returning true when it is safe to leave
	CD.render = async function () {
		const { key, arg } = CD.route();
		const pg = CD.pages[key] || CD.pages["sales-invoice"] || CD.pages.home;
		$$(".nav").forEach((b) => b.setAttribute("aria-current", b.dataset.go === key ? "page" : "false"));
		try { await (arg && pg.open ? pg.open(arg) : pg.list()); } catch (e) { CD.fail(e, "Could not open this screen"); }
		CD.main().scrollTop = 0;
	};
	function shell() {
		const b = CD.boot, u = b.user;
		$("#app").innerHTML = '<nav class="side" aria-label="Main"><div class="brand"><div class="mark">' + CD.esc((b.company.name || "C")[0]) + "</div><span>Invoicing</span></div>" +
			CD.NAV.map((n) => '<button class="nav" data-go="' + n[0] + '"><svg viewBox="0 0 24 24">' + n[2] + "</svg>" + n[1] + '<span class="cnt" id="cnt-' + n[0] + '"></span></button>').join("") +
			'<div class="sp"></div><div class="role"><div class="who"><div class="avatar">' + CD.esc((u.full_name || "U").split(" ").map((x) => x[0]).slice(0, 2).join("").toUpperCase()) + '</div><div style="min-width:0"><b style="display:block">' + CD.esc(u.full_name) + '</b><span class="muted" style="font-size:12px">' + CD.esc(b.company.name) + '</span></div></div><div class="row" style="gap:6px"><button class="btn sm" id="themeBtn">◐ Theme</button><button class="btn sm" id="signout">Sign out</button></div></div></nav><main id="main"></main>';
		$("#app").hidden = false; $("#boot").remove();
		$("#themeBtn").onclick = () => { const r = document.documentElement, dk = r.dataset.theme === "dark" || (!r.dataset.theme && matchMedia("(prefers-color-scheme:dark)").matches); r.dataset.theme = dk ? "light" : "dark"; try { localStorage.setItem("cd-theme", r.dataset.theme); } catch (e) { /* ignore */ } };
		$("#signout").onclick = async () => { try { await fetch("/api/method/logout", { method: "POST", credentials: "same-origin", headers: { "X-Frappe-CSRF-Token": CD.csrf } }); } finally { location.href = "/login"; } };
		$$(".nav").forEach((n) => (n.onclick = () => CD.nav(n.dataset.go)));
	}
	CD.nav = (key, arg) => { if (CD.guard && !CD.guard()) return CD.confirm("Unsaved changes", "Leave without saving?", "Leave", () => { CD.guard = null; CD.go(key, arg); }); CD.go(key, arg); };
	CD.setCount = (key, n) => { const e = $("#cnt-" + key); if (e) e.textContent = n == null ? "" : n; };

	CD.load = function (files) {
		return files.reduce((p, f) => p.then(() => new Promise((res) => {
			const s = document.createElement("script"); s.src = "/assets/counter_desk/js/" + f + "?v=" + Date.now(); s.onload = res; s.onerror = res; document.body.appendChild(s);
		})), Promise.resolve());
	};

	CD.start = async function () {
		if (CD.started) return; CD.started = true;
		try { const t = localStorage.getItem("cd-theme"); if (t) document.documentElement.dataset.theme = t; } catch (e) { /* ignore */ }
		try { CD.boot = await CD.call("common.boot"); } catch (e) { $("#boot").innerHTML = "<b>Invoicing could not start.</b><br>" + CD.esc(e.message) + (e.status === 403 ? '<br>Your account needs the Invoicing User role.' : ""); return; }
		CD.today = CD.boot.today; shell();
		await CD.load(["forms.js", "items.js", "customers.js", "invoices.js", "payments.js", "extras.js"]);
		window.addEventListener("hashchange", () => { if (CD.guard && !CD.guard()) { /* stay: handled by nav guard */ } CD.guard = null; CD.render(); });
		CD.render();
	};
	CD.page("home", { list: async () => {
		CD.main().innerHTML = CD.crumbs("<span>Invoicing</span>") + '<div class="page"><div class="lhead"><h1>Welcome, ' + CD.esc(CD.boot.user.full_name) + '</h1></div><div class="card pad" id="diag"></div></div>';
		const b = CD.boot; CD.$("#diag").innerHTML = "<p><b>Company:</b> " + CD.esc(b.company.name) + " · " + b.company.currency + "</p><p><b>Warehouses:</b> " + b.warehouses.map(CD.esc).join(", ") + "</p><p><b>Modes of payment:</b> " + b.modes_of_payment.map((m) => CD.esc(m.name)).join(", ") + "</p><p><b>ZATCA:</b> " + (b.zatca ? "connected" : "not enabled") + "</p>";
	} });
	document.addEventListener("DOMContentLoaded", CD.start);
	if (document.readyState !== "loading") CD.start();
})();
