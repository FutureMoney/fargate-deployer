/**
 * Load balancer ARN handling.
 *
 * A service usually attaches to an existing listener, and the stack deliberately
 * never looks the load balancer up — that keeps `elasticloadbalancing:Describe*`
 * off the list of permissions a deploy needs. But the listener ARN already
 * contains the load balancer's identity, so the ARN can be derived without an
 * API call, and the action can then make one read-only call to turn it into the
 * DNS name a user needs for their CNAME record.
 *
 *   listener      arn:aws:elasticloadbalancing:us-east-1:111122223333:listener/app/my-alb/1234567890abcdef/fedcba0987654321
 *   load balancer arn:aws:elasticloadbalancing:us-east-1:111122223333:loadbalancer/app/my-alb/1234567890abcdef
 */
/**
 * Derive the load balancer ARN that a listener belongs to.
 *
 * Returns undefined for anything that is not a listener ARN, so a caller can
 * fall back to an explicitly configured load balancer ARN.
 */
export declare function loadBalancerArnFromListener(listenerArn: string): string | undefined;
//# sourceMappingURL=alb.d.ts.map