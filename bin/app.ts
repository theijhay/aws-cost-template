#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { CostControlStack } from '../lib/cost-control-stack';
import { TaggingStack } from '../lib/tagging-stack';
import { BudgetStack } from '../lib/budget-stack';
import { GovernanceStack } from '../lib/governance-stack';
import { AutomationStack } from '../lib/automation-stack';
import { MonitoringStack } from '../lib/monitoring-stack';
import { DeploymentSafetyStack } from '../lib/deployment-safety-stack';

const app = new cdk.App();

// Environment configuration
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
};

// Project configuration from context or environment
const projectName = app.node.tryGetContext('projectName') || process.env.PROJECT_NAME || 'cost-control-demo';
const environment = app.node.tryGetContext('environment') || process.env.ENVIRONMENT || 'dev';
const costCenter = app.node.tryGetContext('costCenter') || process.env.COST_CENTER || 'engineering';
const owner = app.node.tryGetContext('owner') || process.env.OWNER || 'devops-team';

// Budget limits by environment
const budgetLimits = {
  dev: 100,
  staging: 300,
  prod: 1000,
  qa: 150,
};

const budget = budgetLimits[environment as keyof typeof budgetLimits] || 100;

// Common tags
const commonTags = {
  Project: projectName,
  Environment: environment,
  CostCenter: costCenter,
  Owner: owner,
  ManagedBy: 'aws-cost-control-template',
  CreationDate: new Date().toISOString().split('T')[0],
  Version: '1.0.0',
};

// Core cost control stack
const costControlStack = new CostControlStack(app, `CostControl-${projectName}-${environment}`, {
  env,
  projectName,
  environment,
  budget,
  tags: commonTags,
});

// Tagging enforcement stack
const taggingStack = new TaggingStack(app, `Tagging-${projectName}-${environment}`, {
  env,
  projectName,
  environment,
  tags: commonTags,
});

// Budget and alerting stack
const budgetStack = new BudgetStack(app, `Budget-${projectName}-${environment}`, {
  env,
  projectName,
  environment,
  budget,
  tags: commonTags,
});

// Resource governance and restrictions
const governanceStack = new GovernanceStack(app, `Governance-${projectName}-${environment}`, {
  env,
  projectName,
  environment,
  tags: commonTags,
});

// Automation and lifecycle management
const automationStack = new AutomationStack(app, `Automation-${projectName}-${environment}`, {
  env,
  projectName,
  environment,
  tags: commonTags,
});

// Monitoring and cost visibility
const monitoringStack = new MonitoringStack(app, `Monitoring-${projectName}-${environment}`, {
  env,
  projectName,
  environment,
  budget,
  tags: commonTags,
});

// Deployment safety and guardrails
const deploymentSafetyStack = new DeploymentSafetyStack(app, `DeploymentSafety-${projectName}-${environment}`, {
  env,
  projectName,
  environment,
  tags: commonTags,
});

// Stack dependencies
budgetStack.addDependency(taggingStack);
governanceStack.addDependency(taggingStack);
automationStack.addDependency(governanceStack);
monitoringStack.addDependency(budgetStack);
deploymentSafetyStack.addDependency(monitoringStack);

// Apply tags to all stacks
cdk.Tags.of(app).add('Project', projectName);
cdk.Tags.of(app).add('Environment', environment);
cdk.Tags.of(app).add('CostCenter', costCenter);
cdk.Tags.of(app).add('Owner', owner);
cdk.Tags.of(app).add('ManagedBy', 'aws-cost-control-template');