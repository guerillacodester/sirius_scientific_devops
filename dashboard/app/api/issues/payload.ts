type IssueInput = {
  summary?: string;
  description?: string;
  project?: string;
  category?: string;
  status?: string;
  type?: string;
  sprint?: string;
  storyPoints?: string | number;
  parentId?: string | number;
  assigneeId?: string | number | null;
  deviceInfo?: string;
  appVersion?: string;
  osVersion?: string;
  logs?: string;
  verification?: string;
  releaseReadiness?: string;
};

function customField(name: string, value: unknown, partial = false) {
  if (value === undefined || value === null || (value === '' && !partial)) {
    return null;
  }

  return {
    field: { name },
    value: String(value),
  };
}

export function issuePayload(input: IssueInput, partial = false, clearOptionalFields = false) {
  const payload: Record<string, unknown> = {};
  const clear = partial && clearOptionalFields;

  if (input.summary !== undefined) {
    payload.summary = input.summary;
  }
  if (input.description !== undefined && (!partial || input.description !== '')) {
    payload.description = input.description;
  }
  if (input.project !== undefined) {
    payload.project = { name: input.project };
  }
  if (input.category !== undefined) {
    payload.category = { name: input.category };
  }
  if (input.status !== undefined && input.status !== '') {
    payload.status = { name: input.status };
  }
  if (input.assigneeId !== undefined) {
    payload.handler = { id: input.assigneeId === '' || input.assigneeId === null ? 0 : Number(input.assigneeId) };
  }

  const fields = [
    customField('Work Item Type', input.type),
    customField('Sprint', input.sprint, clear),
    customField('Story Points', input.storyPoints, clear),
    input.parentId === '' && partial ? { field: { name: 'Parent Issue' }, value: '' } : customField('Parent Issue', input.parentId),
    customField('Device Information', input.deviceInfo, clear),
    customField('Application Version', input.appVersion, clear),
    customField('Operating System Version', input.osVersion, clear),
    customField('Relevant Logs', input.logs, clear),
    customField('Verification Result', input.verification, clear),
    customField('Release Readiness', input.releaseReadiness, clear),
  ].filter(Boolean);

  if (fields.length > 0) {
    payload.custom_fields = fields;
  }

  if (!partial && (!payload.summary || !payload.description || !payload.project || !payload.category)) {
    throw new Error('summary, description, project, and category are required.');
  }

  return payload;
}
