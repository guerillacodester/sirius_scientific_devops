<?php
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
$root = dirname(__DIR__);
$snapshot = json_decode(file_get_contents($root . '/backups/workitem-reorganization-before.json'), true, 512, JSON_THROW_ON_ERROR);
$plan = json_decode(file_get_contents($root . '/backups/workitem-reorganization-plan.json'), true, 512, JSON_THROW_ON_ERROR);
$resultPath = $root . '/backups/workitem-reorganization-result.json';
if (file_exists($resultPath) || file_exists($resultPath . '.pending')) { throw new RuntimeException('Reorganization result already exists. Refusing duplicate apply.'); }
require_once $root . '/mantisbt/core.php';
require_api('bug_api.php');
require_api('custom_field_api.php');
require_api('authentication_api.php');
require_api('access_api.php');

// Only newly inferred planning records may omit descriptions; installed Mantis code is unchanged.
class TitleOnlyPlanningItem extends BugData {
    public function validate($p_update_extended = true) {
        parent::validate(false);
        if ($this->description !== '' || $this->steps_to_reproduce !== '' || $this->additional_information !== '') {
            throw new RuntimeException('Planning scaffold must contain only a title.');
        }
    }
}
if (!auth_attempt_script_login($snapshot['actor']['name'])) throw new RuntimeException('Script authentication failed.');
access_ensure_global_level(ADMINISTRATOR);
config_set_global('enable_email_notification', OFF);
$fields = array();
foreach (custom_field_get_ids() as $fieldId) {
    $definition = custom_field_get_definition($fieldId);
    $fields[$definition['name']] = $fieldId;
}
foreach (array('Work Item Type', 'Parent Issue') as $name) {
    if (!isset($fields[$name])) throw new RuntimeException('Required custom field is missing: ' . $name);
}
$projects = array_column($snapshot['projects'], null, 'id');
$originals = array_column($snapshot['issues'], null, 'id');
$nodes = array_column($plan['nodes'], null, 'key');
$required = array('Epic' => null, 'User Story' => 'Epic', 'Feature' => 'User Story', 'Task' => 'Feature', 'Bug' => 'Task');
$seen = array();
foreach ($nodes as $node) {
    if (!array_key_exists($node['type'], $required)) throw new RuntimeException('Invalid planned work type.');
    if (isset($node['id'])) {
        if (!isset($originals[$node['id']]) || isset($seen[$node['id']])) throw new RuntimeException('Invalid original coverage.');
        $seen[$node['id']] = true;
        if ($originals[$node['id']]['summary'] !== $node['title'] || $originals[$node['id']]['project']['id'] !== $node['projectId']) throw new RuntimeException('Original title or project must be preserved.');
    } elseif ($node['description'] !== '') throw new RuntimeException('Planning descriptions must be blank.');
    $parent = $node['parent'] === null ? null : ($nodes[$node['parent']] ?? null);
    if ($required[$node['type']] === null) {
        if ($parent !== null) throw new RuntimeException('Epic must be a project root.');
    } elseif (!$parent || $parent['type'] !== $required[$node['type']] || $parent['projectId'] !== $node['projectId']) throw new RuntimeException('Invalid planned ancestry.');
}
if (count($seen) !== count($originals)) throw new RuntimeException('Every original must be classified exactly once.');
if (($argv[1] ?? '') !== '--apply') { echo json_encode(array('validated' => true, 'originals' => count($originals), 'total' => count($nodes))) . PHP_EOL; exit; }

$active = false;
register_shutdown_function(function() use (&$active) { global $g_db; if ($active) $g_db->RollbackTrans(); });
try {
    if (!$g_db->BeginTrans()) throw new RuntimeException('Could not begin database transaction.');
    $active = true;
    foreach ($originals as $id => $original) {
        db_param_push();
        db_query('SELECT id FROM {bug} WHERE id=' . db_param() . ' FOR UPDATE', array($id));
        $current = bug_get($id, true);
        if ($current->summary !== $original['summary'] || $current->description !== $original['description'] ||
            (int)$current->status !== (int)$original['status']['id'] || (int)$current->resolution !== (int)$original['resolution']['id'] ||
            (int)$current->project_id !== (int)$original['project']['id'] || (int)$current->last_updated !== strtotime($original['updated_at'])) {
            throw new RuntimeException('Original changed since snapshot: #' . $id);
        }
    }
    $links = array();
    foreach (array_unique(array_column($plan['nodes'], 'projectId')) as $projectId) {
        foreach (array('Work Item Type', 'Parent Issue') as $name) {
            if (!custom_field_is_linked($fields[$name], $projectId)) {
                custom_field_link($fields[$name], $projectId);
                $links[] = array('projectId' => $projectId, 'field' => $name);
            }
        }
    }
    $ids = array();
    $created = array();
    foreach ($plan['nodes'] as $node) {
        if (isset($node['id'])) $id = $node['id'];
        else {
            $item = new TitleOnlyPlanningItem();
            $item->project_id = $node['projectId'];
            $item->reporter_id = $snapshot['actor']['id'];
            $item->summary = $node['title'];
            $item->description = '';
            $item->steps_to_reproduce = '';
            $item->additional_information = '';
            $category = null;
            foreach ($projects[$node['projectId']]['categories'] as $entry) { if ($entry['name'] === 'General') { $category = $entry['id']; break; } }
            if (!$category) throw new RuntimeException('Project lacks a General category.');
            $item->category_id = $category;
            $item->status = NEW_;
            $id = $item->create();
            $created[] = $id;
        }
        $ids[$node['key']] = $id;
        if (!custom_field_set_value($fields['Work Item Type'], $id, $node['type'])) throw new RuntimeException('Type write failed.');
        $parentId = $node['parent'] === null ? '' : (string)($ids[$node['parent']] ?? '');
        if ($node['parent'] !== null && $parentId === '') throw new RuntimeException('Plan is not parent-first.');
        if (!custom_field_set_value($fields['Parent Issue'], $id, $parentId)) throw new RuntimeException('Parent write failed.');
        bug_update_date($id);
    }
    $result = array('appliedAt' => gmdate('c'), 'originals' => count($originals), 'created' => $created, 'ids' => $ids, 'linkedFields' => $links, 'total' => count($ids));
    if (file_put_contents($resultPath . '.pending', json_encode($result, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES)) === false) throw new RuntimeException('Cannot write migration journal.');
    if (!$g_db->CommitTrans()) throw new RuntimeException('Database commit failed.');
    $active = false;
    if (!rename($resultPath . '.pending', $resultPath)) throw new RuntimeException('Committed; journal remains at pending path. Do not reapply.');
    echo json_encode(array('applied' => true, 'originals' => count($originals), 'created' => count($created), 'total' => count($ids), 'linkedFields' => $links)) . PHP_EOL;
} catch (Throwable $error) {
    if ($active) { $g_db->RollbackTrans(); $active = false; }
    fwrite(STDERR, $error->getMessage() . PHP_EOL);
    exit(1);
}
