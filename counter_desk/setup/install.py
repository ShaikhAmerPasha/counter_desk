import frappe
from frappe.permissions import add_permission, update_permission_property

COUNTER_USER = "Invoicing User"
COUNTER_MANAGER = "Invoicing Manager"
# Roles that mean "this person is not only a counter user" and may keep the standard desk.
DESK_ROLES = {"Administrator", "System Manager", "Accounts Manager", "Accounts User", "Sales Manager", "Stock Manager", "Stock User"}

# doctype -> rights for Invoicing User / extra rights for Invoicing Manager
USER_PERMS = {
    "Sales Invoice": ["read", "write", "create", "submit", "print", "delete"],
    "Payment Entry": ["read", "write", "create", "submit", "print", "delete"],
    "Item": ["read", "write", "create"],
    "Customer": ["read", "write", "create"],
}
# names only: ERPNext checks these while validating invoices (for example the receivable account)
SELECT_ONLY = ["Account", "Cost Center", "Warehouse", "Mode of Payment", "Price List", "Sales Taxes and Charges Template", "Payment Terms Template", "UOM", "Item Group", "Territory", "Customer Group", "POS Profile"]
# ERPNext writes these as side effects of saving an item (its price) or a customer (primary address and contact)
SIDE_EFFECT = {"Item Price": ["read", "write", "create"], "Contact": ["read", "write", "create"], "Address": ["read", "write", "create"], "Print Format": ["read"], "Letter Head": ["read"], "Bank Account": ["read"], "Company": ["read"]}
MANAGER_EXTRA = {
    "Sales Invoice": ["cancel", "amend"],
    "Payment Entry": ["cancel", "amend"],
}


def is_counter_only(user):
    roles = set(frappe.get_roles(user))
    return bool(roles & {COUNTER_USER, COUNTER_MANAGER}) and not (roles & DESK_ROLES)


def after_install():
    ensure_roles()
    ensure_permissions()
    ensure_settings()
    ensure_workspace()
    ensure_print_format()


def after_migrate():
    ensure_roles()
    ensure_permissions()
    ensure_workspace()
    ensure_print_format()


def ensure_roles():
    for role in (COUNTER_USER, COUNTER_MANAGER):
        if not frappe.db.exists("Role", role):
            frappe.get_doc({"doctype": "Role", "role_name": role, "desk_access": 1, "is_custom": 1}).insert(ignore_permissions=True)


def _grant(doctype, role, rights):
    if not frappe.db.exists("Custom DocPerm", {"parent": doctype, "role": role, "permlevel": 0}):
        add_permission(doctype, role, 0)
    for r in rights:
        update_permission_property(doctype, role, 0, r, 1)


def ensure_permissions():
    for dt, rights in USER_PERMS.items():
        _grant(dt, COUNTER_USER, rights)
        _grant(dt, COUNTER_MANAGER, rights + MANAGER_EXTRA.get(dt, []))
    # the Invoicing workspace only shows for a module the user can open, so they may read the (harmless) settings record
    for role in (COUNTER_USER, COUNTER_MANAGER):
        _grant("Counter Desk Settings", role, ["read"])
    for dt, rights in SIDE_EFFECT.items():
        for role in (COUNTER_USER, COUNTER_MANAGER):
            _grant(dt, role, rights)
    for dt in SELECT_ONLY:
        for role in (COUNTER_USER, COUNTER_MANAGER):
            _grant(dt, role, ["select"])
    frappe.clear_cache()


def ensure_settings():
    s = frappe.get_single("Counter Desk Settings")
    if not s.company:
        s.company = frappe.defaults.get_global_default("company") or frappe.db.get_value("Company", {}, "name")
    # new Single docs pick up the installing user's link defaults, which may belong to another company
    for f, dt in (("default_warehouse", "Warehouse"), ("default_tax_template", "Sales Taxes and Charges Template")):
        if s.get(f) and frappe.db.get_value(dt, s.get(f), "company") != s.company:
            s.set(f, None)
    s.save(ignore_permissions=True)


def make_counter_user(email, first_name, last_name="", manager=0, password=None):
    """Create a counter login:  bench --site <site> execute counter_desk.setup.install.make_counter_user --kwargs "{'email': 'sara@example.com', 'first_name': 'Sara'}" """
    ensure_roles()
    if frappe.db.exists("User", email):
        user = frappe.get_doc("User", email)
    else:
        user = frappe.get_doc({"doctype": "User", "email": email, "first_name": first_name, "last_name": last_name, "enabled": 1, "user_type": "System User", "send_welcome_email": 0 if password else 1})
        if password:
            user.new_password = password
        user.insert(ignore_permissions=True)
    role = COUNTER_MANAGER if int(manager) else COUNTER_USER
    if role not in [r.role for r in user.roles]:
        user.append("roles", {"role": role})
        user.save(ignore_permissions=True)
    lock_to_invoicing(email)
    return f"{email} can use Counter Desk as {role}"


WORKSPACE = "Invoicing"
SHORTCUTS = [
    ("Sales Invoice", "Sales Invoice", "green", "{} unpaid", {"docstatus": 1, "status": ["in", ["Unpaid", "Partly Paid", "Overdue"]]}),
    ("Payment Entry", "Payment Entry", "blue", "{} drafts", {"docstatus": 0}),
    ("Item", "Item", "orange", "", None),
    ("Customer", "Customer", "purple", "", None),
]


def ensure_workspace():
    """One workspace holding only the four doctypes invoicing users need, visible only to their roles."""
    import json

    blocks = [{"id": "hd", "type": "header", "data": {"text": '<span class="h4"><b>Invoicing</b></span>', "col": 12}}]
    blocks += [{"id": "sc%d" % i, "type": "shortcut", "data": {"shortcut_name": label, "col": 3}} for i, (label, *_rest) in enumerate(SHORTCUTS)]
    doc = frappe.get_doc("Workspace", WORKSPACE) if frappe.db.exists("Workspace", WORKSPACE) else frappe.new_doc("Workspace")
    doc.update({"label": WORKSPACE, "title": WORKSPACE, "module": "Counter Desk", "public": 1, "icon": "file-text", "is_hidden": 0, "content": json.dumps(blocks), "sequence_id": 1})
    doc.set("shortcuts", [])
    for label, link, color, fmt, stats in SHORTCUTS:
        doc.append("shortcuts", {"label": label, "type": "DocType", "link_to": link, "doc_view": "List", "color": color, "format": fmt, "stats_filter": json.dumps(stats) if stats else ""})
    doc.set("roles", [{"role": COUNTER_USER}, {"role": COUNTER_MANAGER}])
    doc.save(ignore_permissions=True) if doc.name else doc.insert(ignore_permissions=True)


def lock_to_invoicing(user):
    """Hide every module except Invoicing and open the Invoicing workspace on login."""
    u = frappe.get_doc("User", user)
    u.set("block_modules", [{"module": m} for m in frappe.get_all("Module Def", pluck="name") if m != "Counter Desk"])
    u.default_workspace = WORKSPACE
    u.save(ignore_permissions=True)
    apply_user_defaults(user)


PRINT_FORMAT = "Counter Desk Tax Invoice"


def ensure_print_format():
    """ZATCA-style bilingual tax invoice with a QR block. Rewritten on every migrate so the template file stays the source of truth."""
    import os

    html = open(os.path.join(os.path.dirname(__file__), "..", "templates", "print", "tax_invoice.html"), encoding="utf-8").read()
    doc = frappe.get_doc("Print Format", PRINT_FORMAT) if frappe.db.exists("Print Format", PRINT_FORMAT) else frappe.new_doc("Print Format")
    doc.update({"name": PRINT_FORMAT, "doc_type": "Sales Invoice", "module": "Counter Desk", "standard": "No", "custom_format": 1, "print_format_type": "Jinja", "html": html, "disabled": 0,
                "margin_top": 10, "margin_bottom": 10, "margin_left": 10, "margin_right": 10, "align_labels_right": 0, "show_section_headings": 0, "line_breaks": 0})
    doc.save(ignore_permissions=True) if doc.creation else doc.insert(ignore_permissions=True)
    settings = frappe.get_single("Counter Desk Settings")
    if not settings.default_print_format:
        settings.default_print_format = PRINT_FORMAT
        settings.save(ignore_permissions=True)


def apply_user_defaults(user):
    """New documents open with the shop's company, warehouse, cost center and walk-in customer already filled in. Only missing values are written."""
    cfg = frappe.get_cached_doc("Counter Desk Settings")
    cost_center = frappe.get_cached_value("Company", cfg.company, "cost_center") if cfg.company else None
    have = {r.defkey for r in frappe.get_all("DefaultValue", filters={"parent": user}, fields=["defkey"])}
    for key, value in (("company", cfg.company), ("Warehouse", cfg.default_warehouse), ("Customer", cfg.default_customer), ("Cost Center", cost_center)):
        if value and key not in have:
            frappe.defaults.set_user_default(key, value, user)
