function buildPlan(snapshot) {
  const originals = new Map(snapshot.issues.map((item) => [item.id, item]));
  const nodes = [];
  function existing(id, type, parent, reason) {
    const source = originals.get(id);
    if (!source) throw new Error(`Missing original #${id}`);
    const node = { key: `original:${id}`, id, projectId: source.project.id, type, parent, title: source.summary, reason };
    nodes.push(node);
    return node.key;
  }
  function create(key, referenceId, type, parent, title) {
    const source = originals.get(referenceId);
    if (!source) throw new Error(`Missing project reference #${referenceId}`);
    nodes.push({ key, projectId: source.project.id, type, parent, title, description: '', reason: 'Title-only planning item inferred from the linked original scope; no completion or verification claim.' });
    return key;
  }

  const infrastructure = existing(16, 'Epic', null, 'Existing whole-tool roadmap explicitly describes the overall initiative.');
  const infraStories = {
    delivery: create('infra:delivery', 16, 'User Story', infrastructure, 'Manage projects and track development delivery'),
    operations: create('infra:operations', 16, 'User Story', infrastructure, 'Operate and recover the local development platform'),
    traceability: create('infra:traceability', 16, 'User Story', infrastructure, 'Trace source changes, verification evidence and agent work'),
  };
  const phases = [
    [17, 'operations', 'Validate the self-contained Mantis, PHP, PostgreSQL and dashboard foundation'],
    [18, 'delivery', 'Configure and verify work-item types, fields and lifecycle transitions'],
    [19, 'delivery', 'Verify project, work-item and repository management in the dashboard'],
    [20, 'traceability', 'Maintain independent repository mappings for each project'],
    [21, 'traceability', 'Link repository commits to Mantis work items'],
    [22, 'delivery', 'Assign, edit and filter project sprint work'],
    [23, 'delivery', 'Track project milestones and release-readiness states'],
    [24, 'delivery', 'Report live status, type, sprint and readiness counts'],
    [25, 'traceability', 'Attach verification evidence and logs to work items'],
    [26, 'operations', 'Back up and document recovery of the development-management stack'],
    [27, 'traceability', 'Document agent work-item, source-reference and evidence workflows'],
    [28, 'operations', 'Verify local access, credential handling and service exposure'],
    [47, 'delivery', 'Implement and verify the Sirius Scientific DevOps dashboard experience'],
  ];
  for (const [id, story, taskTitle] of phases) {
    const feature = existing(id, 'Feature', infraStories[story], 'Phase describes a cohesive product capability and its acceptance checks.');
    create(`infra:task:${id}`, id, 'Task', feature, taskTitle);
  }

  const wallet = existing(50, 'Epic', null, 'Architecture and full ten-phase wallet roadmap.');
  const walletStories = {
    issuance: create('wallet:issuance', 50, 'User Story', wallet, 'Issue and authenticate secure empty physical-card wallets'),
    loading: create('wallet:loading', 50, 'User Story', wallet, 'Transfer account-funded tokens to cards with recoverable outcomes'),
    fares: create('wallet:fares', 50, 'User Story', wallet, 'Collect offline card fares and reconcile authoritative records'),
    qualification: create('wallet:qualification', 50, 'User Story', wallet, 'Qualify integrated card-wallet recovery and pilot readiness'),
  };
  const walletPhases = [
    [51, 'issuance', 'Frozen card profile, transaction contracts and acceptance matrix'],
    [52, 'issuance', 'Protected issuer authority and financial reservations'],
    [53, 'issuance', 'Recoverable blank-card provisioning and activation'],
    [54, 'issuance', 'Passenger NFC relay and protected POS card access'],
    [55, 'loading', 'Online account-to-card token loading'],
    [56, 'loading', 'Interrupted-loading reconciliation and recovery'],
    [57, 'fares', 'Offline physical-card boarding and alighting'],
    [58, 'fares', 'Offline-fare reconciliation and Operations ledger'],
    [59, 'qualification', 'Combined loading and offline-fare fault qualification'],
    [60, 'qualification', 'Controlled multi-card pilot and production-readiness review'],
  ];
  for (const [id, story, title] of walletPhases) {
    const feature = create(`wallet:feature:${id}`, id, 'Feature', walletStories[story], title);
    existing(id, 'Task', feature, 'Original phase description explicitly identifies this as a Task with substeps and pass gates.');
  }

  const transit = create('transit:epic', 1, 'Epic', null, 'Reliable ArkNet passenger and service-trip operations');
  const transitStories = {
    connections: create('transit:connections', 1, 'User Story', transit, 'Keep passenger, POS and tablet sessions reliably connected'),
    settings: create('transit:settings', 9, 'User Story', transit, 'Expose accurate tablet settings and service-health indicators'),
    ledger: create('transit:ledger', 11, 'User Story', transit, 'Publish and inspect accurate service-trip and fare events'),
    boarding: create('transit:boarding', 1, 'User Story', transit, 'Recover authoritative passenger journeys during boarding and alighting'),
  };
  const sessionFeature = create('transit:schema', 4, 'Feature', transitStories.connections, 'Compatible POS-to-tablet realtime projections');
  const sessionTask = create('transit:schema:task', 4, 'Task', sessionFeature, 'Align strict tablet ledger validation with the POS Driver projection');
  existing(4, 'Bug', sessionTask, 'Confirmed projection-contract defect prevents live tablet state and Start Trip.');
  existing(5, 'Bug', sessionTask, 'Same documented strict-schema rejection causes the recurring Operations reconnect loop; retain both reports.');
  const connectionFeature = create('transit:lifecycle', 2, 'Feature', transitStories.connections, 'Resilient passenger and tablet connection lifecycles');
  const passengerTask = create('transit:passenger:task', 2, 'Task', connectionFeature, 'Recover passenger wallet streams after disconnects and invalid events');
  existing(2, 'Bug', passengerTask, 'Confirmed WebSocket terminal path does not schedule reconnect.');
  const rotationTask = create('transit:rotation:task', 8, 'Task', connectionFeature, 'Preserve tablet connection state during screen rotation');
  existing(8, 'Bug', rotationTask, 'Reported transient network-disconnected state during rotation.');
  const hotspotFeature = create('transit:hotspot', 49, 'Feature', transitStories.connections, 'POS hotspot recovery and claimed-tablet connection diagnostics');
  const hotspotTask = create('transit:hotspot:task', 49, 'Task', hotspotFeature, 'Restore dropped POS hotspots and show actionable tablet link diagnostics');
  existing(49, 'Bug', hotspotTask, 'Observed hotspot-down state and misleading claimed-tablet Unassigned state.');

  const settingsFeature = existing(9, 'Feature', transitStories.settings, 'Mixed scope: new battery-charge capability and an existing disabled-sound defect.');
  create('transit:charge:task', 9, 'Task', settingsFeature, 'Display the current tablet charge level in Settings');
  const soundTask = create('transit:sound:task', 9, 'Task', settingsFeature, 'Respect the disabled click-sound setting for tablet presses');
  create('transit:sound:bug', 9, 'Bug', soundTask, 'Some tablet presses still click when click sounds are disabled');
  const ampsFeature = create('transit:amps', 10, 'Feature', transitStories.settings, 'Tablet top-bar AMPS health and connection status');
  const ampsTask = create('transit:amps:task', 10, 'Task', ampsFeature, 'Restore current AMPS status in the tablet top status bar');
  existing(10, 'Bug', ampsTask, 'Reported regression: AMPS status is no longer visible.');

  const protocolFeature = create('transit:protocol', 11, 'Feature', transitStories.ledger, 'Compact durable service-trip event protocol');
  existing(11, 'Task', protocolFeature, 'Requested protocol and violation-policy design work, not an observed software defect.');
  const publicationFeature = create('transit:publication', 12, 'Feature', transitStories.ledger, 'Ticket-linked group-aware service-trip event publication');
  existing(12, 'Task', publicationFeature, 'Requested implementation work for richer durable event records.');
  const ledgerFeature = create('transit:ledger:feature', 13, 'Feature', transitStories.ledger, 'Readable realtime Vehicle Ledger timelines and Operations-grid parity');
  existing(13, 'Task', ledgerFeature, 'Requested timeline, journey-detail and event-rendering implementation.');
  const latencyTask = create('transit:latency:task', 3, 'Task', ledgerFeature, 'Publish committed tap-out changes promptly to the tablet Ledger');
  existing(3, 'Bug', latencyTask, 'Measured 12.182-second tap-out lifecycle delay.');
  const gridTask = create('transit:grid:task', 6, 'Task', ledgerFeature, 'Correct Vehicle Ledger presentation, business fields and fare/location mapping');
  existing(6, 'Bug', gridTask, 'Documented styling, row-state, fare and location defects; retain administrative closure status.');
  existing(7, 'Bug', gridTask, 'Documented Operations-grid parity and business-field defects; preserve overlapping original report and closure history.');

  const boardingFeature = create('transit:boarding:feature', 1, 'Feature', transitStories.boarding, 'Authoritative active-journey recovery on passenger taps');
  const boardingTask = create('transit:boarding:task', 1, 'Task', boardingFeature, 'Recover same-hub active journeys without rejecting a valid passenger tap');
  existing(1, 'Bug', boardingTask, 'Observed boarding failure and documented authority-recovery fix.');

  const routeEpic = create('route:epic', 61, 'Epic', null, 'Standalone offline Android route and speech service');
  const routeStory = create('route:story', 61, 'User Story', routeEpic, 'Provide bounded offline route guidance to Android clients');
  const routeFeature = create('route:feature', 61, 'Feature', routeStory, 'Android route-service setup, Messenger integration and 1 Hz qualification');
  existing(61, 'Task', routeFeature, 'Setup/integration guide and explicit build, device, audio and resource-qualification work.');

  const assigned = nodes.filter((node) => node.id).map((node) => node.id);
  if (assigned.length !== originals.size || new Set(assigned).size !== originals.size) throw new Error('Every original item must be classified exactly once.');
  const index = new Map(nodes.map((node) => [node.key, node]));
  const required = { Epic: null, 'User Story': 'Epic', Feature: 'User Story', Task: 'Feature', Bug: 'Task' };
  for (const node of nodes) {
    const parent = index.get(node.parent);
    if (required[node.type] === null ? node.parent !== null : !parent || parent.type !== required[node.type] || parent.projectId !== node.projectId) {
      throw new Error(`Invalid planned parent: ${node.key}`);
    }
  }
  return { schemaVersion: 1, createdAt: new Date().toISOString(), nodes };
}
module.exports = { buildPlan };
