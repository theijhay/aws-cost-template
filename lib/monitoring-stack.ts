import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { MonitoringStackProps } from './types';

export class MonitoringStack extends cdk.Stack {
  public readonly costDashboard: cloudwatch.Dashboard;
  public readonly costReportingFunction: lambda.Function;
  public readonly costAlertsFunction: lambda.Function;
  public readonly monitoringTopic: sns.Topic;

  constructor(scope: Construct, id: string, props: MonitoringStackProps) {
    super(scope, id, props);

    const { projectName, environment, budget } = props;

    // SNS topic for cost monitoring alerts
    this.monitoringTopic = new sns.Topic(this, 'MonitoringTopic', {
      topicName: `cost-monitoring-${projectName}-${environment}`,
      displayName: 'Cost Monitoring and Alerts',
    });

    // Email subscription
    const alertEmail = this.node.tryGetContext('alertEmail') || 'devops@company.com';
    this.monitoringTopic.addSubscription(
      new subscriptions.EmailSubscription(alertEmail)
    );

    // Cost reporting function
    this.costReportingFunction = new lambda.Function(this, 'CostReportingFunction', {
      functionName: `cost-reporting-${projectName}-${environment}`,
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      timeout: cdk.Duration.minutes(15),
      code: lambda.Code.fromInline(`
const AWS = require('aws-sdk');
const costexplorer = new AWS.CostExplorer({ region: 'us-east-1' });
const s3 = new AWS.S3();
const sns = new AWS.SNS();
const cloudwatch = new AWS.CloudWatch();

const PROJECT_NAME = process.env.PROJECT_NAME;
const ENVIRONMENT = process.env.ENVIRONMENT;
const BUDGET = parseFloat(process.env.BUDGET);
const SNS_TOPIC_ARN = process.env.SNS_TOPIC_ARN;
const REPORT_BUCKET = process.env.REPORT_BUCKET;

exports.handler = async (event) => {
  console.log('Cost reporting event:', JSON.stringify(event, null, 2));
  
  try {
    const today = new Date();
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    
    // Generate cost report
    const costReport = await generateCostReport(startOfMonth, endOfMonth);
    
    // Save report to S3
    if (REPORT_BUCKET) {
      await saveCostReportToS3(costReport);
    }
    
    // Send custom metrics to CloudWatch
    await sendCostMetrics(costReport);
    
    // Check for cost anomalies and send alerts
    await checkCostAnomalies(costReport);
    
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Cost report generated successfully',
        currentSpend: costReport.monthToDate.total,
        budgetUtilization: costReport.budgetUtilization,
        projectedSpend: costReport.projection.total
      })
    };
  } catch (error) {
    console.error('Error generating cost report:', error);
    throw error;
  }
};

async function generateCostReport(startDate, endDate) {
  const params = {
    TimePeriod: {
      Start: startDate.toISOString().split('T')[0],
      End: endDate.toISOString().split('T')[0]
    },
    Granularity: 'DAILY',
    Metrics: ['BlendedCost'],
    GroupBy: [
      { Type: 'DIMENSION', Key: 'SERVICE' },
      { Type: 'TAG', Key: 'Environment' }
    ],
    Filter: {
      Tags: {
        Key: 'Project',
        Values: [PROJECT_NAME]
      }
    }
  };
  
  const result = await costexplorer.getCostAndUsage(params).promise();
  
  // Process results
  let totalCost = 0;
  const serviceBreakdown = {};
  const dailyCosts = [];
  
  for (const timeData of result.ResultsByTime) {
    let dailyCost = 0;
    
    for (const group of timeData.Groups) {
      const cost = parseFloat(group.Metrics.BlendedCost.Amount);
      const service = group.Keys[0];
      
      dailyCost += cost;
      totalCost += cost;
      
      if (!serviceBreakdown[service]) {
        serviceBreakdown[service] = 0;
      }
      serviceBreakdown[service] += cost;
    }
    
    dailyCosts.push({
      date: timeData.TimePeriod.Start,
      cost: dailyCost
    });
  }
  
  // Calculate projections
  const daysInMonth = endDate.getDate();
  const currentDay = new Date().getDate();
  const avgDailyCost = totalCost / currentDay;
  const projectedMonthlySpend = avgDailyCost * daysInMonth;
  
  return {
    period: {
      start: startDate.toISOString().split('T')[0],
      end: endDate.toISOString().split('T')[0]
    },
    monthToDate: {
      total: totalCost,
      serviceBreakdown: serviceBreakdown,
      dailyCosts: dailyCosts
    },
    projection: {
      total: projectedMonthlySpend,
      dailyAverage: avgDailyCost
    },
    budget: BUDGET,
    budgetUtilization: (totalCost / BUDGET) * 100,
    projectedBudgetUtilization: (projectedMonthlySpend / BUDGET) * 100
  };
}

async function saveCostReportToS3(report) {
  const key = \`cost-reports/\${report.period.start}/report-\${Date.now()}.json\`;
  
  await s3.putObject({
    Bucket: REPORT_BUCKET,
    Key: key,
    Body: JSON.stringify(report, null, 2),
    ContentType: 'application/json'
  }).promise();
  
  console.log(\`Cost report saved to s3://\${REPORT_BUCKET}/\${key}\`);
}

async function sendCostMetrics(report) {
  const metrics = [
    {
      MetricName: 'MonthToDateSpend',
      Value: report.monthToDate.total,
      Unit: 'None'
    },
    {
      MetricName: 'ProjectedMonthlySpend',
      Value: report.projection.total,
      Unit: 'None'
    },
    {
      MetricName: 'BudgetUtilization',
      Value: report.budgetUtilization,
      Unit: 'Percent'
    },
    {
      MetricName: 'ProjectedBudgetUtilization',
      Value: report.projectedBudgetUtilization,
      Unit: 'Percent'
    }
  ];
  
  for (const metric of metrics) {
    await cloudwatch.putMetricData({
      Namespace: \`CostControl/\${PROJECT_NAME}\`,
      MetricData: [{
        MetricName: metric.MetricName,
        Value: metric.Value,
        Unit: metric.Unit,
        Dimensions: [
          { Name: 'Project', Value: PROJECT_NAME },
          { Name: 'Environment', Value: ENVIRONMENT }
        ]
      }]
    }).promise();
  }
  
  console.log('Cost metrics sent to CloudWatch');
}

async function checkCostAnomalies(report) {
  const alerts = [];
  
  // Check budget utilization
  if (report.projectedBudgetUtilization > 100) {
    alerts.push({
      type: 'BUDGET_OVERRUN_PROJECTED',
      severity: 'CRITICAL',
      message: \`Projected monthly spend (\$\${report.projection.total.toFixed(2)}) will exceed budget (\$\${BUDGET})\`,
      currentSpend: report.monthToDate.total,
      projectedSpend: report.projection.total,
      budgetUtilization: report.projectedBudgetUtilization
    });
  } else if (report.budgetUtilization > 80) {
    alerts.push({
      type: 'BUDGET_WARNING',
      severity: 'HIGH',
      message: \`Current spending (\$\${report.monthToDate.total.toFixed(2)}) is \${report.budgetUtilization.toFixed(1)}% of budget\`,
      currentSpend: report.monthToDate.total,
      budgetUtilization: report.budgetUtilization
    });
  }
  
  // Check for expensive services
  const topServices = Object.entries(report.monthToDate.serviceBreakdown)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 5);
  
  for (const [service, cost] of topServices) {
    if (cost > BUDGET * 0.3) { // Single service using >30% of budget
      alerts.push({
        type: 'EXPENSIVE_SERVICE',
        severity: 'MEDIUM',
        message: \`Service '\${service}' is consuming \$\${cost.toFixed(2)} (\${((cost/BUDGET)*100).toFixed(1)}% of budget)\`,
        service: service,
        cost: cost,
        budgetPercentage: (cost/BUDGET)*100
      });
    }
  }
  
  // Send alerts if any
  if (alerts.length > 0) {
    await sendCostAlerts(alerts, report);
  }
}

async function sendCostAlerts(alerts, report) {
  const message = {
    timestamp: new Date().toISOString(),
    project: PROJECT_NAME,
    environment: ENVIRONMENT,
    alerts: alerts,
    summary: {
      currentSpend: report.monthToDate.total,
      projectedSpend: report.projection.total,
      budget: BUDGET,
      budgetUtilization: report.budgetUtilization
    }
  };
  
  await sns.publish({
    TopicArn: SNS_TOPIC_ARN,
    Subject: \`Cost Alert: \${alerts.length} issue(s) detected for \${PROJECT_NAME}-\${ENVIRONMENT}\`,
    Message: JSON.stringify(message, null, 2)
  }).promise();
  
  console.log(\`Sent \${alerts.length} cost alerts\`);
}
      `),
      environment: {
        PROJECT_NAME: projectName,
        ENVIRONMENT: environment,
        BUDGET: budget.toString(),
        SNS_TOPIC_ARN: this.monitoringTopic.topicArn,
      },
    });

    // Cost alerts function for real-time monitoring
    this.costAlertsFunction = new lambda.Function(this, 'CostAlertsFunction', {
      functionName: `cost-alerts-${projectName}-${environment}`,
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      timeout: cdk.Duration.minutes(5),
      code: lambda.Code.fromInline(`
const AWS = require('aws-sdk');
const sns = new AWS.SNS();
const cloudwatch = new AWS.CloudWatch();

const PROJECT_NAME = process.env.PROJECT_NAME;
const ENVIRONMENT = process.env.ENVIRONMENT;
const SNS_TOPIC_ARN = process.env.SNS_TOPIC_ARN;

exports.handler = async (event) => {
  console.log('Cost alert event:', JSON.stringify(event, null, 2));
  
  try {
    // Process CloudWatch alarm events
    if (event.Records) {
      for (const record of event.Records) {
        if (record.Sns) {
          const snsMessage = JSON.parse(record.Sns.Message);
          await processCostAlarm(snsMessage);
        }
      }
    }
    
    return { statusCode: 200, body: 'Cost alerts processed' };
  } catch (error) {
    console.error('Error processing cost alerts:', error);
    throw error;
  }
};

async function processCostAlarm(alarmData) {
  const alertMessage = {
    timestamp: new Date().toISOString(),
    project: PROJECT_NAME,
    environment: ENVIRONMENT,
    alarmName: alarmData.AlarmName,
    alarmDescription: alarmData.AlarmDescription,
    newState: alarmData.NewStateValue,
    oldState: alarmData.OldStateValue,
    reason: alarmData.NewStateReason,
    trigger: alarmData.Trigger,
    alertType: 'CLOUDWATCH_ALARM'
  };
  
  // Determine severity based on alarm name
  let severity = 'MEDIUM';
  if (alarmData.AlarmName.includes('emergency') || alarmData.AlarmName.includes('critical')) {
    severity = 'CRITICAL';
  } else if (alarmData.AlarmName.includes('warning')) {
    severity = 'HIGH';
  }
  
  alertMessage.severity = severity;
  
  await sns.publish({
    TopicArn: SNS_TOPIC_ARN,
    Subject: \`Cost Alarm: \${alarmData.AlarmName} - \${alarmData.NewStateValue}\`,
    Message: JSON.stringify(alertMessage, null, 2)
  }).promise();
  
  console.log(\`Processed cost alarm: \${alarmData.AlarmName}\`);
}
      `),
      environment: {
        PROJECT_NAME: projectName,
        ENVIRONMENT: environment,
        SNS_TOPIC_ARN: this.monitoringTopic.topicArn,
      },
    });

    // Grant permissions for cost reporting and alerting
    const costMonitoringPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'ce:GetCostAndUsage',
        'ce:GetDimensions',
        'ce:GetUsageReport',
        'ce:GetCostCategories',
        'cloudwatch:PutMetricData',
        'cloudwatch:GetMetricStatistics',
        's3:PutObject',
        's3:GetObject',
        'sns:Publish',
      ],
      resources: ['*'],
    });

    this.costReportingFunction.addToRolePolicy(costMonitoringPolicy);
    this.costAlertsFunction.addToRolePolicy(costMonitoringPolicy);

    // Create CloudWatch Dashboard
    this.costDashboard = new cloudwatch.Dashboard(this, 'CostDashboard', {
      dashboardName: `cost-control-${projectName}-${environment}`,
    });

    // Dashboard widgets
    const costMetrics = [
      new cloudwatch.Metric({
        namespace: `CostControl/${projectName}`,
        metricName: 'MonthToDateSpend',
        dimensionsMap: {
          Project: projectName,
          Environment: environment,
        },
        statistic: 'Average',
      }),
      new cloudwatch.Metric({
        namespace: `CostControl/${projectName}`,
        metricName: 'ProjectedMonthlySpend',
        dimensionsMap: {
          Project: projectName,
          Environment: environment,
        },
        statistic: 'Average',
      }),
    ];

    const budgetUtilizationMetric = new cloudwatch.Metric({
      namespace: `CostControl/${projectName}`,
      metricName: 'BudgetUtilization',
      dimensionsMap: {
        Project: projectName,
        Environment: environment,
      },
      statistic: 'Average',
    });

    // Add widgets to dashboard
    this.costDashboard.addWidgets(
      // Cost overview
      new cloudwatch.GraphWidget({
        title: 'Monthly Cost Trend',
        left: costMetrics,
        width: 12,
        height: 6,
      }),
      
      // Budget utilization
      new cloudwatch.SingleValueWidget({
        title: 'Budget Utilization',
        metrics: [budgetUtilizationMetric],
        width: 6,
        height: 6,
      }),
      
      // Budget gauge
      new cloudwatch.GaugeWidget({
        title: 'Budget Usage',
        metrics: [budgetUtilizationMetric],
        leftYAxis: {
          min: 0,
          max: 150,
        },
        width: 6,
        height: 6,
      }),
    );

    // Add EC2 cost metrics
    const ec2CostMetric = new cloudwatch.Metric({
      namespace: 'AWS/Billing',
      metricName: 'EstimatedCharges',
      dimensionsMap: {
        ServiceName: 'AmazonEC2',
        Currency: 'USD',
      },
      statistic: 'Maximum',
    });

    const s3CostMetric = new cloudwatch.Metric({
      namespace: 'AWS/Billing',
      metricName: 'EstimatedCharges',
      dimensionsMap: {
        ServiceName: 'AmazonS3',
        Currency: 'USD',
      },
      statistic: 'Maximum',
    });

    const rdsCostMetric = new cloudwatch.Metric({
      namespace: 'AWS/Billing',
      metricName: 'EstimatedCharges',
      dimensionsMap: {
        ServiceName: 'AmazonRDS',
        Currency: 'USD',
      },
      statistic: 'Maximum',
    });

    this.costDashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Service Cost Breakdown',
        left: [ec2CostMetric, s3CostMetric, rdsCostMetric],
        width: 12,
        height: 6,
      }),
    );

    // Schedule cost reporting
    const costReportingRule = new events.Rule(this, 'CostReportingRule', {
      ruleName: `cost-reporting-${projectName}-${environment}`,
      description: 'Daily cost reporting and analysis',
      schedule: events.Schedule.cron({
        minute: '0',
        hour: '9',
        day: '*',
        month: '*',
        year: '*',
      }),
    });

    costReportingRule.addTarget(new targets.LambdaFunction(this.costReportingFunction));

    // Create cost alarms
    const dailySpendAlarm = new cloudwatch.Alarm(this, 'DailySpendAlarm', {
      alarmName: `daily-spend-${projectName}-${environment}`,
      alarmDescription: `Daily spending alarm for ${projectName} ${environment}`,
      metric: new cloudwatch.Metric({
        namespace: 'AWS/Billing',
        metricName: 'EstimatedCharges',
        dimensionsMap: {
          Currency: 'USD',
        },
        statistic: 'Maximum',
      }),
      threshold: budget / 20, // 5% of monthly budget per day
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
    });

    dailySpendAlarm.addAlarmAction(
      new actions.SnsAction(this.monitoringTopic)
    );

    const budgetUtilizationAlarm = new cloudwatch.Alarm(this, 'BudgetUtilizationAlarm', {
      alarmName: `budget-utilization-${projectName}-${environment}`,
      alarmDescription: `Budget utilization alarm for ${projectName} ${environment}`,
      metric: budgetUtilizationMetric,
      threshold: 80,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
    });

    budgetUtilizationAlarm.addAlarmAction(
      new actions.SnsAction(this.monitoringTopic)
    );

    // Outputs
    new cdk.CfnOutput(this, 'CostDashboardURL', {
      value: `https://console.aws.amazon.com/cloudwatch/home?region=${this.region}#dashboards:name=${this.costDashboard.dashboardName}`,
      description: 'URL to the cost monitoring dashboard',
      exportName: `${id}-CostDashboardURL`,
    });

    new cdk.CfnOutput(this, 'MonitoringTopicArn', {
      value: this.monitoringTopic.topicArn,
      description: 'SNS topic for cost monitoring alerts',
      exportName: `${id}-MonitoringTopic`,
    });

    new cdk.CfnOutput(this, 'CostReportingFunctionArn', {
      value: this.costReportingFunction.functionArn,
      description: 'Lambda function for cost reporting',
      exportName: `${id}-CostReportingFunction`,
    });

    new cdk.CfnOutput(this, 'DashboardName', {
      value: this.costDashboard.dashboardName,
      description: 'CloudWatch dashboard name',
      exportName: `${id}-DashboardName`,
    });
  }
}