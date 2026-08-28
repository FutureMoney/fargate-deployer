import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { ResolvedConfig } from './types';
/**
 * Everything the two stacks share: looking up the VPC, resolving (or creating)
 * the task security group and IAM roles, and assembling task definitions.
 *
 * Kept as free functions rather than a base class so each stack still reads top
 * to bottom. The context is built once per stack because several of these
 * resources — the log group, the imported secrets, the ECR repository — are
 * shared by every task definition in the stack and must not be created twice.
 */
export interface StackContext {
    vpc: ec2.IVpc;
    cluster: ecs.ICluster;
    securityGroups: ec2.ISecurityGroup[];
    subnetSelection: ec2.SubnetSelection;
    executionRole: iam.IRole;
    taskRole: iam.IRole;
    image: ecs.ContainerImage;
    secrets: Record<string, ecs.Secret>;
    logGroup: logs.ILogGroup;
}
export declare function buildContext(scope: Construct, config: ResolvedConfig, image: string): StackContext;
export interface TaskDefinitionOptions {
    /** Suffix for construct IDs, so several task definitions can coexist in one stack. */
    idSuffix?: string;
    /** Family name. Defaults to the config name. */
    family?: string;
    cpu?: number;
    memory?: number;
    environment?: Record<string, string>;
    command?: string[];
    /** Add a port mapping. Omitted for scheduled tasks. */
    containerPort?: number;
}
export interface BuiltTaskDefinition {
    taskDefinition: ecs.FargateTaskDefinition;
    container: ecs.ContainerDefinition;
}
export declare function buildTaskDefinition(scope: Construct, config: ResolvedConfig, context: StackContext, options?: TaskDefinitionOptions): BuiltTaskDefinition;
//# sourceMappingURL=base.d.ts.map