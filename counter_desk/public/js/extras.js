/* Ctrl+K search across invoices, payments, customers and items, plus the new-document commands. */
(function () {
	const CD = window.CD, { $, $$, esc, money } = CD;
	CD.palette = function () {
		const ov = $("#ov");
		ov.innerHTML = '<div class="dlg pal" role="dialog" aria-modal="true" style="grid-template-rows:auto 1fr"><input id="pq" placeholder="Search invoices, payments, customers, items, or type a command" autocomplete="off" aria-label="Search"><div class="rs" id="pr"></div></div>';
		ov.classList.add("on"); ov._o = { actions: [] };
		let sel = 0, res = [], seq = 0, timer = 0; const q = $("#pq");
		const cmds = [["New Sales Invoice", () => CD.nav("sales-invoice", "__new"), CD.boot.can["Sales Invoice"].create], ["New Payment Entry", () => CD.nav("payment-entry", "__new"), CD.boot.can["Payment Entry"].create], ["New Item", () => CD.nav("item", "__new"), CD.boot.can.Item.create], ["New Customer", () => CD.nav("customer", "__new"), CD.boot.can.Customer.create]];
		const paint = () => { $("#pr").innerHTML = res.map((r, i) => '<button data-pi="' + i + '" class="' + (i === sel ? "on" : "") + '"><span>' + esc(r.l) + '</span><small class="muted">' + esc(r.s) + "</small></button>").join("") || '<div class="empty">Nothing found</div>'; };
		const build = async () => {
			const v = q.value.trim().toLowerCase(), my = ++seq;
			res = cmds.filter((c) => c[2] && (!v || c[0].toLowerCase().includes(v))).map((c) => ({ l: c[0], s: "Command", fn: c[1] })); sel = 0; paint();
			if (v.length < 2) return;
			try {
				const [inv, pay, cus, itm] = await Promise.all([CD.call("invoice.list", { txt: v, page_len: 5 }), CD.call("payment.list", { txt: v, page_len: 4 }), CD.call("customer.list", { txt: v, page_len: 4 }), CD.call("item.list", { txt: v, page_len: 5 })]);
				if (my !== seq) return;
				inv.rows.forEach((r) => res.push({ l: r.name, s: (r.customer_name || r.customer) + " · " + r.status + " · " + money(r.grand_total), fn: () => CD.nav("sales-invoice", r.name) }));
				pay.rows.forEach((r) => res.push({ l: r.name, s: (r.party_name || r.party) + " · " + money(r.paid_amount), fn: () => CD.nav("payment-entry", r.name) }));
				cus.rows.forEach((r) => res.push({ l: r.customer_name, s: "Customer · " + r.name, fn: () => CD.nav("customer", r.name) }));
				itm.rows.forEach((r) => res.push({ l: r.item_name, s: "Item · " + r.name, fn: () => CD.nav("item", r.name) })); paint();
			} catch (e) { /* keep commands only */ }
		};
		const run = (i) => { const r = res[i]; if (r) { CD.closeDlg(); r.fn(); } };
		q.oninput = () => { clearTimeout(timer); timer = setTimeout(build, 200); };
		q.onkeydown = (e) => { if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); sel = Math.max(0, Math.min(res.length - 1, sel + (e.key === "ArrowDown" ? 1 : -1))); paint(); } else if (e.key === "Enter") run(sel); };
		$("#pr").onclick = (e) => { const b = e.target.closest("[data-pi]"); if (b) run(+b.dataset.pi); };
		build(); q.focus();
	};
	document.addEventListener("keydown", (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); CD.palette(); } });
})();
