'use client';

import { useEffect, useRef, useState } from 'react';

type Key = { id: string; name: string; role: string; expiresAt: string; revokedAt?: string };

export function ProjectApiLinks({ projectId }: { projectId: number }) {
  const path = `/api/v1/projects/${projectId}`;
  const [origin, setOrigin] = useState('');
  const [keys, setKeys] = useState<Key[]>([]);
  const [name, setName] = useState('');
  const [role, setRole] = useState('editor');
  const [days, setDays] = useState(90);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [issuing, setIssuing] = useState(false);
  const [issueMessage, setIssueMessage] = useState('');
  const [issueError, setIssueError] = useState(false);
  const [issueUncertain, setIssueUncertain] = useState(false);
  const issueRequest = useRef<AbortController | null>(null);
  useEffect(() => {
    setOrigin(window.location.origin);
    return () => issueRequest.current?.abort();
  }, []);
  const endpoint = `${origin}${path}`;
  async function refresh() {
    const response = await fetch(`/api/projects/${projectId}/access`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? 'Could not load API access.');
    setKeys(data.keys);
  }
  async function copy(value: string) {
    try { await navigator.clipboard.writeText(value); setMessage('Copied.'); }
    catch { setMessage('Clipboard unavailable.'); }
  }
  function instructions(credential = '<PROJECT_TOKEN>') {
    return `Project API: ${endpoint}\nRead the agent guide first: ${endpoint}/guide\nOpenAPI: ${endpoint}/openapi.json\nAuthentication: Authorization: Bearer ${credential}\nUse only this project's /api/v1 endpoint. Do not use legacy dashboard routes. Never publish credentials. Read existing work before creating items; preserve Epic > User Story > Feature > Task > Bug ancestry. No commits, builds or deployments are authorized by API access.`;
  }
  async function issue() {
    if (busy || issueRequest.current || issueUncertain) return;
    const controller = new AbortController();
    issueRequest.current = controller;
    const deadline = setTimeout(() => controller.abort(), 15_000);
    let rejected = false;
    setBusy(true); setIssuing(true); setMessage(''); setToken('');
    setIssueError(false); setIssueMessage('Issuing credential...');
    try {
      const response = await fetch(`/api/projects/${projectId}/access`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, role, days }), signal: controller.signal });
      rejected = !response.ok && response.status < 500;
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Could not issue credential.');
      if (typeof data.token !== 'string' || !/^ssdo_[a-f0-9]{64}$/.test(data.token) || typeof data.key?.id !== 'string') throw new Error('Invalid credential response.');
      setToken(data.token); setName('');
      setKeys((current) => [...current.filter((key) => key.id !== data.key.id), data.key]);
      setIssueMessage('Credential created. Copy it now; it is shown only once.');
    } catch (error) {
      setIssueError(true);
      if (rejected) setIssueMessage(error instanceof Error ? error.message : 'Could not issue credential.');
      else {
        setIssueUncertain(true);
        setIssueMessage(controller.signal.aborted
          ? 'The request timed out. A credential may have been created. Reload API Access and check before trying again.'
          : 'Creation could not be confirmed. Reload API Access and check for an unclaimed credential before trying again.');
      }
    } finally {
      clearTimeout(deadline); issueRequest.current = null;
      setBusy(false); setIssuing(false);
    }
  }
  async function revoke(id: string) {
    if (busy) return;
    setBusy(true); setMessage('');
    try {
      const response = await fetch(`/api/projects/${projectId}/access`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
      if (!response.ok) throw new Error('Could not revoke credential.');
      setToken(''); await refresh();
    } catch (error) { setMessage(String(error)); }
    finally { setBusy(false); }
  }
  return <div className="projectApiAccess" onClick={(event) => event.stopPropagation()}>
    <label>Project API<input aria-label={`Project ${projectId} API endpoint`} readOnly value={endpoint} /></label>
    <div className="rowActions">
      <button type="button" className="ghostButton" onClick={() => void copy(endpoint)}>Copy API</button>
      <button type="button" className="ghostButton" onClick={() => void copy(instructions())}>Copy Agent Instructions</button>
      <a href={`${path}/guide`} target="_blank" rel="noreferrer">Agent Guide</a>
      <a href={`${path}/openapi.json`} target="_blank" rel="noreferrer">OpenAPI</a>
    </div>
    <details onToggle={(event) => { if (event.currentTarget.open) void refresh().catch((error) => setMessage(String(error))); else setToken(''); }}>
      <summary>API Access</summary>
      <fieldset disabled={busy}>
        <label>Credential name<input value={name} maxLength={100} onChange={(event) => setName(event.target.value)} /></label>
        <label>Role<select value={role} onChange={(event) => setRole(event.target.value)}><option value="reader">Reader</option><option value="editor">Editor</option><option value="owner">Owner</option></select></label>
        <label>Expires in days<input type="number" min={1} max={365} value={days} onChange={(event) => setDays(Number(event.target.value))} /></label>
        <button type="button" disabled={busy || issueUncertain || !name.trim() || !Number.isInteger(days) || days < 1 || days > 365} aria-busy={issuing} onClick={() => void issue()}>{issuing ? 'Issuing...' : 'Issue Credential'}</button>
        {issueMessage ? <p className="message" role={issueError ? 'alert' : 'status'} aria-live="polite">{issueMessage}</p> : null}
        {token ? <><label>New credential (shown once)<input type="password" readOnly autoComplete="off" value={token} /></label><button type="button" onClick={() => void copy(token)}>Copy Credential</button><button type="button" onClick={() => void copy(instructions(token))}>Copy Authenticated Agent Instructions</button><button type="button" className="ghostButton" onClick={() => setToken('')}>Dismiss Credential</button></> : null}
        <ul>{keys.map((key) => <li key={key.id}>{key.name} · {key.role} · {key.revokedAt ? 'Revoked' : Date.parse(key.expiresAt) <= Date.now() ? 'Expired' : `Expires ${new Date(key.expiresAt).toLocaleDateString()}`} {!key.revokedAt ? <button type="button" className="ghostButton" onClick={() => void revoke(key.id)}>Revoke</button> : null}</li>)}</ul>
      </fieldset>
    </details>
    {message ? <p role="status">{message}</p> : null}
  </div>;
}
