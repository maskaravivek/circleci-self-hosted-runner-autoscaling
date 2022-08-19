#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { CircleciSelfHostedRunnerAutoscalingStack } from '../lib/circleci-self-hosted-runner-autoscaling-stack';
const { env } = require("process");

const app = new cdk.App();
new CircleciSelfHostedRunnerAutoscalingStack(app, 'CircleciSelfHostedRunnerAutoscalingStack', {
    maxInstances: "4",
    keypairName: env.AWS_KEYPAIR_NAME,
    runnerName: "aws-runner"
});