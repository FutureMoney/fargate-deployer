import * as cdk from 'aws-cdk-lib';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { Construct } from 'constructs';
import { ResolvedServiceConfig } from './types';
export interface FargateServiceStackProps extends cdk.StackProps {
    config: ResolvedServiceConfig;
    /** Full image URI to deploy, e.g. `111122223333.dkr.ecr.us-east-1.amazonaws.com/api:abc123`. */
    image: string;
}
/**
 * A long-running Fargate service, optionally registered behind an existing
 * Application Load Balancer.
 *
 * This stack attaches to infrastructure you already own — cluster, VPC, subnets,
 * load balancer, certificate — and creates only what belongs to this one
 * service: the task definition, the service, its target group and listener rule,
 * its log group, and (when you did not supply them) a security group and IAM
 * roles.
 */
export declare class FargateServiceStack extends cdk.Stack {
    readonly service: ecs.FargateService;
    readonly targetGroup?: elbv2.ApplicationTargetGroup;
    constructor(scope: Construct, id: string, props: FargateServiceStackProps);
    private attachToLoadBalancer;
    /**
     * Attach to the listener named in the manifest, or create one on the given
     * load balancer.
     *
     * The load balancer is only looked up in the create case. Attaching by
     * listener ARN — the common path — needs no describe permissions on the ALB
     * at all, which keeps the deploy policy small.
     */
    private resolveListener;
    private configureAutoScaling;
    private addOutputs;
}
//# sourceMappingURL=service-stack.d.ts.map