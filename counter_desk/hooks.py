app_name = "counter_desk"
app_title = "Counter Desk"
app_publisher = "Zohra"
app_description = "Invoicing desk on top of ERPNext Sales Invoice, Payment Entry and Item"
app_email = "erp@zohraorphanage.org"
app_license = "mit"

required_apps = ["erpnext"]

# Invoicing users work in the normal ERPNext desk, restricted to one workspace, with a light skin
app_include_css = "/assets/counter_desk/css/desk_skin.css?v=5"
app_include_js = "/assets/counter_desk/js/desk_user.js?v=11"
on_session_creation = "counter_desk.setup.session.on_session_creation"

after_install = "counter_desk.setup.install.after_install"
after_migrate = "counter_desk.setup.install.after_migrate"

website_redirects = [{"source": "/counter", "target": "/invoicing"}]

override_doctype_class = {"Item": "counter_desk.overrides.item.CounterItem"}

# available inside print formats: {{ invoice_qr(doc) }}
jinja = {"methods": ["counter_desk.utils.zatca_qr.invoice_qr"]}
