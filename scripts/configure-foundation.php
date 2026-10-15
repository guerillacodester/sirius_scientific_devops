<?php
require_once 'E:\\arknet-dev-management\\mantisbt\\core.php';
require_api('project_api.php');
require_api('category_api.php');
require_api('custom_field_api.php');

function adm_project_id_by_name_or_create($name, $description) {
    $id = project_get_id_by_name($name);
    if((int)$id > 0) {
        return (int)$id;
    }
    project_create($name, $description, 10, VS_PUBLIC, '', true, true);
    return (int)project_get_id_by_name($name);
}

function adm_category_exists_for_project($project_id, $name) {
    $rows = category_get_all_rows($project_id);
    foreach($rows as $row) {
        if($row['name'] === $name) {
            return true;
        }
    }
    return false;
}

function adm_ensure_category($project_id, $name) {
    if(!adm_category_exists_for_project($project_id, $name)) {
        category_add($project_id, $name);
    }
}

function adm_custom_field_id_by_name($name) {
    $ids = custom_field_get_ids();
    foreach($ids as $id) {
        $field = custom_field_get_definition($id);
        if($field['name'] === $name) {
            return (int)$id;
        }
    }
    return 0;
}

function adm_ensure_field($name, $type, $possible_values = '', $default_value = '', $display_report = true, $require_report = false) {
    $id = adm_custom_field_id_by_name($name);
    if($id === 0) {
        $id = custom_field_create($name);
    }

    $def = custom_field_get_definition($id);
    $def['name'] = $name;
    $def['type'] = $type;
    $def['possible_values'] = $possible_values;
    $def['default_value'] = $default_value;
    $def['access_level_r'] = VIEWER;
    $def['access_level_rw'] = REPORTER;
    $def['length_min'] = 0;
    $def['length_max'] = 0;
    $def['filter_by'] = true;
    $def['display_report'] = $display_report;
    $def['display_update'] = true;
    $def['display_resolved'] = true;
    $def['display_closed'] = true;
    $def['require_report'] = $require_report;
    $def['require_update'] = false;
    $def['require_resolved'] = false;
    $def['require_closed'] = false;
    custom_field_update($id, $def);
    return $id;
}

$projects = array(
    'ATC Console' => 'Embedded hardware and application software.',
    'ArkNet POS' => 'Android POS application.',
    'ATCS' => 'Cloud backend and APIs.',
    'ArkNet Mobile' => 'Frontend and dashboard.',
    'ArkNet Infrastructure' => 'Deployment, networking and operations.'
);

$project_ids = array();
foreach($projects as $name => $description) {
    $project_ids[$name] = adm_project_id_by_name_or_create($name, $description);
}

$categories = array(
    'General',
    'Bug',
    'Task',
    'Feature',
    'Infrastructure',
    'Release',
    'Documentation',
    'POS',
    'Passenger App',
    'Tablet Display',
    'Payments',
    'Telemetry',
    'NFC',
    'Network',
    'Security'
);

foreach($project_ids as $project_id) {
    foreach($categories as $category) {
        adm_ensure_category($project_id, $category);
    }
}

$fields = array(
    adm_ensure_field('Work Item Type', CUSTOM_FIELD_TYPE_LIST, 'Epic|Feature|User Story|Task|Bug|Improvement|Technical Debt', 'Bug', true, true),
    adm_ensure_field('Sprint', CUSTOM_FIELD_TYPE_STRING, '', '', true, false),
    adm_ensure_field('Story Points', CUSTOM_FIELD_TYPE_NUMERIC, '', '', true, false),
    adm_ensure_field('Parent Issue', CUSTOM_FIELD_TYPE_NUMERIC, '', '', true, false),
    adm_ensure_field('Device Information', CUSTOM_FIELD_TYPE_TEXTAREA, '', '', true, false),
    adm_ensure_field('Application Version', CUSTOM_FIELD_TYPE_STRING, '', '', true, false),
    adm_ensure_field('Operating System Version', CUSTOM_FIELD_TYPE_STRING, '', '', true, false),
    adm_ensure_field('Relevant Logs', CUSTOM_FIELD_TYPE_TEXTAREA, '', '', true, false),
    adm_ensure_field('Verification Result', CUSTOM_FIELD_TYPE_LIST, 'Unverified|Passed|Failed|Blocked|Not Required', 'Unverified', true, false),
    adm_ensure_field('Release Readiness', CUSTOM_FIELD_TYPE_LIST, 'Not Assessed|Ready|At Risk|Blocked', 'Not Assessed', true, false)
);

foreach($project_ids as $project_id) {
    foreach($fields as $field_id) {
        custom_field_link($field_id, $project_id);
    }
}

echo json_encode(array('projects' => $project_ids, 'fields' => $fields), JSON_PRETTY_PRINT) . PHP_EOL;
