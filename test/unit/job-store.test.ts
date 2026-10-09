import { JobStore } from '../../src/scheduler/job-store.js';

const input = {
  metadataVersion: 1,
  requestedTargets: ['api'],
  selectedServices: ['api'],
};

describe('JobStore retention', () => {
  test('never evicts an active job when retention is full', () => {
    const jobs = new JobStore(1);
    const active = jobs.create(input);

    expect(() => jobs.create(input)).toThrow(
      'Deployment job retention capacity exceeded',
    );
    expect(jobs.get(active.id).status).toBe('queued');
  });

  test('evicts the oldest terminal job to admit a new job', () => {
    const jobs = new JobStore(1);
    const completed = jobs.create(input);
    jobs.complete(completed.id, 'succeeded');

    const next = jobs.create(input);

    expect(() => jobs.get(completed.id)).toThrow('Deployment job not found');
    expect(jobs.get(next.id).status).toBe('queued');
  });
});
