import autocannon from 'autocannon';

interface Options {
  readonly baseUrl: string;
  readonly connections: number;
  readonly durationSeconds: number;
  readonly serviceCount: number;
  readonly serviceDurationMs: number;
  readonly failureMode: 'never' | 'always';
  readonly configuredMaxActive: number;
}

const options = parseOptions(process.argv.slice(2));
await seedServices(options);

let maximumObservedActive = 0;
const samples: Promise<void>[] = [];
const sampler = setInterval(() => {
  samples.push(
    sampleActiveDeployments(options.baseUrl).then((active) => {
      maximumObservedActive = Math.max(maximumObservedActive, active);
    }),
  );
}, 100);

let result: autocannon.Result;
try {
  result = await autocannon({
    url: `${options.baseUrl}/deploy`,
    method: 'POST',
    connections: options.connections,
    duration: options.durationSeconds,
    headers: { 'content-type': 'application/json' },
    body: '{}',
    timeout: Math.max(10, Math.ceil(options.serviceDurationMs / 1_000) + 5),
  });
} finally {
  clearInterval(sampler);
  await Promise.all(samples);
}

maximumObservedActive = Math.max(
  maximumObservedActive,
  await sampleActiveDeployments(options.baseUrl),
);
if (maximumObservedActive > options.configuredMaxActive) {
  throw new Error(
    `Observed ${maximumObservedActive} active deployments; configured maximum is ${options.configuredMaxActive}`,
  );
}

process.stdout.write(
  `${JSON.stringify(
    {
      scenario: options,
      requests: result.requests,
      latency: result.latency,
      errors: result.errors,
      timeouts: result.timeouts,
      non2xx: result.non2xx,
      maximumObservedActive,
      memory: process.memoryUsage(),
      cpu: process.cpuUsage(),
    },
    null,
    2,
  )}\n`,
);

async function seedServices(options: Options): Promise<void> {
  for (let index = 0; index < options.serviceCount; index += 1) {
    const name = `load-${String(index).padStart(4, '0')}`;
    await postJson(`${options.baseUrl}/services`, {
      name,
      deploymentDurationMs: options.serviceDurationMs,
      failureMode: options.failureMode,
    });
    if (index > 0) {
      await postJson(`${options.baseUrl}/dependencies`, {
        service: name,
        dependency: `load-${String(index - 1).padStart(4, '0')}`,
      });
    }
  }
}

async function postJson(url: string, payload: object): Promise<void> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok && response.status !== 409) {
    throw new Error(`Setup request failed with ${response.status}: ${url}`);
  }
}

async function sampleActiveDeployments(baseUrl: string): Promise<number> {
  try {
    const response = await fetch(`${baseUrl}/metrics`);
    const metrics = await response.text();
    const match = /^active_deployments\s+([0-9.]+)$/mu.exec(metrics);
    return match === null ? 0 : Number(match[1]);
  } catch {
    return 0;
  }
}

function parseOptions(args: readonly string[]): Options {
  const values = new Map(
    args
      .filter((argument) => argument.startsWith('--') && argument.includes('='))
      .map((argument) => {
        const [key, ...rest] = argument.slice(2).split('=');
        return [key as string, rest.join('=')];
      }),
  );
  const mode = values.get('mode') ?? 'success';
  if (!['success', 'slow', 'failure'].includes(mode)) {
    throw new Error('Mode must be success, slow, or failure');
  }
  return {
    baseUrl: values.get('url') ?? 'http://127.0.0.1:3000',
    connections: positive(values.get('connections'), 20, 'connections'),
    durationSeconds: positive(values.get('duration'), 10, 'duration'),
    serviceCount: positive(values.get('services'), 10, 'services'),
    serviceDurationMs:
      mode === 'slow'
        ? positive(values.get('service-duration'), 1_000, 'service-duration')
        : positive(values.get('service-duration'), 25, 'service-duration'),
    failureMode: mode === 'failure' ? 'always' : 'never',
    configuredMaxActive: positive(
      values.get('max-active'),
      8,
      'max-active',
    ),
  };
}

function positive(raw: string | undefined, fallback: number, label: string): number {
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value;
}
