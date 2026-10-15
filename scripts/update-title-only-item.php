<?php
// CLI bridge implementation only; no direct web entry or global validation changes.
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
function update_title_only_item($projectId, $itemId, $payload) {
    global $g_db, $g_project_override;
    if (!is_int($itemId) || $itemId < 1 || !is_array($payload)) throw new RuntimeException('Invalid planning update.');
    foreach (array_keys($payload) as $key) {
        if (!in_array($key, array('summary', 'handler', 'category', 'status', 'custom_fields'), true)) throw new RuntimeException('Unsupported planning field.');
    }
    require_api('workflow_api.php');
    $g_project_override = $projectId;
    if (!$g_db->BeginTrans()) throw new RuntimeException('Could not start planning update.');
    try {
        db_param_push();
        db_query('SELECT id FROM {bug} WHERE id=' . db_param() . ' FOR UPDATE', array($itemId));
        bug_clear_cache($itemId);
        // Clone to preserve the cached old values used by native history logging.
        $item = clone bug_get($itemId, true);
        $types = array('Epic', 'User Story', 'Feature', 'Task', 'Improvement', 'Technical Debt');
        $typeField = custom_field_get_id_from_name('Work Item Type');
        if ((int)$item->project_id !== $projectId || trim($item->description) !== '' || !in_array(custom_field_get_value($typeField, $itemId), $types, true)) throw new RuntimeException('Not an existing title-only planning item.');
        access_ensure_bug_level(config_get('update_bug_threshold'), $itemId);
        if (bug_is_readonly($itemId)) throw new RuntimeException('Planning item is read only.');
        if (array_key_exists('summary', $payload)) {
            if (!is_string($payload['summary']) || trim($payload['summary']) === '') throw new RuntimeException('Summary is required.');
            $item->summary = $payload['summary'];
        }
        if (isset($payload['handler'])) {
            $handler = $payload['handler']['id'] ?? null;
            if (!is_int($handler) || $handler < 0) throw new RuntimeException('Invalid assignee.');
            if ($handler && (!user_exists($handler) || !user_is_enabled($handler) || !access_has_project_level(config_get('handle_bug_threshold'), $projectId, $handler))) throw new RuntimeException('Assignee is not eligible.');
            if ((int)$item->handler_id !== $handler) access_ensure_project_level(config_get('update_bug_assign_threshold'), $projectId);
            $item->handler_id = $handler;
        }
        if (isset($payload['category'])) {
            $name = $payload['category']['name'] ?? null;
            if (!is_string($name)) throw new RuntimeException('Invalid category.');
            $matches = array_values(array_filter(category_get_all_rows($projectId), function($row) use ($name) { return $row['name'] === $name; }));
            $category = null;
            foreach ($matches as $row) {
                if ((int)$row['id'] === (int)$item->category_id) { $category = $row; break; }
                if ((int)$row['project_id'] === $projectId) $category = $row;
            }
            if (!$category && count($matches) === 1) $category = $matches[0];
            if (!$category) throw new RuntimeException('Category is unavailable or ambiguous.');
            $item->category_id = (int)$category['id'];
        }
        if (isset($payload['status'])) {
            $statuses = MantisEnum::getAssocArrayIndexedByValues(config_get('status_enum_string'));
            $status = array_search($payload['status']['name'] ?? null, $statuses, true);
            if ($status === false) throw new RuntimeException('Invalid status.');
            if ((int)$item->status !== (int)$status) {
                if (!workflow_transition_edge_exists($item->status, $status)) throw new RuntimeException('Invalid status transition.');
                access_ensure_bug_level(access_get_status_threshold($status, $projectId), $itemId);
            }
            $item->status = $status;
        }
        $fields = array();
        foreach ($payload['custom_fields'] ?? array() as $entry) {
            $name = $entry['field']['name'] ?? '';
            $value = $entry['value'] ?? null;
            $allowed = array('Work Item Type', 'Parent Issue', 'Sprint', 'Story Points', 'Device Information', 'Application Version', 'Operating System Version', 'Relevant Logs', 'Verification Result', 'Release Readiness');
            if (!in_array($name, $allowed, true) || !is_string($value)) throw new RuntimeException('Invalid custom field.');
            if ($name === 'Work Item Type' && !in_array($value, $types, true)) throw new RuntimeException('Title-only records must retain a planning type.');
            $id = custom_field_get_id_from_name($name);
            if (!$id || !custom_field_is_linked($id, $projectId) || !custom_field_has_write_access($id, $itemId) || !custom_field_validate($id, $value)) throw new RuntimeException('Custom field rejected.');
            $fields[] = array($id, $value);
        }
        // Native non-extended update preserves blank text, revisions and unrelated fields.
        $item->update(false);
        foreach ($fields as $entry) if (!custom_field_set_value($entry[0], $itemId, $entry[1])) throw new RuntimeException('Custom field update failed.');
        if (!$g_db->CommitTrans()) throw new RuntimeException('Could not commit planning update.');
    } catch (Throwable $error) { $g_db->RollbackTrans(); throw $error; }
}
