import Ajv, { ValidateFunction } from 'ajv';
import * as fs from 'fs';
import * as path from 'path';
import { parse as parseYaml } from 'yaml';
import { interpolate } from '../src/lib/interpolate';
import { EXAMPLES_DIR, scheduledManifest, serviceManifest } from './helpers';

/**
 * The JSON Schema is for editors; `validate.ts` is what actually runs. Nothing
 * forces them to agree, so this suite pins the overlap: everything the CLI
 * accepts must also pass the schema, or an editor would underline a valid file.
 */
const schema = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'schema', 'manifest.schema.json'), 'utf-8'),
);

let validate: ValidateFunction;

beforeAll(() => {
  validate = new Ajv({ allErrors: true, strict: false }).compile(schema);
});

function errors(manifest: unknown): string[] {
  return validate(manifest) ? [] : (validate.errors ?? []).map((e) => `${e.instancePath} ${e.message}`);
}

describe('manifest JSON Schema', () => {
  it('accepts the test service manifest', () => {
    expect(errors(serviceManifest())).toEqual([]);
  });

  it('accepts the test scheduled-tasks manifest', () => {
    expect(errors(scheduledManifest())).toEqual([]);
  });

  it.each(fs.readdirSync(EXAMPLES_DIR).filter((f) => f.endsWith('.yaml')))(
    'accepts examples/%s',
    (file) => {
      const raw = parseYaml(fs.readFileSync(path.join(EXAMPLES_DIR, file), 'utf-8'));
      expect(errors(interpolate(raw, { GITHUB_SHA: 'abc123' }))).toEqual([]);
    },
  );

  it('rejects an unknown top-level field, catching typos in an editor', () => {
    expect(errors({ ...serviceManifest(), lodBalancer: {} })).not.toEqual([]);
  });

  it('rejects tasks on a Service and requires them on ScheduledTasks', () => {
    expect(errors({ ...serviceManifest(), tasks: [{ name: 'a', schedule: 'rate(1 hour)' }] })).not.toEqual([]);
    const noTasks = scheduledManifest();
    delete noTasks.tasks;
    expect(errors(noTasks)).not.toEqual([]);
  });
});
