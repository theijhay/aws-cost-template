import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as budgets from 'aws-cdk-lib/aws-budgets';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import { BudgetStackProps, BUDGET_THRESHOLDS } from './types';

export class BudgetStack extends cdk.Stack {
  public readonly budgetAlarmTopic: sns.Topic;
  public readonly emergencyActionTopic: sns.Topic;
  public readonly budgetResponseFunction: lambda.Function;
  public readonly costAnomalyDetectionFunction: lambda.Function;

  constructor(scope: Construct, id: string, props: BudgetStackProps) {
    super(scope, id, props);

    const { projectName, environment, budget } = props;

    // SNS Topics for different severity levels
    this.budgetAlarmTopic = new sns.Topic(this, 'BudgetAlarmTopic', {
      topicName: `budget-alarms-${projectName}-${environment}`,
      displayName: 'Budget Alerts and Warnings',
    });

    this.emergencyActionTopic = new sns.Topic(this, 'EmergencyActionTopic', {
      topicName: `emergency-actions-${projectName}-${environment}`,
      displayName: 'Emergency Budget Actions',
    });

    // Email and SMS subscriptions
    const alertEmail = cdk.Stack.of(this).node.tryGetContext('alertEmail') || 'devops@company.com';
    const alertPhone = cdk.Stack.of(this).node.tryGetContext('alertPhone');

    this.budgetAlarmTopic.addSubscription(
      new subscriptions.EmailSubscription(alertEmail)
    );

    if (alertPhone) {
      this.emergencyActionTopic.addSubscription(
        new subscriptions.SmsSubscription(alertPhone)
      );
    }

    this.emergencyActionTopic.addSubscription(
      new subscriptions.EmailSubscription(alertEmail)
    );

    // Lambda function for budget responses and automated actions
    this.budgetResponseFunction = new lambda.Function(this, 'BudgetResponseFunction', {
      functionName: `budget-response-${projectName}-${environment}`,
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      timeout: cdk.Duration.minutes(10),
      code: lambda.Code.fromInline(`
const AWS = require('aws-sdk');
const ec2 = new AWS.EC2();
const rds = new AWS.RDS();
const autoscaling = new AWS.AutoScaling();
const sns = new AWS.SNS();

const PROJECT_NAME = process.env.PROJECT_NAME;
const ENVIRONMENT = process.env.ENVIRONMENT;
const EMERGENCY_TOPIC_ARN = process.env.EMERGENCY_TOPIC_ARN;

exports.handler = async (event) => {
  console.log('Budget event received:', JSON.stringify(event, null, 2));
  
  try {
    const budgetEvent = JSON.parse(event.Records[0].Sns.Message);
    const alertType = budgetEvent.AlarmName || budgetEvent.MessageType;
    const thresholdPercentage = parseFloat(budgetEvent.MessageType?.match(/\\d+/)?.[0] || '0');
    
    console.log(\`Budget threshold reached: \${thresholdPercentage}%\`);
    
    if (thresholdPercentage >= 90 && ENVIRONMENT === 'dev') {
      await emergencyShutdown();
    } else if (thresholdPercentage >= 80) {
      await criticalCostReduction();
    } else if (thresholdPercentage >= 50) {
      await warningActions();
    }
    
    return { statusCode: 200, body: 'Budget response executed' };
  } catch (error) {
    console.error('Error processing budget event:', error);
    await sendEmergencyAlert({
      error: error.message,
      event: JSON.stringify(event),
      action: 'Budget response function failed'
    });
    throw error;
  }
};

async function emergencyShutdown() {
  console.log('Executing emergency shutdown for development environment');
  
  const actions = [];
  
  try {
    // Stop all EC2 instances with auto-shutdown tag
    const instances = await ec2.describeInstances({
      Filters: [
        { Name: 'tag:Project', Values: [PROJECT_NAME] },
        { Name: 'tag:Environment', Values: [ENVIRONMENT] },
        { Name: 'tag:AutoShutdown', Values: ['true', 'yes', '1'] },
        { Name: 'instance-state-name', Values: ['running'] }
      ]
    }).promise();
    
    const instanceIds = [];
    instances.Reservations.forEach(reservation => {
      reservation.Instances.forEach(instance => {
        instanceIds.push(instance.InstanceId);
      });
    });
    
    if (instanceIds.length > 0) {
      await ec2.stopInstances({ InstanceIds: instanceIds }).promise();
      actions.push(\`Stopped \${instanceIds.length} EC2 instances\`);
    }
    
    // Stop RDS instances (if auto-shutdown enabled)
    const rdsInstances = await rds.describeDBInstances().promise();
    for (const instance of rdsInstances.DBInstances) {
      const tags = await rds.listTagsForResource({
        ResourceName: instance.DBInstanceArn
      }).promise();
      
      const projectTag = tags.TagList.find(tag => tag.Key === 'Project')?.Value;
      const envTag = tags.TagList.find(tag => tag.Key === 'Environment')?.Value;
      const autoShutdownTag = tags.TagList.find(tag => tag.Key === 'AutoShutdown')?.Value;
      
      if (projectTag === PROJECT_NAME && envTag === ENVIRONMENT && 
          ['true', 'yes', '1'].includes(autoShutdownTag?.toLowerCase())) {
        await rds.stopDBInstance({
          DBInstanceIdentifier: instance.DBInstanceIdentifier
        }).promise();
        actions.push(\`Stopped RDS instance: \${instance.DBInstanceIdentifier}\`);
      }
    }
    
    await sendEmergencyAlert({
      action: 'Emergency Shutdown Executed',
      environment: ENVIRONMENT,
      project: PROJECT_NAME,
      actionsPerformed: actions,
      message: 'All auto-shutdown enabled resources have been stopped due to budget emergency'
    });
    
  } catch (error) {
    console.error('Error during emergency shutdown:', error);
    throw error;
  }
}

async function criticalCostReduction() {
  console.log('Executing critical cost reduction measures');
  
  const actions = [];
  
  try {
    // Scale down Auto Scaling Groups
    const asGroups = await autoscaling.describeAutoScalingGroups().promise();
    
    for (const group of asGroups.AutoScalingGroups) {
      const projectTag = group.Tags.find(tag => tag.Key === 'Project')?.Value;
      const envTag = group.Tags.find(tag => tag.Key === 'Environment')?.Value;
      
      if (projectTag === PROJECT_NAME && envTag === ENVIRONMENT) {
        const currentMin = group.MinSize;
        const newMin = Math.max(0, Math.floor(currentMin * 0.5));
        const newDesired = Math.max(newMin, Math.floor(group.DesiredCapacity * 0.5));
        
        await autoscaling.updateAutoScalingGroup({
          AutoScalingGroupName: group.AutoScalingGroupName,
          MinSize: newMin,
          DesiredCapacity: newDesired
        }).promise();
        
        actions.push(\`Scaled down ASG \${group.AutoScalingGroupName} to \${newDesired} instances\`);
      }
    }
    
    await sendEmergencyAlert({
      action: 'Critical Cost Reduction',
      severity: 'HIGH',
      environment: ENVIRONMENT,
      project: PROJECT_NAME,
      actionsPerformed: actions,
      message: 'Critical budget threshold reached. Cost reduction measures applied.'
    });
    
  } catch (error) {
    console.error('Error during critical cost reduction:', error);
    throw error;
  }
}

async function warningActions() {
  console.log('Executing warning-level actions');
  
  await sendEmergencyAlert({
    action: 'Budget Warning',
    severity: 'MEDIUM',
    environment: ENVIRONMENT,
    project: PROJECT_NAME,
    message: 'Budget warning threshold reached. Please review and optimize costs.',
    recommendation: 'Review resource utilization and consider scaling down non-critical resources'
  });
}

async function sendEmergencyAlert(alertData) {
  const message = {
    timestamp: new Date().toISOString(),
    alertType: 'BUDGET_EMERGENCY',
    ...alertData
  };
  
  await sns.publish({
    TopicArn: EMERGENCY_TOPIC_ARN,
    Subject: \`URGENT: Budget Alert - \${alertData.action}\`,
    Message: JSON.stringify(message, null, 2)
  }).promise();
  
  console.log('Emergency alert sent');
}
      `),
      environment: {
        PROJECT_NAME: projectName,
        ENVIRONMENT: environment,
        EMERGENCY_TOPIC_ARN: this.emergencyActionTopic.topicArn,
      },
    });

    // Grant necessary permissions to the budget response function
    this.budgetResponseFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'ec2:DescribeInstances',
        'ec2:StopInstances',
        'ec2:StartInstances',
        'ec2:DescribeTags',
        'rds:DescribeDBInstances',
        'rds:StopDBInstance',
        'rds:StartDBInstance',
        'rds:ListTagsForResource',
        'autoscaling:DescribeAutoScalingGroups',
        'autoscaling:UpdateAutoScalingGroup',
        'sns:Publish',
      ],
      resources: ['*'],
      conditions: {
        StringEquals: {
          'ec2:ResourceTag/Project': projectName,
          'ec2:ResourceTag/Environment': environment,
        },
      },
    }));

    // Subscribe budget response function to budget alarm topic
    this.budgetAlarmTopic.addSubscription(
      new subscriptions.LambdaSubscription(this.budgetResponseFunction)
    );

    // Create budget with multiple thresholds
    const projectBudget = new budgets.CfnBudget(this, 'ProjectBudget', {
      budget: {
        budgetName: `${projectName}-${environment}-monthly-budget`,
        budgetType: 'COST',
        timeUnit: 'MONTHLY',
        budgetLimit: {
          amount: budget,
          unit: 'USD',
        },
        costFilters: {
          TagKey: ['Project', 'Environment'],
          TagValue: [projectName, environment],
        },
      },
      notificationsWithSubscribers: [
        // Warning at 50%
        {
          notification: {
            notificationType: 'ACTUAL',
            comparisonOperator: 'GREATER_THAN',
            threshold: BUDGET_THRESHOLDS.WARNING,
            thresholdType: 'PERCENTAGE',
          },
          subscribers: [
            {
              subscriptionType: 'SNS',
              address: this.budgetAlarmTopic.topicArn,
            },
          ],
        },
        // Critical at 80%
        {
          notification: {
            notificationType: 'ACTUAL',
            comparisonOperator: 'GREATER_THAN',
            threshold: BUDGET_THRESHOLDS.CRITICAL,
            thresholdType: 'PERCENTAGE',
          },
          subscribers: [
            {
              subscriptionType: 'SNS',
              address: this.emergencyActionTopic.topicArn,
            },
          ],
        },
        // Emergency at 100%
        {
          notification: {
            notificationType: 'ACTUAL',
            comparisonOperator: 'GREATER_THAN',
            threshold: BUDGET_THRESHOLDS.EMERGENCY,
            thresholdType: 'PERCENTAGE',
          },
          subscribers: [
            {
              subscriptionType: 'SNS',
              address: this.emergencyActionTopic.topicArn,
            },
          ],
        },
        // Forecasted spending at 90%
        {
          notification: {
            notificationType: 'FORECASTED',
            comparisonOperator: 'GREATER_THAN',
            threshold: 90,
            thresholdType: 'PERCENTAGE',
          },
          subscribers: [
            {
              subscriptionType: 'SNS',
              address: this.budgetAlarmTopic.topicArn,
            },
          ],
        },
      ],
    });

    // Cost anomaly detection function
    this.costAnomalyDetectionFunction = new lambda.Function(this, 'CostAnomalyDetectionFunction', {
      functionName: `cost-anomaly-detection-${projectName}-${environment}`,
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      timeout: cdk.Duration.minutes(15),
      code: lambda.Code.fromInline(`
const AWS = require('aws-sdk');
const costexplorer = new AWS.CostExplorer({ region: 'us-east-1' });
const sns = new AWS.SNS();

const PROJECT_NAME = process.env.PROJECT_NAME;
const ENVIRONMENT = process.env.ENVIRONMENT;
const ALERT_TOPIC_ARN = process.env.ALERT_TOPIC_ARN;

exports.handler = async (event) => {
  console.log('Running cost anomaly detection...');
  
  try {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const lastWeek = new Date(today);
    lastWeek.setDate(lastWeek.getDate() - 7);
    
    // Get yesterday's costs
    const yesterdayCosts = await getCostsForPeriod(
      yesterday.toISOString().split('T')[0],
      today.toISOString().split('T')[0]
    );
    
    // Get same day last week for comparison
    const lastWeekCosts = await getCostsForPeriod(
      lastWeek.toISOString().split('T')[0],
      new Date(lastWeek.getTime() + 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    );
    
    // Analyze for anomalies
    await analyzeAnomalies(yesterdayCosts, lastWeekCosts);
    
    return { statusCode: 200, body: 'Cost anomaly detection completed' };
  } catch (error) {
    console.error('Error in cost anomaly detection:', error);
    throw error;
  }
};

async function getCostsForPeriod(startDate, endDate) {
  const params = {
    TimePeriod: {
      Start: startDate,
      End: endDate
    },
    Granularity: 'DAILY',
    Metrics: ['BlendedCost'],
    GroupBy: [
      {
        Type: 'DIMENSION',
        Key: 'SERVICE'
      }
    ],
    Filter: {
      Tags: {
        Key: 'Project',
        Values: [PROJECT_NAME]
      }
    }
  };
  
  const result = await costexplorer.getCostAndUsage(params).promise();
  return result.ResultsByTime[0]?.Groups || [];
}

async function analyzeAnomalies(currentCosts, baselineCosts) {
  const anomalies = [];
  
  for (const currentService of currentCosts) {
    const serviceName = currentService.Keys[0];
    const currentCost = parseFloat(currentService.Metrics.BlendedCost.Amount);
    
    const baselineService = baselineCosts.find(s => s.Keys[0] === serviceName);
    const baselineCost = baselineService ? parseFloat(baselineService.Metrics.BlendedCost.Amount) : 0;
    
    // Detect significant cost increases (>50% or >$10)
    const percentageIncrease = baselineCost > 0 ? ((currentCost - baselineCost) / baselineCost) * 100 : 0;
    const absoluteIncrease = currentCost - baselineCost;
    
    if ((percentageIncrease > 50 && absoluteIncrease > 5) || absoluteIncrease > 10) {
      anomalies.push({
        service: serviceName,
        currentCost: currentCost.toFixed(2),
        baselineCost: baselineCost.toFixed(2),
        percentageIncrease: percentageIncrease.toFixed(1),
        absoluteIncrease: absoluteIncrease.toFixed(2)
      });
    }
  }
  
  if (anomalies.length > 0) {
    await sendAnomalyAlert(anomalies);
  }
}

async function sendAnomalyAlert(anomalies) {
  const message = {
    alertType: 'COST_ANOMALY_DETECTED',
    timestamp: new Date().toISOString(),
    project: PROJECT_NAME,
    environment: ENVIRONMENT,
    anomalies: anomalies,
    totalAnomalies: anomalies.length,
    action: 'Review unusual cost spikes and investigate potential issues'
  };
  
  await sns.publish({
    TopicArn: ALERT_TOPIC_ARN,
    Subject: \`Cost Anomaly Alert: \${anomalies.length} services with unusual spending\`,
    Message: JSON.stringify(message, null, 2)
  }).promise();
  
  console.log(\`Sent anomaly alert for \${anomalies.length} services\`);
}
      `),
      environment: {
        PROJECT_NAME: projectName,
        ENVIRONMENT: environment,
        ALERT_TOPIC_ARN: this.budgetAlarmTopic.topicArn,
      },
    });

    // Grant cost explorer permissions
    this.costAnomalyDetectionFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'ce:GetCostAndUsage',
        'ce:GetDimensions',
        'ce:GetUsageReport',
        'sns:Publish',
      ],
      resources: ['*'],
    }));

    // Schedule daily cost anomaly detection
    const anomalyDetectionRule = new events.Rule(this, 'AnomalyDetectionRule', {
      ruleName: `cost-anomaly-detection-${projectName}-${environment}`,
      description: 'Daily cost anomaly detection',
      schedule: events.Schedule.cron({
        minute: '30',
        hour: '9',
        day: '*',
        month: '*',
        year: '*',
      }),
    });

    anomalyDetectionRule.addTarget(new targets.LambdaFunction(this.costAnomalyDetectionFunction));

    // CloudWatch alarms for rapid cost increases
    const dailySpendAlarm = new cloudwatch.Alarm(this, 'DailySpendAlarm', {
      alarmName: `daily-spend-alarm-${projectName}-${environment}`,
      alarmDescription: 'Alert when daily spending exceeds expected threshold',
      metric: new cloudwatch.Metric({
        namespace: 'AWS/Billing',
        metricName: 'EstimatedCharges',
        dimensionsMap: {
          Currency: 'USD',
        },
        statistic: 'Maximum',
      }),
      threshold: budget / 10, // 10% of monthly budget per day
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
    });

    dailySpendAlarm.addAlarmAction(new actions.SnsAction(this.budgetAlarmTopic));

    // Outputs
    new cdk.CfnOutput(this, 'BudgetName', {
      value: `${projectName}-${environment}-monthly-budget`,
      description: 'Name of the created budget',
      exportName: `${id}-BudgetName`,
    });

    new cdk.CfnOutput(this, 'BudgetAmount', {
      value: budget.toString(),
      description: 'Monthly budget amount in USD',
      exportName: `${id}-BudgetAmount`,
    });

    new cdk.CfnOutput(this, 'BudgetAlarmTopicArn', {
      value: this.budgetAlarmTopic.topicArn,
      description: 'SNS topic for budget alarms',
      exportName: `${id}-BudgetAlarmTopic`,
    });

    new cdk.CfnOutput(this, 'EmergencyActionTopicArn', {
      value: this.emergencyActionTopic.topicArn,
      description: 'SNS topic for emergency budget actions',
      exportName: `${id}-EmergencyActionTopic`,
    });
  }
}