#!/usr/bin/env node
import { spawnSync } from 'child_process';
import * as path from 'path';
import { loadBalancerArnFromListener } from '../lib/alb';
import { ManifestError } from '../lib/errors';
import { InterpolationError } from '../lib/interpolate';
import { loadManifest, resolveManifestPath } from '../lib/manifest';
import { ResolvedConfig } from '../lib/types';

/**
 * The `fargate-deployer` CLI.
 *
 * Everything the GitHub Action does at deploy time goes through here, so the
 * action is a thin wrapper and the exact same command can be run locally to
 * reproduce a CI deploy.
 */

const COMMANDS = ['deploy', 'diff', 'synth', 'destroy', 'validate', 'inspect', 'help'] as const;
type Command = (typeof COMMANDS)[number];

const USAGE = `
fargate-deployer — deploy containers to AWS ECS Fargate from a manifest

Usage:
  fargate-deployer <command> [options] [-- <cdk options>]

Commands:
  deploy      Create or update the stack
  diff        Show what deploying would change
  synth       Print the generated CloudFormation template
  destroy     Delete the stack
  validate    Check the manifest without touching AWS
  inspect     Print resolved manifest facts as key=value (or --json)
  help        Show this message

Options:
  -m, --manifest <path>   Manifest file (default: $FARGATE_DEPLOYER_MANIFEST)
  -i, --image <uri>       Image URI to deploy (default: $FARGATE_DEPLOYER_IMAGE)
      --output <dir>      Directory for synthesized templates (default: cdk.out)
      --bootstrap         Run 'cdk bootstrap' for the target account/region first
      --require-approval <level>
                          never | any-change | broadening (default: never)
      --json              inspect: print JSON instead of key=value lines
  -h, --help              Show this message

Anything after -- is passed straight to the CDK CLI, e.g.:
  fargate-deployer deploy -m deploy/prod.yaml -i my-image:tag -- --verbose

Environment:
  FARGATE_DEPLOYER_MANIFEST   Default for --manifest
  FARGATE_DEPLOYER_IMAGE      Default for --image
  Standard AWS credential variables are used as-is.

Docs: https://github.com/futuremoney/fargate-deployer
`.trim();

interface Options {
  command: Command;
  manifest?: string;
  image?: string;
  output: string;
  bootstrap: boolean;
  requireApproval: string;
  json: boolean;
  passthrough: string[];
}

function main(argv: string[]): number {
  let options: Options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(`✗ ${(error as Error).message}\n`);
    console.error(USAGE);
    return 2;
  }

  if (options.command === 'help') {
    console.log(USAGE);
    return 0;
  }

  if (!options.manifest) {
    console.error('✗ No manifest given. Pass --manifest <path> or set FARGATE_DEPLOYER_MANIFEST.\n');
    console.error(USAGE);
    return 2;
  }

  // `validate` and `synth` need no image, but the CDK app always wants one.
  // A placeholder keeps those two commands usable without a built image.
  const image = options.image ?? 'placeholder:validate-only';
  if (!options.image && (options.command === 'deploy' || options.command === 'destroy')) {
    console.error('✗ No image given. Pass --image <uri> or set FARGATE_DEPLOYER_IMAGE.');
    return 2;
  }

  let config: ResolvedConfig;
  try {
    const manifestPath = resolveManifestPath(options.manifest);
    config = loadManifest(manifestPath);
    options.manifest = path.resolve(manifestPath);
  } catch (error) {
    if (error instanceof ManifestError || error instanceof InterpolationError) {
      console.error(`\n${error.message}\n`);
    } else {
      console.error(`✗ ${(error as Error).message}`);
    }
    return 1;
  }

  if (options.command === 'inspect') {
    printInspect(config, options.json);
    return 0;
  }

  if (options.command === 'validate') {
    printSummary(config, options.image);
    console.log('\n✓ Manifest is valid.');
    return 0;
  }

  printSummary(config, options.image);

  if (options.bootstrap) {
    const code = runCdk(['bootstrap', `aws://${config.account}/${config.region}`], options, image);
    if (code !== 0) {
      return code;
    }
  }

  return runCdk(cdkArgs(options.command, options), options, image);
}

function cdkArgs(command: Command, options: Options): string[] {
  switch (command) {
    case 'deploy':
      return ['deploy', '--all', '--require-approval', options.requireApproval, '--progress', 'events'];
    case 'diff':
      return ['diff'];
    case 'synth':
      return ['synth'];
    case 'destroy':
      return ['destroy', '--all', '--force'];
    default:
      throw new Error(`unreachable: ${command}`);
  }
}

/**
 * Shell out to the CDK CLI bundled with this package.
 *
 * Resolved from this package's own dependencies rather than the user's, so the
 * action works in a repository that has never heard of CDK.
 */
function runCdk(args: string[], options: Options, image: string): number {
  const cdkBin = require.resolve('aws-cdk/bin/cdk');
  const appEntry = path.resolve(__dirname, 'cdk-app.js');

  const full = [
    cdkBin,
    ...args,
    '--app',
    `node ${JSON.stringify(appEntry)}`,
    '--output',
    options.output,
    ...options.passthrough,
  ];

  const result = spawnSync(process.execPath, full, {
    stdio: 'inherit',
    env: {
      ...process.env,
      FARGATE_DEPLOYER_MANIFEST: options.manifest,
      FARGATE_DEPLOYER_IMAGE: image,
      // Context lookups (the VPC) are cached in this file; keep it out of the
      // user's repository.
      CDK_CONTEXT_JSON: process.env.CDK_CONTEXT_JSON,
    },
  });

  if (result.error) {
    console.error(`✗ Could not run the CDK CLI: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

/**
 * Emit the facts a CI job needs before it can talk to AWS — region and account
 * above all. Shaped as `key=value` lines so a workflow can append the output
 * straight to `$GITHUB_OUTPUT`.
 */
function printInspect(config: ResolvedConfig, asJson: boolean): void {
  const facts: Record<string, string> = {
    kind: config.kind,
    name: config.name,
    'stack-name': config.stackName,
    account: config.account,
    region: config.region,
    cluster: config.clusterName,
    'log-group': config.task.logGroupName,
    // Lets a build step target the architecture the task will actually run on.
    architecture: config.task.cpuArchitecture === 'ARM64' ? 'linux/arm64' : 'linux/amd64',
  };

  // Enough for the caller to resolve the load balancer's DNS name and tell the
  // user which records to point at it. Derived from the listener ARN when the
  // manifest attaches to one, so it costs no API call here.
  if (config.kind === 'Service' && config.loadBalancer) {
    const lb = config.loadBalancer;
    const loadBalancerArn =
      lb.loadBalancerArn ??
      (lb.listenerArn ? loadBalancerArnFromListener(lb.listenerArn) : undefined);
    if (loadBalancerArn) {
      facts['load-balancer-arn'] = loadBalancerArn;
    }
    if (lb.hostHeaders.length > 0) {
      facts['host-headers'] = lb.hostHeaders.join(',');
    }
  }

  if (asJson) {
    console.log(JSON.stringify(facts, null, 2));
    return;
  }
  for (const [key, value] of Object.entries(facts)) {
    console.log(`${key}=${value}`);
  }
}

function printSummary(config: ResolvedConfig, image?: string): void {
  const lines = [
    '',
    `  stack     ${config.stackName}`,
    `  kind      ${config.kind}`,
    `  account   ${config.account}  region ${config.region}`,
    `  cluster   ${config.clusterName}`,
  ];
  if (image) {
    lines.push(`  image     ${image}`);
  }
  if (config.kind === 'Service') {
    const lb = config.loadBalancer;
    lines.push(`  tasks     ${config.service.desiredCount} × ${config.task.cpu}cpu/${config.task.memory}MiB`);
    lines.push(
      `  routing   ${
        lb
          ? lb.defaultAction
            ? 'listener default action'
            : [...lb.hostHeaders, ...lb.pathPatterns].join(', ')
          : 'no load balancer'
      }`,
    );
    if (config.autoScaling) {
      lines.push(`  scaling   ${config.autoScaling.minCapacity}–${config.autoScaling.maxCapacity} tasks`);
    }
  } else {
    lines.push(`  jobs      ${config.tasks.length}`);
    for (const task of config.tasks) {
      lines.push(`              ${task.enabled ? '●' : '○'} ${task.name}  ${task.schedule}`);
    }
  }
  console.log(lines.join('\n'));
  console.log('');
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    command: 'help',
    manifest: process.env.FARGATE_DEPLOYER_MANIFEST,
    image: process.env.FARGATE_DEPLOYER_IMAGE,
    output: 'cdk.out',
    bootstrap: false,
    requireApproval: 'never',
    json: false,
    passthrough: [],
  };

  const separator = argv.indexOf('--');
  const args = separator === -1 ? argv : argv.slice(0, separator);
  options.passthrough = separator === -1 ? [] : argv.slice(separator + 1);

  let index = 0;
  if (args[0] && !args[0].startsWith('-')) {
    const command = args[0] as Command;
    if (!COMMANDS.includes(command)) {
      throw new Error(`Unknown command "${args[0]}". Expected one of: ${COMMANDS.join(', ')}.`);
    }
    options.command = command;
    index = 1;
  }

  for (; index < args.length; index++) {
    const arg = args[index];
    const next = () => {
      const value = args[++index];
      if (value === undefined) {
        throw new Error(`${arg} needs a value.`);
      }
      return value;
    };

    switch (arg) {
      case '-m':
      case '--manifest':
        options.manifest = next();
        break;
      case '-i':
      case '--image':
        options.image = next();
        break;
      case '--output':
        options.output = next();
        break;
      case '--bootstrap':
        options.bootstrap = true;
        break;
      case '--json':
        options.json = true;
        break;
      case '--require-approval':
        options.requireApproval = next();
        break;
      case '-h':
      case '--help':
        options.command = 'help';
        break;
      default:
        throw new Error(`Unknown option "${arg}".`);
    }
  }

  return options;
}

process.exitCode = main(process.argv.slice(2));
