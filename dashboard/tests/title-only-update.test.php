<?php
// Synthetic native-API harness: no Mantis bootstrap, credentials or database connection.
class FakeDatabase {
    private $snapshot;
    public function BeginTrans() { $this->snapshot = serialize(array($GLOBALS['record'], $GLOBALS['values'])); return true; }
    public function CommitTrans() { return true; }
    public function RollbackTrans() { list($GLOBALS['record'], $GLOBALS['values']) = unserialize($this->snapshot); }
}
class FakeBug {
    public $project_id = 1, $description = '', $summary = 'Planning epic', $handler_id = 0, $category_id = 8, $status = 10;
    public $steps_to_reproduce = 'Preserved steps', $additional_information = 'Preserved details';
    public function update($extended) {
        if ($extended !== false) throw new RuntimeException('Description validation must not be bypassed globally.');
        if ($GLOBALS['record']->handler_id !== 0) throw new RuntimeException('Old history values were mutated before update.');
        $GLOBALS['record'] = clone $this;
    }
}
function require_api($name) {}
function db_param_push() {}
function db_param() { return '?'; }
function db_query($query, $params) { if (strpos($query, 'FOR UPDATE') === false) throw new RuntimeException('Expected record lock.'); }
function bug_clear_cache($id) {}
function bug_get($id, $extended) { return $GLOBALS['record']; }
function custom_field_get_id_from_name($name) { return array('Work Item Type' => 1, 'Parent Issue' => 2)[$name] ?? 0; }
function custom_field_get_value($id, $item) { return $GLOBALS['values'][$id] ?? ''; }
function access_ensure_bug_level($level, $id) { if ($GLOBALS['deny']) throw new RuntimeException('Permission denied.'); }
function access_ensure_project_level($level, $id) { if ($GLOBALS['deny']) throw new RuntimeException('Permission denied.'); }
function config_get($name) { return $name === 'status_enum_string' ? '10:new,20:assigned' : 50; }
function bug_is_readonly($id) { return $GLOBALS['readonly']; }
function user_exists($id) { return $id === 7; }
function user_is_enabled($id) { return $id === 7; }
function access_has_project_level($level, $project, $user) { return $user === 7; }
function category_get_all_rows($project) { return array(array('id' => 8, 'name' => 'General', 'project_id' => 0)); }
function workflow_transition_edge_exists($from, $to) { return true; }
function access_get_status_threshold($status, $project) { return 50; }
function custom_field_is_linked($id, $project) { return true; }
function custom_field_has_write_access($id, $item) { return true; }
function custom_field_validate($id, $value) { return true; }
function custom_field_set_value($id, $item, $value) { if ($GLOBALS['failField']) throw new RuntimeException('Synthetic storage failure.'); $GLOBALS['values'][$id] = $value; return true; }
class MantisEnum { public static function getAssocArrayIndexedByValues($value) { return array(10 => 'new', 20 => 'assigned'); } }
require __DIR__ . '/../../scripts/update-title-only-item.php';
function reset_fixture() { $GLOBALS['record'] = new FakeBug(); $GLOBALS['values'] = array(1 => 'Epic', 2 => ''); $GLOBALS['deny'] = false; $GLOBALS['readonly'] = false; $GLOBALS['failField'] = false; $GLOBALS['g_db'] = new FakeDatabase(); }
function check($condition) { if (!$condition) throw new RuntimeException('Synthetic assertion failed.'); }
reset_fixture();
update_title_only_item(1, 92, array('handler' => array('id' => 7), 'category' => array('name' => 'General'), 'status' => array('name' => 'new')));
check($record->handler_id === 7 && $record->description === '' && $record->steps_to_reproduce === 'Preserved steps' && $record->additional_information === 'Preserved details' && $record->category_id === 8);
foreach (array('nonblank', 'wrongProject', 'bug', 'ineligible', 'readonly', 'permission', 'description', 'fieldFailure') as $case) {
    reset_fixture(); $payload = array('handler' => array('id' => 7));
    if ($case === 'nonblank') $record->description = 'Existing text';
    if ($case === 'wrongProject') $record->project_id = 2;
    if ($case === 'bug') $values[1] = 'Bug';
    if ($case === 'ineligible') $payload['handler']['id'] = 999;
    if ($case === 'readonly') $readonly = true;
    if ($case === 'permission') $deny = true;
    if ($case === 'description') $payload['description'] = '';
    if ($case === 'fieldFailure') { $failField = true; $payload['custom_fields'] = array(array('field' => array('name' => 'Work Item Type'), 'value' => 'Epic')); }
    $rejected = false;
    try { update_title_only_item(1, 92, $payload); } catch (Throwable $error) { $rejected = true; }
    check($rejected && $record->handler_id === 0);
}
echo "9 synthetic native planning-update cases passed.\n";
