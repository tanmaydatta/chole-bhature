import { bffClient } from '../lib/bff-client';

export const programApi = {
  list: bffClient.programs,
  get: bffClient.program,
  create: bffClient.createProgram,
  update: bffClient.updateProgram,
  publish: bffClient.publishProgram,
  pause: bffClient.pauseProgram,
  resume: bffClient.resumeProgram,
  end: bffClient.endProgram,
};
