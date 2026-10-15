export function draftCommitMessage(id: number, summary: string, update: string) {
  const title = summary.replace(/[\r\n]+/g, ' ').trim();
  return `${title} (Mantis #${id})\n\n${update.trim()}`;
}

export function prepareTaskUpdate(
  task: { id: number; summary: string; project?: { name: string } },
  repositories: Array<{ project: string; repoName: string; url: string; localPath?: string }>,
  input: { repoName?: unknown; updateText?: unknown; commitMessage?: unknown },
) {
  if (typeof input.repoName !== 'string' || !input.repoName.trim()) {
    throw new Error('Select a repository.');
  }
  if (typeof input.updateText !== 'string' || !input.updateText.trim()) {
    throw new Error('Progress update is required.');
  }
  const repository = repositories.find(
    (repo) => repo.project === task.project?.name && repo.repoName === input.repoName,
  );
  if (!repository) throw new Error('Repository is not registered for this task project.');
  if (input.commitMessage !== undefined &&
      (typeof input.commitMessage !== 'string' || !input.commitMessage.trim())) {
    throw new Error('Commit message must not be empty.');
  }
  const commitMessage = typeof input.commitMessage === 'string'
    ? input.commitMessage.trim()
    : draftCommitMessage(task.id, task.summary, input.updateText);
  const text = [
    `Task update (Mantis #${task.id})`,
    input.updateText.trim(),
    '',
    `Repository: ${repository.repoName}`,
    `Repository URL: ${repository.url}`,
    ...(repository.localPath ? [`Local path: ${repository.localPath}`] : []),
    '',
    'Commit message draft (manual commit):',
    commitMessage,
  ].join('\n');
  return { repository, commitMessage, text };
}
