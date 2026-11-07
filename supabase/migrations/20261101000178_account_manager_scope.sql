-- ADDON-41 rule 3: account managers see ONLY their own customers. Area permissions such as requests/orders/support
-- give global visibility through the existing policies, so managers do not get them; they read their customers'
-- records through the am_read policies (migration 177) and work from the Admin work queue.
delete from role_permissions where role_code = 'account_manager' and area in ('requests', 'orders', 'support');
-- dashboard:view opens platform-wide reports and back-office queues; managers use the Admin work queue instead
delete from role_permissions where role_code = 'account_manager' and area = 'dashboard';
