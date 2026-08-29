import { loadBalancerArnFromListener } from './alb';
import { ResolvedConfig } from './types';

/**
 * The facts a CI job needs from a manifest before it can talk to AWS.
 *
 * This is the contract between the CLI and the GitHub Action: the action runs
 * `fargate-deployer inspect` and appends the output straight to `$GITHUB_OUTPUT`,
 * so every key here is an action output or the input to a later step. Renaming
 * one silently breaks the action, which is why it lives in a pure function with
 * its own tests rather than inline in the CLI.
 */
export function inspectFacts(config: ResolvedConfig): Record<string, string> {
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

  return facts;
}

/** Render the facts as the `key=value` lines `$GITHUB_OUTPUT` expects. */
export function formatFacts(facts: Record<string, string>): string {
  return Object.entries(facts)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
}
