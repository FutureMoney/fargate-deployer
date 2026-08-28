import * as cdk from 'aws-cdk-lib';
import { ResolvedConfig } from './types';
export interface AppOptions {
    config: ResolvedConfig;
    /** Full image URI to deploy. */
    image: string;
    /** Existing app to add the stack to. A new one is created when omitted. */
    app?: cdk.App;
}
/**
 * Build the single-stack CDK app the CLI synthesizes.
 *
 * Exported so it can be reused: if you already have a CDK app of your own, pass
 * it in and this adds the stack to it rather than creating a second one.
 */
export declare function createStack(options: AppOptions): cdk.Stack;
//# sourceMappingURL=app.d.ts.map