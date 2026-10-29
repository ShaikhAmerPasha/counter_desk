// Invoicing-only users use the normal ERPNext desk. They get a calmer skin and see only the fields a small shop needs:
// every field not listed below is hidden for them (other users are not affected). Edit the lists to show more or less.
(function () {
	const KEEP = ["Administrator", "System Manager", "Accounts Manager", "Accounts User", "Sales Manager", "Stock Manager", "Stock User"];
	const ALLOW = {
		"Sales Invoice": {
			fields: ["customer", "customer_name", "tax_id", "posting_date", "due_date", "is_return", "return_against", "update_stock", "set_warehouse", "items", "taxes_and_charges", "taxes",
				"additional_discount_percentage", "discount_amount", "apply_discount_on", "total_qty", "total", "net_total", "total_taxes_and_charges", "grand_total", "rounded_total", "in_words", "outstanding_amount",
				"remarks", "payment_terms_template", "custom_zatca_status", "amended_from"],
			tables: { items: ["item_code", "item_name", "qty", "uom", "rate", "discount_percentage", "amount", "description"], taxes: ["charge_type", "account_head", "description", "rate", "tax_amount", "total"] },
		},
		"Payment Entry": {
			fields: ["payment_type", "posting_date", "mode_of_payment", "party_type", "party", "party_name", "paid_from", "paid_to", "paid_amount", "received_amount", "reference_no", "reference_date", "references", "total_allocated_amount", "unallocated_amount", "remarks", "get_outstanding_invoices"],
			tables: { references: ["reference_doctype", "reference_name", "due_date", "total_amount", "outstanding_amount", "allocated_amount"] },
		},
		Item: {
			fields: ["item_code", "item_name", "item_group", "stock_uom", "disabled", "is_stock_item", "opening_stock", "valuation_rate", "standard_rate", "image", "description", "max_discount", "item_defaults"],
			quick: ["item_code", "item_name", "item_group", "is_stock_item", "standard_rate"],
			tables: { item_defaults: ["company", "default_warehouse"] },
		},
		Customer: {
			fields: ["customer_name", "customer_type", "customer_group", "territory", "tax_id", "mobile_no", "email_id", "disabled", "address_html", "contact_html", "primary_address_and_contact_detail", "customer_primary_address", "customer_primary_contact", "primary_address", "default_price_list", "payment_terms"],
			quick: ["customer_name", "customer_type", "customer_group", "territory", "tax_id", "email_address", "mobile_number", "address_line1", "city", "country"],
			tables: {},
		},
	};
	let invoicing = false;
	function setup() {
		const roles = (window.frappe && frappe.boot && frappe.boot.user && frappe.boot.user.roles) || [];
		invoicing = (roles.includes("Invoicing User") || roles.includes("Invoicing Manager")) && !roles.some((r) => KEEP.includes(r));
		if (!invoicing) return;
		document.body.classList.add("inv-skin");
		if (location.pathname === "/app" || location.pathname === "/app/") frappe.set_route("invoicing");
	}
	if (window.$) $(document).on("startup", setup);

	// "Create a new ..." dialogs show the same short field list; new items are services with a selling rate
	function wrapQuickEntry() {
		const Q = window.frappe && frappe.ui && frappe.ui.form && frappe.ui.form.QuickEntryForm;
		if (!Q) return setTimeout(wrapQuickEntry, 300);
		const orig = Q.prototype.render_dialog;
		Q.prototype.render_dialog = function () {
			const cfg = ALLOW[this.doctype];
			if (invoicing && cfg) {
				const keep = cfg.quick || cfg.fields;
				this.mandatory = this.mandatory.filter((df) => keep.includes(df.fieldname) || (df.reqd && !df.default && !df.read_only));
				if (this.doctype === "Item") {
					if (this.doc) this.doc.is_stock_item = 0;
					if (!this.mandatory.some((d) => d.fieldname === "standard_rate")) this.mandatory.push({ fieldname: "standard_rate", label: __("Selling Rate"), fieldtype: "Currency" });
				}
			}
			const out = orig.apply(this, arguments);
			if (invoicing && this.doctype === "Customer" && this.dialog) {
				this.dialog.set_value("customer_type", "Individual");
				this.dialog.set_value("country", (frappe.boot.sysdefaults && frappe.boot.sysdefaults.country) || "Saudi Arabia");
			}
			return out;
		};
	}
	wrapQuickEntry();

	const LAYOUT = ["Section Break", "Column Break", "Tab Break"];
	// a spa mostly sells services: new items start as services and new invoices leave stock alone, but Maintain Stock / Update Stock stay available.
	function defaults(frm) {
		if (!frm.is_new() || frm.__inv_init) return;
		frm.__inv_init = true;
		if (frm.doctype === "Sales Invoice") { if (frm.doc.update_stock) frm.set_value("update_stock", 0); if (frm.doc.is_pos) frm.set_value("is_pos", 0); }
		if (frm.doctype === "Item" && frm.doc.is_stock_item) frm.set_value("is_stock_item", 0);
		if (frm.doctype === "Payment Entry" && !frm.doc.mode_of_payment) frm.set_value("mode_of_payment", "Cash");
	}
	// buttons for documents a spa never creates from an invoice
	const DROP_BUTTONS = { "Create": ["Delivery Note", "Invoice Discounting", "Dunning", "Maintenance Schedule", "Pick List", "Sales Order", "Quotation"], "Get Items From": ["Sales Order", "Delivery Note", "Quotation", "Timesheet"] };
	function dropButtons(frm) {
		if (frm.doctype !== "Sales Invoice") return;
		const run = () => Object.keys(DROP_BUTTONS).forEach((g) => DROP_BUTTONS[g].forEach((b) => frm.remove_custom_button(b, g)));
		setTimeout(run, 300); setTimeout(run, 1200);
	}
	function trim(frm) {
		const cfg = ALLOW[frm.doctype];
		if (!invoicing || !cfg) return;
		defaults(frm);
		dropButtons(frm);
		frm.meta.fields.forEach((df) => {
			if (df.fieldname === "company" && frm.doc.company) return frm.set_df_property("company", "hidden", 1); // single-company shop
			if (LAYOUT.includes(df.fieldtype) || cfg.fields.includes(df.fieldname)) return;
			if (df.fieldname === "naming_series" && !frm.doc.naming_series && df.options) { const first = df.options.split("\n").find(Boolean); if (first) frm.doc.naming_series = first; }
			if (df.reqd && !df.default && !df.read_only && df.fieldtype !== "Table" && !frm.doc[df.fieldname]) return; // never hide a required field that is still empty
			frm.set_df_property(df.fieldname, "hidden", 1);
		});
		// a section or tab whose fields are all hidden is hidden as well
		let group = [], head = null;
		const flush = () => { if (head && group.length && group.every((d) => d.hidden || frm.get_field(d.fieldname) && frm.get_field(d.fieldname).df.hidden)) frm.set_df_property(head.fieldname, "hidden", 1); };
		frm.meta.fields.forEach((df) => { if (df.fieldtype === "Section Break") { flush(); head = df; group = []; } else if (!LAYOUT.includes(df.fieldtype)) group.push(df); });
		flush();
		Object.keys(cfg.tables).forEach((t) => {
			const grid = frm.fields_dict[t] && frm.fields_dict[t].grid;
			if (!grid) return;
			let changed = false;
			(grid.docfields || []).forEach((d) => {
				const keep = cfg.tables[t].includes(d.fieldname) || (d.reqd && !d.default && !d.read_only);
				if (!keep && !d.hidden) { grid.update_docfield_property(d.fieldname, "hidden", 1); changed = true; }
				else if (d.in_list_view && !cfg.tables[t].includes(d.fieldname) && !keep) { grid.update_docfield_property(d.fieldname, "in_list_view", 0); changed = true; }
			});
			if (changed) grid.reset_grid();
		});
		// layout containers whose fields are all hidden disappear too
		setTimeout(() => {
			(frm.layout.tabs || []).forEach((tab) => { const vis = (tab.fields_list || []).some((f) => !f.df.hidden && !LAYOUT.includes(f.df.fieldtype)); if (tab.label !== "Details" || !vis) tab.toggle && tab.toggle(vis || tab === frm.layout.tabs[0]); });
		}, 50);
	}
	Object.keys(ALLOW).forEach((dt) => {
		const wait = () => (window.frappe && frappe.ui && frappe.ui.form && frappe.ui.form.on ? frappe.ui.form.on(dt, { refresh: trim, onload_post_render: trim }) : setTimeout(wait, 200));
		wait();
	});
})();
