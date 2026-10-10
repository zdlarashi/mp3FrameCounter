import Fastify, { type FastifyInstance } from 'fastify';

/**
 * Builds the Fastify application without starting a server, so tests can
 * exercise it via `app.inject()`.
 */
export function buildApp(): FastifyInstance {
  return Fastify();
}
