import os

import frappe

no_cache = 1


def get_context(context):
    if frappe.session.user == "Guest":
        frappe.local.flags.redirect_location = "/login?redirect-to=/invoicing"
        raise frappe.Redirect
    context.no_cache = 1
    context.show_sidebar = False
    context.csrf_token = frappe.sessions.get_csrf_token()
    pub = frappe.get_app_path("counter_desk", "public")
    context.asset_v = max(int(os.path.getmtime(os.path.join(r, f))) for r, _, fs in os.walk(pub) for f in fs)  # cache-bust on any asset change
    context.title = "Invoicing"
    return context
