<?php
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
ob_start();
try {
    $input = json_decode(stream_get_contents(STDIN), true, 32, JSON_THROW_ON_ERROR);
    $projectId = $input['projectId'] ?? null;
    if (!is_int($projectId) || $projectId < 1) throw new RuntimeException('Invalid project.');
    $root = dirname(__DIR__);
    $config = json_decode(file_get_contents($root . '/tools/mantis.config.json'), true, 32, JSON_THROW_ON_ERROR);
    require_once $root . '/mantisbt/core.php';
    require_api('api_token_api.php');
    require_api('authentication_api.php');
    require_api('access_api.php');
    require_api('custom_field_api.php');
    require_api('bugnote_api.php');
    $actor = api_token_get_user($config['apiToken']);
    if (!$actor || !auth_attempt_script_login(user_get_field($actor, 'username'))) throw new RuntimeException('Authentication failed.');
    access_ensure_global_level(ADMINISTRATOR);
    project_ensure_exists($projectId);
    if ($input['operation'] === 'configure') {
        $names = array('Work Item Type', 'Parent Issue', 'Sprint', 'Story Points', 'Device Information', 'Application Version', 'Operating System Version', 'Relevant Logs', 'Verification Result', 'Release Readiness');
        $fields = array();
        foreach (custom_field_get_ids() as $id) {
            $definition = custom_field_get_definition($id);
            $fields[$definition['name']] = $id;
        }
        foreach (array('Work Item Type', 'Parent Issue') as $name) {
            if (!isset($fields[$name])) throw new RuntimeException('Required field is missing.');
        }
        foreach ($names as $name) {
            if (isset($fields[$name]) && !custom_field_is_linked($fields[$name], $projectId)) custom_field_link($fields[$name], $projectId);
        }
    } elseif ($input['operation'] === 'planning-update') {
        require_once __DIR__ . '/update-title-only-item.php';
        update_title_only_item($projectId, $input['itemId'] ?? null, $input['payload'] ?? null);
    } elseif ($input['operation'] === 'note-update') {
        $itemId = $input['itemId'] ?? null;
        $noteId = $input['noteId'] ?? null;
        $text = $input['text'] ?? null;
        if (!is_int($itemId) || !is_int($noteId) || !is_string($text) || trim($text) === '') throw new RuntimeException('Invalid note.');
        if ((int)bug_get_field($itemId, 'project_id') !== $projectId || (int)bugnote_get_field($noteId, 'bug_id') !== $itemId) throw new RuntimeException('Note is outside the project.');
        access_ensure_bugnote_level(config_get('update_bugnote_threshold', null, null, $projectId), $noteId);
        if (bug_is_readonly($itemId)) throw new RuntimeException('Item is read only.');
        bugnote_set_text($noteId, $text);
    } else { throw new RuntimeException('Unknown operation.'); }
    ob_end_clean();
    echo json_encode(array('ok' => true));
} catch (Throwable $error) {
    while (ob_get_level()) ob_end_clean();
    fwrite(STDERR, "Mantis project operation failed.\n");
    exit(1);
}
