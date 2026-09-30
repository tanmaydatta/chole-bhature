import { parseStackKey } from './key.mjs';

const prActions = new Set(['opened', 'reopened', 'synchronize']);
const phases = new Set(['predeploy', 'pretest']);
const shaPattern = /^[a-f0-9]{40}$/u;
const namePartPattern = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/u;

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function requireString(value, message) {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(message);
  return value;
}

function requireSha(value, message) {
  if (typeof value !== 'string' || !shaPattern.test(value)) throw new TypeError(message);
  return value;
}

function requirePositiveInteger(value, message) {
  if (!positiveInteger(value)) throw new TypeError(message);
  return value;
}

function requireRepositoryLocator(repository) {
  const owner = requireString(repository?.owner?.login, 'Expected GitHub event repository owner.');
  const name = requireString(repository?.name, 'Expected GitHub event repository name.');
  if (!namePartPattern.test(owner) || !namePartPattern.test(name)) {
    throw new TypeError('Expected GitHub event repository name.');
  }
  return { owner, name };
}

function requireRepositoryRecord(repository) {
  const id = requirePositiveInteger(repository?.id, 'Expected GitHub repository record.');
  const fullName = requireString(repository?.full_name, 'Expected GitHub repository record.');
  const owner = requireString(repository?.owner?.login, 'Expected GitHub repository record.');
  const name = requireString(repository?.name, 'Expected GitHub repository record.');
  if (`${owner}/${name}` !== fullName) throw new TypeError('Expected canonical GitHub repository record.');
  return { id, fullName, owner, name };
}

function requirePullRecord(pull, repository, number) {
  if (pull?.number !== number || pull?.state !== 'open') return null;
  const headSha = requireSha(pull?.head?.sha, 'Expected GitHub pull request head SHA.');
  const headRepositoryId = requirePositiveInteger(pull?.head?.repo?.id, 'Expected GitHub pull request head repository.');
  const headRepository = requireString(pull?.head?.repo?.full_name, 'Expected GitHub pull request head repository.');
  if (headRepositoryId !== repository.id || headRepository !== repository.fullName) return null;
  return { headSha };
}

function requireRunRecord(run, runId, attempt, headSha) {
  if (run?.id !== runId || run?.run_attempt !== attempt) {
    throw new TypeError('Expected matching GitHub run metadata.');
  }
  if (requireSha(run?.head_sha, 'Expected GitHub run head SHA.') !== headSha) {
    throw new TypeError('Expected matching GitHub run metadata.');
  }
  requireString(run?.status, 'Expected GitHub run status.');
}

export class StaleRunStop extends Error {
  constructor({ phase, eventHeadSha, liveHeadSha }) {
    super(`Stopping ${phase}: the PR head changed after this run was queued.`);
    this.name = 'StaleRunStop';
    this.code = 'STALE_PR_HEAD';
    this.phase = phase;
    this.eventHeadSha = eventHeadSha;
    this.liveHeadSha = liveHeadSha;
  }
}

export async function verifyCurrentPr({ event, githubClient, phase }) {
  if (!phases.has(phase)) throw new TypeError('Expected phase to be predeploy or pretest.');
  if (event?.action === 'closed') return null;
  if (!prActions.has(event?.action)) throw new TypeError('Unsupported pull request action.');
  if (!githubClient || typeof githubClient.request !== 'function') {
    throw new TypeError('Expected a GitHub client with request().');
  }

  const locator = requireRepositoryLocator(event.repository);
  const pr = requirePositiveInteger(event?.pull_request?.number, 'Expected GitHub pull request number.');
  const eventHeadSha = requireSha(event?.pull_request?.head?.sha, 'Expected GitHub event head SHA.');
  const runId = requirePositiveInteger(event?.run_id, 'Expected GitHub run ID.');
  const attempt = requirePositiveInteger(event?.attempt, 'Expected GitHub run attempt.');
  const repository = requireRepositoryRecord(await githubClient.request({
    method: 'GET', path: `/repos/${locator.owner}/${locator.name}`,
  }));
  const pull = requirePullRecord(await githubClient.request({
    method: 'GET', path: `/repos/${repository.owner}/${repository.name}/pulls/${pr}`,
  }), repository, pr);
  if (!pull) return null;
  if (pull.headSha !== eventHeadSha) {
    throw new StaleRunStop({ phase, eventHeadSha, liveHeadSha: pull.headSha });
  }
  const run = await githubClient.request({
    method: 'GET', path: `/repos/${repository.owner}/${repository.name}/actions/runs/${runId}`,
  });
  requireRunRecord(run, runId, attempt, eventHeadSha);
  return parseStackKey({
    repository_id: repository.id,
    repository: repository.fullName,
    pr,
    head_sha: eventHeadSha,
    run_id: runId,
    attempt,
  });
}
