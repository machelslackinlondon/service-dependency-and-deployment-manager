import Fastify, { type FastifyInstance } from 'fastify';

export interface BuildAppOptions {
  readonly logger?: boolean;
}

export async function buildApp(
  options: BuildAppOptions = {},
): Promise<FastifyInstance> {
  return Fastify({ logger: options.logger ?? false });
}
