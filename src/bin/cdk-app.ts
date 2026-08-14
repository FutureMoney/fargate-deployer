#!/usr/bin/env node
/**
 * CDK app entry point.
 *
 * Never run this directly — the `fargate-deployer` CLI invokes it via
 * `cdk --app "node cdk-app.js"`, passing the manifest path and image through the
 * environment because that is the only channel the CDK CLI gives an app.
 */
import * as cdk from 'aws-cdk-lib';
import { createStack } from '../lib/app';
import { loadManifest } from '../lib/manifest';

const manifestPath = process.env.FARGATE_DEPLOYER_MANIFEST;
const image = process.env.FARGATE_DEPLOYER_IMAGE;

if (!manifestPath || !image) {
  throw new Error(
    'cdk-app.js is invoked by the fargate-deployer CLI and needs ' +
      'FARGATE_DEPLOYER_MANIFEST and FARGATE_DEPLOYER_IMAGE in the environment. ' +
      'Run `fargate-deployer deploy --manifest <path> --image <uri>` instead.',
  );
}

const app = new cdk.App();
createStack({ config: loadManifest(manifestPath), image, app });
app.synth();
