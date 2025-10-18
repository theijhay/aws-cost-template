import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as cloudformation from 'aws-cdk-lib/aws-cloudformation';
import { DeploymentSafetyStackProps } from './types';

export class DeploymentSafetyStack extends cdk.Stack {
  public readonly costEstimationFunction: lambda.Function;
  public readonly deploymentGuardFunction: lambda.Function;
  public readonly rollbackFunction: lambda.Function;
  public readonly deploymentSafetyTopic: sns.Topic;

  constructor(scope: Construct, id: string, props: DeploymentSafetyStackProps) {
    super(scope, id, props);

    const { projectName, environment } = props;

    // SNS topic for deployment safety alerts
    this.deploymentSafetyTopic = new sns.Topic(this, 'DeploymentSafetyTopic', {
      topicName: `deployment-safety-${projectName}-${environment}`,
      displayName: 'Deployment Safety and Cost Guardrails',
    });

    // Email subscription
    const alertEmail = this.node.tryGetContext('alertEmail') || 'devops@company.com';
    this.deploymentSafetyTopic.addSubscription(
      new subscriptions.EmailSubscription(alertEmail)
    );

    // Cost estimation function for pre-deployment analysis
    this.costEstimationFunction = new lambda.Function(this, 'CostEstimationFunction', {
      functionName: `cost-estimation-${projectName}-${environment}`,
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      timeout: cdk.Duration.minutes(10),
      code: lambda.Code.fromInline(`
const AWS = require('aws-sdk');
const pricing = new AWS.Pricing({ region: 'us-east-1' });
const sns = new AWS.SNS();

const PROJECT_NAME = process.env.PROJECT_NAME;
const ENVIRONMENT = process.env.ENVIRONMENT;
const SNS_TOPIC_ARN = process.env.SNS_TOPIC_ARN;

// Cost estimation rules and pricing data
const COST_ESTIMATES = {
  'AWS::EC2::Instance': {
    't3.micro': 0.0104,   // per hour
    't3.small': 0.0208,
    't3.medium': 0.0416,
    't3.large': 0.0832,
    'm5.large': 0.096,
    'm5.xlarge': 0.192,
    'c5.large': 0.085,
    'r5.large': 0.126
  },
  'AWS::RDS::DBInstance': {
    'db.t3.micro': 0.017,
    'db.t3.small': 0.034,
    'db.t3.medium': 0.068,
    'db.r5.large': 0.24
  },
  'AWS::S3::Bucket': {
    'standard': 0.023, // per GB per month
    'ia': 0.0125,
    'glacier': 0.004
  },
  'AWS::EBS::Volume': {
    'gp2': 0.10, // per GB per month
    'gp3': 0.08,
    'io1': 0.125
  }
};

exports.handler = async (event) => {
  console.log('Cost estimation event:', JSON.stringify(event, null, 2));
  
  try {
    let templateBody;
    
    // Handle different event sources
    if (event.Records && event.Records[0].Sns) {
      // CloudFormation event
      const snsMessage = JSON.parse(event.Records[0].Sns.Message);
      templateBody = snsMessage.templateBody;
    } else if (event.templateBody) {
      // Direct invocation
      templateBody = event.templateBody;
    } else {
      throw new Error('No template body provided');
    }
    
    const template = JSON.parse(templateBody);
    const costEstimate = await estimateTemplateCost(template);
    
    // Check if cost estimate exceeds thresholds
    await validateCostEstimate(costEstimate);
    
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Cost estimation completed',
        monthlyCost: costEstimate.monthly,
        resourceCount: costEstimate.resourceCount,
        warnings: costEstimate.warnings
      })
    };
  } catch (error) {
    console.error('Error in cost estimation:', error);
    
    await sns.publish({
      TopicArn: SNS_TOPIC_ARN,
      Subject: 'Cost Estimation Error',
      Message: JSON.stringify({
        error: error.message,
        project: PROJECT_NAME,
        environment: ENVIRONMENT,
        timestamp: new Date().toISOString()
      }, null, 2)
    }).promise();
    
    throw error;
  }
};

async function estimateTemplateCost(template) {
  const estimate = {
    monthly: 0,
    daily: 0,
    resourceCount: 0,
    resourceBreakdown: {},
    warnings: []
  };
  
  const resources = template.Resources || {};
  
  for (const [resourceId, resource] of Object.entries(resources)) {
    estimate.resourceCount++;
    const resourceType = resource.Type;
    const properties = resource.Properties || {};
    
    let resourceCost = 0;
    
    try {
      switch (resourceType) {
        case 'AWS::EC2::Instance':
          resourceCost = estimateEC2Cost(properties);
          break;
        case 'AWS::RDS::DBInstance':
          resourceCost = estimateRDSCost(properties);
          break;
        case 'AWS::S3::Bucket':
          resourceCost = estimateS3Cost(properties);
          break;
        case 'AWS::EBS::Volume':
          resourceCost = estimateEBSCost(properties);
          break;
        case 'AWS::ElasticLoadBalancingV2::LoadBalancer':
          resourceCost = estimateELBCost(properties);
          break;
        default:
          // Unknown resource type
          estimate.warnings.push(\`Unknown resource type for cost estimation: \${resourceType}\`);
      }
      
      if (resourceCost > 0) {
        estimate.monthly += resourceCost;
        estimate.resourceBreakdown[resourceId] = {
          type: resourceType,
          monthlyCost: resourceCost
        };
      }
      
    } catch (error) {
      estimate.warnings.push(\`Error estimating cost for \${resourceId}: \${error.message}\`);
    }
  }
  
  estimate.daily = estimate.monthly / 30;
  
  return estimate;
}

function estimateEC2Cost(properties) {
  const instanceType = properties.InstanceType || 't3.micro';
  const hourlyRate = COST_ESTIMATES['AWS::EC2::Instance'][instanceType] || 0.02;
  
  // Assume running 24/7 for production, 10 hours/day for dev
  const hoursPerMonth = ENVIRONMENT === 'prod' ? 730 : 300;
  
  return hourlyRate * hoursPerMonth;
}

function estimateRDSCost(properties) {
  const instanceClass = properties.DBInstanceClass || 'db.t3.micro';
  const hourlyRate = COST_ESTIMATES['AWS::RDS::DBInstance'][instanceClass] || 0.02;
  
  const hoursPerMonth = ENVIRONMENT === 'prod' ? 730 : 300;
  
  // Add storage cost
  const allocatedStorage = properties.AllocatedStorage || 20;
  const storageCost = allocatedStorage * 0.115; // RDS storage cost per GB
  
  return (hourlyRate * hoursPerMonth) + storageCost;
}

function estimateS3Cost(properties) {
  // Basic S3 cost estimate (difficult without knowing usage)
  // Assume minimal usage for new buckets
  return 5; // $5/month baseline
}

function estimateEBSCost(properties) {
  const size = properties.Size || 10;
  const volumeType = properties.VolumeType || 'gp2';
  const pricePerGB = COST_ESTIMATES['AWS::EBS::Volume'][volumeType] || 0.10;
  
  return size * pricePerGB;
}

function estimateELBCost(properties) {
  // ALB/NLB costs approximately $16-22/month base + data processing
  return 20;
}

async function validateCostEstimate(estimate) {
  const warnings = [];
  
  // Environment-specific thresholds
  const thresholds = {
    dev: { monthly: 50, daily: 5 },
    staging: { monthly: 200, daily: 10 },
    prod: { monthly: 1000, daily: 50 }
  };
  
  const threshold = thresholds[ENVIRONMENT] || thresholds.dev;
  
  if (estimate.monthly > threshold.monthly) {
    warnings.push({
      type: 'HIGH_MONTHLY_COST',
      severity: 'HIGH',
      message: \`Estimated monthly cost (\$\${estimate.monthly.toFixed(2)}) exceeds threshold (\$\${threshold.monthly})\`,
      estimated: estimate.monthly,
      threshold: threshold.monthly
    });
  }
  
  if (estimate.daily > threshold.daily) {
    warnings.push({
      type: 'HIGH_DAILY_COST',
      severity: 'MEDIUM',
      message: \`Estimated daily cost (\$\${estimate.daily.toFixed(2)}) exceeds threshold (\$\${threshold.daily})\`,
      estimated: estimate.daily,
      threshold: threshold.daily
    });
  }
  
  // Check for expensive individual resources
  for (const [resourceId, resourceData] of Object.entries(estimate.resourceBreakdown)) {
    if (resourceData.monthlyCost > threshold.monthly * 0.5) {
      warnings.push({
        type: 'EXPENSIVE_RESOURCE',
        severity: 'MEDIUM',
        message: \`Resource \${resourceId} has high estimated cost (\$\${resourceData.monthlyCost.toFixed(2)})\`,
        resource: resourceId,
        cost: resourceData.monthlyCost
      });
    }
  }
  
  if (warnings.length > 0) {
    await sendCostWarnings(warnings, estimate);
  }
}

async function sendCostWarnings(warnings, estimate) {
  const message = {
    timestamp: new Date().toISOString(),
    project: PROJECT_NAME,
    environment: ENVIRONMENT,
    alertType: 'COST_ESTIMATION_WARNING',
    warnings: warnings,
    estimate: {
      monthly: estimate.monthly,
      daily: estimate.daily,
      resourceCount: estimate.resourceCount
    }
  };
  
  await sns.publish({
    TopicArn: SNS_TOPIC_ARN,
    Subject: \`Cost Estimation Warning: \${warnings.length} issue(s) detected\`,
    Message: JSON.stringify(message, null, 2)
  }).promise();
  
  console.log(\`Sent \${warnings.length} cost warnings\`);
}
      `),
      environment: {
        PROJECT_NAME: projectName,
        ENVIRONMENT: environment,
        SNS_TOPIC_ARN: this.deploymentSafetyTopic.topicArn,
      },
    });

    // Deployment guard function to validate deployments
    this.deploymentGuardFunction = new lambda.Function(this, 'DeploymentGuardFunction', {
      functionName: `deployment-guard-${projectName}-${environment}`,
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      timeout: cdk.Duration.minutes(5),
      code: lambda.Code.fromInline(`
const AWS = require('aws-sdk');
const cloudformation = new AWS.CloudFormation();
const sns = new AWS.SNS();

const PROJECT_NAME = process.env.PROJECT_NAME;
const ENVIRONMENT = process.env.ENVIRONMENT;
const SNS_TOPIC_ARN = process.env.SNS_TOPIC_ARN;

exports.handler = async (event) => {
  console.log('Deployment guard event:', JSON.stringify(event, null, 2));
  
  try {
    // Process CloudFormation stack events
    if (event.Records && event.Records[0].Sns) {
      const snsMessage = JSON.parse(event.Records[0].Sns.Message);
      await processCloudFormationEvent(snsMessage);
    }
    
    return { statusCode: 200, body: 'Deployment guard completed' };
  } catch (error) {
    console.error('Error in deployment guard:', error);
    throw error;
  }
};

async function processCloudFormationEvent(event) {
  const stackName = event.StackName;
  const stackStatus = event.StackStatus;
  const resourceType = event.ResourceType;
  const logicalResourceId = event.LogicalResourceId;
  
  console.log(\`Processing stack event: \${stackName} - \${stackStatus}\`);
  
  // Monitor for cost-concerning events
  if (stackStatus === 'CREATE_IN_PROGRESS' || stackStatus === 'UPDATE_IN_PROGRESS') {
    await validateStackChanges(stackName);
  }
  
  // Alert on failed deployments
  if (stackStatus.includes('FAILED') || stackStatus.includes('ROLLBACK')) {
    await alertDeploymentFailure(event);
  }
  
  // Monitor specific resource types
  if (isExpensiveResourceType(resourceType)) {
    await alertExpensiveResource(event);
  }
}

async function validateStackChanges(stackName) {
  try {
    // Get stack template
    const template = await cloudformation.getTemplate({ StackName: stackName }).promise();
    
    // Basic validation rules
    const violations = [];
    const resources = template.TemplateBody.Resources || {};
    
    for (const [resourceId, resource] of Object.entries(resources)) {
      const resourceType = resource.Type;
      const properties = resource.Properties || {};
      
      // Check for expensive instance types in dev
      if (resourceType === 'AWS::EC2::Instance' && ENVIRONMENT === 'dev') {
        const instanceType = properties.InstanceType;
        const allowedTypes = ['t3.micro', 't3.small'];
        
        if (instanceType && !allowedTypes.includes(instanceType)) {
          violations.push({
            resource: resourceId,
            violation: \`Instance type \${instanceType} not allowed in dev environment\`,
            recommendation: \`Use one of: \${allowedTypes.join(', ')}\`
          });
        }
      }
      
      // Check for unencrypted RDS in prod
      if (resourceType === 'AWS::RDS::DBInstance' && ENVIRONMENT === 'prod') {
        if (!properties.StorageEncrypted) {
          violations.push({
            resource: resourceId,
            violation: 'RDS instance without encryption in production',
            recommendation: 'Enable StorageEncrypted property'
          });
        }
      }
      
      // Check for large EBS volumes
      if (resourceType === 'AWS::EBS::Volume') {
        const size = properties.Size || 0;
        const maxSize = ENVIRONMENT === 'dev' ? 100 : 1000;
        
        if (size > maxSize) {
          violations.push({
            resource: resourceId,
            violation: \`EBS volume size \${size}GB exceeds limit of \${maxSize}GB\`,
            recommendation: \`Reduce volume size or request approval\`
          });
        }
      }
    }
    
    if (violations.length > 0) {
      await sendDeploymentViolations(stackName, violations);
    }
    
  } catch (error) {
    console.error(\`Error validating stack \${stackName}:\`, error);
  }
}

function isExpensiveResourceType(resourceType) {
  const expensiveTypes = [
    'AWS::RDS::DBCluster',
    'AWS::ElastiCache::ReplicationGroup',
    'AWS::Redshift::Cluster',
    'AWS::SageMaker::NotebookInstance',
    'AWS::EC2::NatGateway'
  ];
  
  return expensiveTypes.includes(resourceType);
}

async function alertExpensiveResource(event) {
  const message = {
    timestamp: new Date().toISOString(),
    project: PROJECT_NAME,
    environment: ENVIRONMENT,
    alertType: 'EXPENSIVE_RESOURCE_DEPLOYMENT',
    stackName: event.StackName,
    resourceType: event.ResourceType,
    logicalResourceId: event.LogicalResourceId,
    physicalResourceId: event.PhysicalResourceId,
    message: \`Expensive resource type \${event.ResourceType} being deployed\`
  };
  
  await sns.publish({
    TopicArn: SNS_TOPIC_ARN,
    Subject: \`Expensive Resource Alert: \${event.ResourceType}\`,
    Message: JSON.stringify(message, null, 2)
  }).promise();
}

async function alertDeploymentFailure(event) {
  const message = {
    timestamp: new Date().toISOString(),
    project: PROJECT_NAME,
    environment: ENVIRONMENT,
    alertType: 'DEPLOYMENT_FAILURE',
    stackName: event.StackName,
    stackStatus: event.StackStatus,
    resourceType: event.ResourceType,
    resourceStatus: event.ResourceStatus,
    resourceStatusReason: event.ResourceStatusReason,
    message: 'CloudFormation deployment failure detected'
  };
  
  await sns.publish({
    TopicArn: SNS_TOPIC_ARN,
    Subject: \`Deployment Failure: \${event.StackName}\`,
    Message: JSON.stringify(message, null, 2)
  }).promise();
}

async function sendDeploymentViolations(stackName, violations) {
  const message = {
    timestamp: new Date().toISOString(),
    project: PROJECT_NAME,
    environment: ENVIRONMENT,
    alertType: 'DEPLOYMENT_VIOLATIONS',
    stackName: stackName,
    violations: violations,
    violationCount: violations.length,
    message: 'Deployment validation violations detected'
  };
  
  await sns.publish({
    TopicArn: SNS_TOPIC_ARN,
    Subject: \`Deployment Violations: \${violations.length} issues in \${stackName}\`,
    Message: JSON.stringify(message, null, 2)
  }).promise();
  
  console.log(\`Sent \${violations.length} deployment violations for \${stackName}\`);
}
      `),
      environment: {
        PROJECT_NAME: projectName,
        ENVIRONMENT: environment,
        SNS_TOPIC_ARN: this.deploymentSafetyTopic.topicArn,
      },
    });

    // Rollback function for emergency cost containment
    this.rollbackFunction = new lambda.Function(this, 'RollbackFunction', {
      functionName: `rollback-${projectName}-${environment}`,
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      timeout: cdk.Duration.minutes(10),
      code: lambda.Code.fromInline(`
const AWS = require('aws-sdk');
const cloudformation = new AWS.CloudFormation();
const sns = new AWS.SNS();

const PROJECT_NAME = process.env.PROJECT_NAME;
const ENVIRONMENT = process.env.ENVIRONMENT;
const SNS_TOPIC_ARN = process.env.SNS_TOPIC_ARN;

exports.handler = async (event) => {
  console.log('Rollback event:', JSON.stringify(event, null, 2));
  
  try {
    const stackName = event.stackName;
    const reason = event.reason || 'Cost emergency rollback';
    
    if (!stackName) {
      throw new Error('Stack name is required for rollback');
    }
    
    const rollbackResult = await performRollback(stackName, reason);
    
    await notifyRollback(stackName, reason, rollbackResult);
    
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Rollback completed',
        stackName: stackName,
        result: rollbackResult
      })
    };
  } catch (error) {
    console.error('Error in rollback:', error);
    throw error;
  }
};

async function performRollback(stackName, reason) {
  try {
    // Check stack status
    const stack = await cloudformation.describeStacks({ StackName: stackName }).promise();
    const stackStatus = stack.Stacks[0].StackStatus;
    
    console.log(\`Stack \${stackName} status: \${stackStatus}\`);
    
    let rollbackAction;
    
    if (stackStatus.includes('UPDATE_')) {
      // Cancel update and rollback
      await cloudformation.cancelUpdateStack({ StackName: stackName }).promise();
      rollbackAction = 'UPDATE_CANCELLED';
    } else if (stackStatus.includes('CREATE_')) {
      // Delete the stack if it's being created
      await cloudformation.deleteStack({ StackName: stackName }).promise();
      rollbackAction = 'STACK_DELETED';
    } else if (stackStatus === 'UPDATE_COMPLETE' || stackStatus === 'CREATE_COMPLETE') {
      // Try to rollback to previous version
      const changeSet = await createRollbackChangeSet(stackName);
      if (changeSet) {
        await cloudformation.executeChangeSet({
          ChangeSetName: changeSet.ChangeSetId
        }).promise();
        rollbackAction = 'ROLLBACK_CHANGESET_EXECUTED';
      } else {
        rollbackAction = 'NO_ROLLBACK_AVAILABLE';
      }
    } else {
      rollbackAction = 'NO_ACTION_REQUIRED';
    }
    
    return {
      success: true,
      action: rollbackAction,
      message: \`Rollback action \${rollbackAction} completed for \${stackName}\`
    };
    
  } catch (error) {
    console.error(\`Error performing rollback for \${stackName}:\`, error);
    return {
      success: false,
      error: error.message,
      message: \`Rollback failed for \${stackName}: \${error.message}\`
    };
  }
}

async function createRollbackChangeSet(stackName) {
  try {
    // Get stack events to find the last successful state
    const events = await cloudformation.describeStackEvents({ StackName: stackName }).promise();
    
    // Find the last UPDATE_COMPLETE event
    const lastUpdate = events.StackEvents.find(event => 
      event.ResourceType === 'AWS::CloudFormation::Stack' && 
      event.ResourceStatus === 'UPDATE_COMPLETE'
    );
    
    if (!lastUpdate) {
      console.log('No previous successful update found');
      return null;
    }
    
    // This is a simplified approach - in reality, you'd need to store
    // previous template versions or use AWS Config for rollback
    console.log('Rollback changeset creation would need previous template version');
    return null;
    
  } catch (error) {
    console.error('Error creating rollback changeset:', error);
    return null;
  }
}

async function notifyRollback(stackName, reason, result) {
  const message = {
    timestamp: new Date().toISOString(),
    project: PROJECT_NAME,
    environment: ENVIRONMENT,
    alertType: 'EMERGENCY_ROLLBACK',
    stackName: stackName,
    reason: reason,
    result: result,
    success: result.success,
    action: result.action,
    message: \`Emergency rollback executed for \${stackName}\`
  };
  
  await sns.publish({
    TopicArn: SNS_TOPIC_ARN,
    Subject: \`Emergency Rollback: \${stackName}\`,
    Message: JSON.stringify(message, null, 2)
  }).promise();
  
  console.log(\`Sent rollback notification for \${stackName}\`);
}
      `),
      environment: {
        PROJECT_NAME: projectName,
        ENVIRONMENT: environment,
        SNS_TOPIC_ARN: this.deploymentSafetyTopic.topicArn,
      },
    });

    // Grant permissions for deployment safety functions
    const deploymentSafetyPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'cloudformation:DescribeStacks',
        'cloudformation:DescribeStackEvents',
        'cloudformation:GetTemplate',
        'cloudformation:CancelUpdateStack',
        'cloudformation:DeleteStack',
        'cloudformation:CreateChangeSet',
        'cloudformation:ExecuteChangeSet',
        'cloudformation:DescribeChangeSet',
        'pricing:GetProducts',
        'pricing:DescribeServices',
        'sns:Publish',
      ],
      resources: ['*'],
    });

    this.costEstimationFunction.addToRolePolicy(deploymentSafetyPolicy);
    this.deploymentGuardFunction.addToRolePolicy(deploymentSafetyPolicy);
    this.rollbackFunction.addToRolePolicy(deploymentSafetyPolicy);

    // EventBridge rule for CloudFormation events
    const cfnEventRule = new events.Rule(this, 'CloudFormationEventRule', {
      ruleName: `cfn-events-${projectName}-${environment}`,
      description: 'Monitor CloudFormation events for deployment safety',
      eventPattern: {
        source: ['aws.cloudformation'],
        detailType: ['CloudFormation Stack Status Change'],
        detail: {
          'stack-id': [{ 'wildcard': `*${projectName}*` }],
        },
      },
    });

    cfnEventRule.addTarget(new targets.LambdaFunction(this.deploymentGuardFunction));

    // Outputs
    new cdk.CfnOutput(this, 'CostEstimationFunctionArn', {
      value: this.costEstimationFunction.functionArn,
      description: 'Lambda function for pre-deployment cost estimation',
      exportName: `${id}-CostEstimationFunction`,
    });

    new cdk.CfnOutput(this, 'DeploymentGuardFunctionArn', {
      value: this.deploymentGuardFunction.functionArn,
      description: 'Lambda function for deployment validation',
      exportName: `${id}-DeploymentGuardFunction`,
    });

    new cdk.CfnOutput(this, 'RollbackFunctionArn', {
      value: this.rollbackFunction.functionArn,
      description: 'Lambda function for emergency rollbacks',
      exportName: `${id}-RollbackFunction`,
    });

    new cdk.CfnOutput(this, 'DeploymentSafetyTopicArn', {
      value: this.deploymentSafetyTopic.topicArn,
      description: 'SNS topic for deployment safety alerts',
      exportName: `${id}-DeploymentSafetyTopic`,
    });

    new cdk.CfnOutput(this, 'DeploymentSafetyGuide', {
      value: JSON.stringify({
        preDeployment: 'Call cost estimation function with CloudFormation template',
        monitoring: 'CloudFormation events automatically monitored',
        emergencyRollback: 'Call rollback function with stack name and reason',
        notifications: 'All alerts sent via SNS topic'
      }),
      description: 'Deployment safety usage guide',
      exportName: `${id}-DeploymentSafetyGuide`,
    });
  }
}