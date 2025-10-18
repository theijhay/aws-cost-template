# 🛡️ AWS Cost Control Template

**Smart deployment wrapper that adds cost controls to any AWS project without code changes.**

Transform any existing AWS project into a cost-controlled deployment with a single command. No code changes, no infrastructure modifications - just pure cost protection.

## 📖 Table of Contents

- [🚀 Quick Start](#-quick-start)
- [🎯 What This Does](#-what-this-does) 
- [⚡ What Happens When You Connect](#-what-happens-when-you-connect)
- [🚀 Features](#-features)
- [📋 Supported Project Types](#-supported-project-types)
- [💡 Example Workflows](#-example-workflows)
- [🔧 Configuration](#-configuration)
- [📊 Monitoring & Dashboards](#-monitoring--dashboards)
- [🔄 Deployment Commands](#-deployment-commands)
- [📁 Project Structure After Connection](#-project-structure-after-connection)
- [🛠️ Advanced Usage](#️-advanced-usage)
- [🚨 Emergency Controls](#-emergency-controls)
- [🔍 Detection & Compatibility](#-detection--compatibility)
- [🎛️ Cost Control Strategies](#️-cost-control-strategies)
- [📞 Support & Contributing](#-support--contributing)
- [🏆 Success Stories](#-success-stories)

## ⚡ Quick Start

### Option 1: NPX (Recommended)
```bash
# In your existing AWS project directory
npx @aws-cost-control/template

# Follow the interactive setup
# Then deploy with cost controls
npm run deploy-with-cost-controls
```

### Option 2: GitHub Template
```bash
# Clone the template repository
git clone https://github.com/your-org/aws-cost-control-template.git
cd aws-cost-control-template

# Connect to your existing project
npm run connect /path/to/your/existing/project
```

### Option 3: Local Installation
```bash
# Install globally for repeated use
npm install -g @aws-cost-control/template

# Navigate to any AWS project and connect
cd /path/to/your/project
cost-connect
```

## 🎯 What This Does

When you connect your project, this template:

1. **🔍 Analyzes** your existing infrastructure (CDK, CloudFormation, Terraform, etc.)
2. **💰 Estimates** deployment costs before any resources are created
3. **🛡️ Wraps** your deployment with automatic cost controls
4. **🏷️ Tags** all resources for cost tracking
5. **📊 Creates** real-time cost monitoring dashboards
6. **⚠️ Sets up** budget alerts and automatic safeguards
7. **🔄 Enables** auto-shutdown for dev environments

**Zero risk. Zero code changes. Maximum savings.**

## 🎬 Try the Demo

See the template in action:

```bash
# Run interactive demo
npx github:theijhay/aws-cost-template demo

# Or clone and run locally
git clone https://github.com/theijhay/aws-cost-template.git
cd aws-cost-template
./scripts/demo.sh
```

The demo shows:
- ✅ **Connection process** with a sample CDK project
- ✅ **Cost validation** success and failure scenarios  
- ✅ **Real-time cost monitoring** examples
- ✅ **Optimization recommendations** in action

## 🚀 Quick Test

Test with any existing AWS project:

```bash
# 1. Navigate to your project
cd your-existing-aws-project

# 2. Connect (30 seconds)
npx github:theijhay/aws-cost-template connect

# 3. Review what was added
ls -la
cat cost-controls-config.json
cat package.json

# 4. Deploy with cost controls
npm run deploy-with-cost-controls
```

**Your project now has cost protection built-in!**

## ⚡ What Happens When You Connect

### 📋 The Command
```bash
npx github:theijhay/aws-cost-template connect
```

### Step-by-Step Process (60 seconds total)

#### 1. **NPX Downloads Template** (30 seconds)
```bash
✅ NPX fetches: github.com/theijhay/aws-cost-template
✅ Installs temporarily in: ~/.npm/_npx/
✅ Executes: index.js with "connect" argument
```

#### 2. **Template Analyzes Your Project** (5 seconds)
```bash
🔍 Step 1: Analyzing existing project...
   Detected project type: cdk-typescript        # or nodejs, python, etc.
   Infrastructure: aws-cdk                       # or cloudformation, terraform
   Found 4 existing resource patterns           # Scans your code for AWS resources
   ✅ Project analysis complete
```

#### 3. **Template Gathers Configuration** (5 seconds)
```bash
⚙️  Step 2: Gathering configuration...
   Project Name: my-serverless-app              # From package.json or directory
   Environment: dev                             # Default (customizable)
   Default Budget: $150/month                   # Based on detected resources
   ✅ Configuration gathered
```

#### 4. **Template Injects Cost Controls** (10 seconds)
```bash
💉 Step 3: Injecting cost controls...
   Copied 5 cost control modules               # Budget monitor, validator, etc.
   Created deployment wrapper script           # deploy-with-cost-controls.js
   ✅ Cost controls injected
```

#### 5. **Template Updates Your Scripts** (5 seconds)
```bash
📋 Step 4: Setting up deployment scripts...
   Updated package.json with cost control scripts
   Created quick cost check script
   ✅ Deployment scripts configured
```

#### 6. **Template Creates Config Files** (5 seconds)
```bash
📝 Step 5: Creating configuration files...
   ✅ Configuration files created

📦 Step 6: Installing dependencies...
   Installing aws-sdk...
   ✅ Dependencies ready
```

#### 7. **Success!** 🎉
```bash
🎉 Cost controls successfully connected!

📋 Next Steps:
1. Review cost-controls-config.json
2. Run: npm run deploy-with-cost-controls
3. Monitor your CloudWatch dashboard

✅ Your existing code remains unchanged!
```

### Files Created in Your Project

#### **Before NPX Command:**
```
my-existing-project/
├── src/                    # Your app code
├── lib/                    # Your infrastructure
├── package.json            # Original
└── cdk.json               # Original CDK config
```

#### **After NPX Command:**
```
my-existing-project/
├── src/                                      # ← UNCHANGED
├── lib/                                      # ← UNCHANGED  
├── package.json                              # ← UPDATED (new scripts)
├── cdk.json                                  # ← UNCHANGED
├── cost-controls-config.json                 # ← NEW
├── deploy-with-cost-controls.js              # ← NEW
├── quick-cost-check.sh                       # ← NEW
├── .gitignore                                # ← UPDATED
└── node_modules/@cost-controls/              # ← NEW
    ├── budget-monitor.js
    ├── resource-validator.js
    ├── cost-estimator.js
    ├── tag-enforcer.js
    └── lifecycle-manager.js
```

### New Commands Available
```bash
# Deploy with cost protection (MAIN COMMAND)
npm run deploy-with-cost-controls

# Check current costs
npm run cost-report

# Estimate deployment costs
npm run cost-estimate

# Quick cost check
./quick-cost-check.sh

# Your original deploy (backup)
npm run deploy-original      # If you had one
```

## 🚀 Features Overview

### 1. **Mandatory Tagging Framework**
- Enforces required tags on all resources
- Automatic tag validation and compliance reporting
- Service Control Policies for tag enforcement
- Real-time tag violation alerts

### 2. **Multi-Layer Budget Protection**
- Environment-specific budget limits
- Tiered alerting (50%, 80%, 100% thresholds)
- Automated emergency actions for development environments
- Cost anomaly detection and alerts

### 3. **Resource Governance & Restrictions**
- Instance type restrictions by environment
- Storage size limits and encryption enforcement
- Regional access controls
- Restricted service access for development environments

### 4. **Automated Lifecycle Management**
- Scheduled auto-shutdown for development resources
- Automated resource cleanup (unused EIPs, volumes, etc.)
- S3 lifecycle policies for cost optimization
- Weekend and holiday shutdown schedules

### 5. **Real-Time Cost Monitoring**
- CloudWatch dashboards with cost visibility
- Daily cost reporting and projections
- Service-level cost breakdown
- Budget utilization tracking

### 6. **Deployment Safety Mechanisms**
- Pre-deployment cost estimation
- Real-time deployment validation
- Emergency rollback capabilities
- Cost-aware deployment guardrails

## 🚀 Deployment Methods

### Method 1: NPX (Instant Connection)

**Best for:** Quick trials, one-off projects, CI/CD integration

```bash
# Navigate to your existing AWS project
cd my-existing-project

# Connect cost controls (30 seconds)
npx github:theijhay/aws-cost-template connect

# Deploy with cost controls
npm run deploy-with-cost-controls
```

**What happens:**
1. Analyzes your project structure
2. Injects cost control modules
3. Creates deployment wrapper
4. Sets up monitoring configuration

### Method 2: GitHub Template (Development/Customization)

**Best for:** Customization, team deployment, advanced configuration

```bash
# Clone and customize the template
git clone https://github.com/theijhay/aws-cost-template.git
cd aws-cost-template

# Customize cost control rules (optional)
vim lib/cost-control-stack.ts

# Connect to existing project
npm run connect /path/to/your/existing/project

# Or run the connection script directly
node scripts/connect.js
```

**Customization options:**
- Modify cost control rules in `lib/`
- Customize Lambda functions
- Add organization-specific policies
- Extend monitoring dashboards

### Method 3: Global Installation (Repeated Use)

**Best for:** DevOps teams, multiple projects, enterprise use

```bash
# Install globally once
npm install -g aws-cost-template

# Use across multiple projects
cd /path/to/project-1
cost-connect

cd /path/to/project-2  
cost-connect

cd /path/to/project-3
cost-connect
```

## 🔧 Configuration Options

### Basic Configuration
```json
{
  "projectName": "my-app",
  "environment": "dev", 
  "budget": 100,
  "autoShutdown": true
}
```

### Advanced Configuration
```json
{
  "projectName": "enterprise-app",
  "environment": "prod",
  "costCenter": "platform-engineering",
  "owner": "devops-team",
  "budget": 5000,
  "alertEmail": "alerts@company.com",
  "slackWebhook": "https://hooks.slack.com/...",
  "autoShutdown": false,
  "resourceLimits": {
    "maxInstanceTypes": ["t3.small", "t3.medium", "m5.large"],
    "maxVolumeSize": 1000,
    "maxDailySpend": 200
  },
  "customValidation": {
    "rules": [
      {
        "resourceType": "AWS::RDS::DBInstance",
        "property": "MultiAZ", 
        "required": true,
        "environment": ["prod"]
      }
    ]
  },
  "monitoring": {
    "dashboard": true,
    "detailedMetrics": true,
    "anomalyDetection": true,
    "dailyReports": true,
    "weeklyOptimization": true
  },
  "compliance": {
    "requiredTags": ["Project", "Environment", "Owner", "CostCenter", "DataClassification"],
    "tagValidation": "strict",
    "governanceMode": "enforce"
  }
}
```

### Environment-Based Budgets
```json
{
  "environments": {
    "dev": { "budget": 50, "autoShutdown": true },
    "staging": { "budget": 200, "autoShutdown": false },
    "prod": { "budget": 1000, "autoShutdown": false }
  }
}
```

## 🔄 Deployment Process Flow

### 1. Pre-Deployment Phase
```bash
npm run deploy-with-cost-controls
```

**Steps:**
1. **Load configuration** from `cost-controls-config.json`
2. **Detect deployment type** (CDK, CloudFormation, Terraform, etc.)
3. **Synthesize template** (for CDK) or analyze existing templates
4. **Estimate costs** based on resources in template
5. **Validate against limits** (budget, instance types, etc.)
6. **Apply mandatory tags** to all resources
7. **Check compliance** with governance policies

### 2. Deployment Phase
**If validation passes:**
1. **Deploy cost control infrastructure** (budgets, alarms)
2. **Deploy your application** using original deployment method
3. **Configure post-deployment monitoring**
4. **Set up auto-shutdown schedules** (if enabled)
5. **Create CloudWatch dashboard**

**If validation fails:**
- Show detailed error report
- Provide optimization recommendations
- Allow manual override (with approval)

### 3. Post-Deployment Phase
1. **Tag validation** - ensure all resources are properly tagged
2. **Cost monitoring setup** - real-time cost tracking
3. **Dashboard creation** - CloudWatch cost dashboard
4. **Alert configuration** - budget and anomaly alerts
5. **Scheduling** - auto-shutdown, cleanup, reports

## 💰 Cost Savings Examples

### Development Environment
- **Before:** t3.large + 500GB storage = $87/month
- **After:** t3.micro + 50GB storage + auto-shutdown = $12/month
- **Savings:** 86% reduction

### Staging Environment
- **Before:** t3.medium + RDS medium = $156/month  
- **After:** t3.small + RDS small + optimized = $43/month
- **Savings:** 72% reduction

### Real Deployment Example
```bash
$ npm run deploy-with-cost-controls

🛡️  Starting cost-controlled deployment...

🔍 Pre-deployment cost validation...
📋 Synthesizing CDK template...
✅ Estimated cost: $47.20/month
✅ Within budget: $150/month

🏗️  Deploying cost control infrastructure...
🚀 Deploying application with cost controls...
⚙️  Configuring post-deployment cost controls...

🎉 Deployment completed successfully with cost controls!

📊 Monitor your costs at:
https://console.aws.amazon.com/cloudwatch/home#dashboards:name=cost-control-my-app-dev
```

## 🏗️ Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Tagging       │    │    Budget       │    │   Governance    │
│   Framework     │────│   Protection    │────│   & Controls    │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         │              ┌─────────────────┐               │
         └──────────────│   Monitoring    │───────────────┘
                        │   & Reporting   │
                        └─────────────────┘
                                 │
         ┌─────────────────┐     │     ┌─────────────────┐
         │   Automation    │─────┼─────│  Deployment     │
         │   & Lifecycle   │     │     │    Safety       │
         └─────────────────┘     │     └─────────────────┘
                                 │
                   ┌─────────────────┐
                   │ SNS Alerts &    │
                   │ Notifications   │
                   └─────────────────┘
```

## 🛠️ Configuration

### Environment-Specific Settings

The template supports three environments with different cost control settings:

#### Development Environment
- **Budget**: $100/month
- **Instance Types**: t3.micro, t3.small only
- **Storage Limit**: 100GB per volume
- **Auto-Shutdown**: Daily at 7 PM, weekends
- **Restricted Services**: Redshift, MemoryDB, Neptune

#### Staging Environment
- **Budget**: $300/month
- **Instance Types**: t3.micro to t3.medium
- **Storage Limit**: 500GB per volume
- **Auto-Shutdown**: Daily at 7 PM only
- **Restricted Services**: Redshift, MemoryDB

#### Production Environment
- **Budget**: $1000/month (customizable)
- **Instance Types**: Full range of approved types
- **Storage Limit**: 2000GB per volume
- **Auto-Shutdown**: Disabled
- **Restricted Services**: None

### Customization

#### Budget Limits
```bash
# Set custom budget for environment
cdk deploy --context budget=500
```

#### Alert Contacts
```bash
# Set alert email and phone
cdk deploy --context alertEmail=admin@company.com --context alertPhone=+1234567890
```

#### Project Tags
```bash
# Deploy with custom project settings
cdk deploy --context projectName=my-app --context costCenter=finance
```

## 📊 Monitoring & Dashboards

### CloudWatch Dashboard
Access your cost monitoring dashboard at:
```
https://console.aws.amazon.com/cloudwatch/home#dashboards:name=cost-control-{project}-{environment}
```

### Key Metrics
- **Month-to-Date Spend**: Current spending for the month
- **Projected Monthly Spend**: Extrapolated monthly cost
- **Budget Utilization**: Percentage of budget consumed
- **Service Breakdown**: Cost by AWS service
- **Daily Cost Trends**: Historical spending patterns

### Alerts & Notifications
- **Email Alerts**: Sent to configured email addresses
- **SMS Alerts**: Critical alerts for emergency situations
- **Slack Integration**: Available via SNS webhook (configure separately)

## 🔒 Security & Compliance

### Service Control Policies

The template includes SCPs for organization-level enforcement:

1. **Tag Enforcement Policy**: Prevents resource creation without required tags
2. **Resource Restriction Policy**: Limits instance types and sizes by environment
3. **Regional Restriction Policy**: Restricts deployments to approved regions

To apply SCPs at the organization level:
```bash
# Get the SCP JSON from stack outputs
aws cloudformation describe-stacks --stack-name Tagging-{project}-{environment} --query "Stacks[0].Outputs[?OutputKey=='TagEnforcementPolicy'].OutputValue" --output text

# Apply via AWS Organizations console or CLI
```

### IAM Permissions

The template follows least-privilege principles:
- Lambda functions have minimal required permissions
- Cross-service access is explicitly defined
- Resource-level permissions where possible

## 🚨 Emergency Procedures

### Budget Emergency
When budget threshold is exceeded in development:
1. All EC2 instances with `AutoShutdown=true` are stopped
2. RDS instances with auto-shutdown tag are stopped
3. Auto Scaling Groups are scaled to zero
4. Immediate alerts sent to all stakeholders

### Manual Emergency Shutdown
```bash
# Trigger emergency shutdown manually
aws lambda invoke --function-name auto-shutdown-{project}-{environment} response.json
```

### Emergency Rollback
```bash
# Rollback a deployment due to cost concerns
aws lambda invoke --function-name rollback-{project}-{environment} \
  --payload '{"stackName":"my-stack","reason":"Cost emergency"}' response.json
```

## 📈 Cost Optimization Best Practices

### 1. Tagging Strategy
- **Always tag resources** with Project, Environment, Owner, CostCenter
- Use consistent naming conventions
- Implement tag-based cost allocation

### 2. Right-Sizing
- Monitor the CloudWatch dashboard for utilization metrics
- Use cost optimization recommendations
- Regular review of instance types and sizes

### 3. Automation
- Enable auto-shutdown for non-production resources
- Use S3 lifecycle policies for data archival
- Implement scheduled scaling for predictable workloads

### 4. Monitoring
- Review daily cost reports
- Set up custom budget alerts for specific services
- Monitor cost anomaly detection alerts

## 🛠️ Advanced Configuration

### Custom Budget Thresholds
```typescript
// In types.ts, modify BUDGET_THRESHOLDS
export const BUDGET_THRESHOLDS = {
  WARNING: 40,   // Alert at 40%
  CRITICAL: 70,  // Critical at 70%
  EMERGENCY: 90, // Emergency at 90%
};
```

### Additional Services Monitoring
Extend the cost estimation function to include new AWS services:
```typescript
// Add to cost-estimation-function
case 'AWS::ECS::Service':
  resourceCost = estimateECSCost(properties);
  break;
```

### Custom Automation Rules
Add environment-specific automation in automation-stack.ts:
```typescript
// Custom shutdown schedule for QA environment
if (environment === 'qa') {
  // Custom logic here
}
```

## 🔧 Deployment Scripts

### Complete Deployment
```bash
#!/bin/bash
# deploy.sh

export PROJECT_NAME="my-project"
export ENVIRONMENT="dev"
export ALERT_EMAIL="admin@company.com"

# Deploy all stacks
cdk deploy --all --require-approval never

# Verify deployment
npm run verify-deployment
```

### Verification Script
```bash
#!/bin/bash
# verify-deployment.sh

echo "Verifying AWS Cost Control deployment..."

# Check if all Lambda functions are deployed
FUNCTIONS=(
  "tag-validation-${PROJECT_NAME}-${ENVIRONMENT}"
  "budget-response-${PROJECT_NAME}-${ENVIRONMENT}"
  "resource-validation-${PROJECT_NAME}-${ENVIRONMENT}"
  "auto-shutdown-${PROJECT_NAME}-${ENVIRONMENT}"
  "cost-reporting-${PROJECT_NAME}-${ENVIRONMENT}"
)

for func in "${FUNCTIONS[@]}"; do
  if aws lambda get-function --function-name "$func" &>/dev/null; then
    echo "✅ $func deployed successfully"
  else
    echo "❌ $func deployment failed"
  fi
done

# Check CloudWatch dashboard
DASHBOARD_NAME="cost-control-${PROJECT_NAME}-${ENVIRONMENT}"
if aws cloudwatch describe-dashboards --dashboard-names "$DASHBOARD_NAME" &>/dev/null; then
  echo "✅ CloudWatch dashboard created"
else
  echo "❌ CloudWatch dashboard missing"
fi

echo "Deployment verification complete!"
```

## 🔍 Troubleshooting

### Common Issues

#### 1. Permission Denied Errors
```bash
# Ensure your AWS credentials have sufficient permissions
aws sts get-caller-identity

# Required permissions:
# - CloudFormation full access
# - Lambda full access
# - IAM role creation
# - SNS, CloudWatch, Budgets access
```

#### 2. Budget Creation Fails
```bash
# Budget API is only available in us-east-1
# Ensure your account has billing access enabled
aws budgets describe-budgets --account-id $(aws sts get-caller-identity --query Account --output text)
```

#### 3. Tag Validation Not Working
```bash
# Check if CloudTrail is enabled for API logging
aws cloudtrail describe-trails

# Verify EventBridge rules are active
aws events list-rules --name-prefix tag-validation
```

#### 4. Auto-shutdown Not Working
```bash
# Check Lambda function logs
aws logs filter-log-events --log-group-name /aws/lambda/auto-shutdown-{project}-{environment}

# Verify resources have correct tags
aws ec2 describe-instances --filters "Name=tag:AutoShutdown,Values=true"
```

### Debug Mode
Enable debug logging by setting environment variable:
```bash
export DEBUG=true
cdk deploy
```

### Cost Estimation Issues
```bash
# Test cost estimation function
aws lambda invoke --function-name cost-estimation-{project}-{environment} \
  --payload '{"templateBody":"{\"Resources\":{}}"}' response.json
```

## 📚 API Reference

### Lambda Functions

#### 1. Tag Validation Function
- **Trigger**: CloudTrail events (resource creation)
- **Purpose**: Validates required tags on new resources
- **Response**: Sends SNS alerts for violations

#### 2. Budget Response Function
- **Trigger**: Budget threshold breaches
- **Purpose**: Automated cost containment actions
- **Response**: Stops/scales resources, sends alerts

#### 3. Resource Validation Function
- **Trigger**: CloudTrail events (resource creation)
- **Purpose**: Validates resource compliance with governance rules
- **Response**: Terminates non-compliant resources (dev only)

#### 4. Auto-shutdown Function
- **Trigger**: EventBridge schedule
- **Purpose**: Automatically stops development resources
- **Response**: Stops EC2, RDS, scales down ASGs

#### 5. Cost Reporting Function
- **Trigger**: Daily schedule
- **Purpose**: Generates cost reports and projections
- **Response**: Updates CloudWatch metrics, sends reports

### SNS Topics

#### 1. Tag Violation Topic
- **Purpose**: Alerts for tag compliance violations
- **Subscribers**: Email, optionally Slack webhook

#### 2. Budget Alarm Topic
- **Purpose**: Budget threshold alerts
- **Subscribers**: Email for warnings, SMS for emergencies

#### 3. Governance Violation Topic
- **Purpose**: Resource governance violations
- **Subscribers**: Email alerts to operations team

#### 4. Automation Notification Topic
- **Purpose**: Automated action notifications
- **Subscribers**: Email reports of automated actions

## 📞 Support & Contributing

### Getting Help
- **Issues**: Open GitHub issues for bugs or feature requests
- **Discussions**: Use GitHub discussions for questions
- **Documentation**: Check this README and inline code comments

### Contributing
1. Fork the repository
2. Create a feature branch
3. Make your changes with tests
4. Submit a pull request

### Roadmap
- [ ] Integration with AWS Cost Anomaly Detection
- [ ] Terraform version of the template
- [ ] Custom cost allocation tags
- [ ] Integration with third-party cost management tools
- [ ] Multi-account organization support

## � CI/CD Integration

### GitHub Actions
```yaml
name: Deploy with Cost Controls
on:
  push:
    branches: [main, develop]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
          
      - name: Connect Cost Controls
        run: |
          npx github:theijhay/aws-cost-template connect --non-interactive \
            --environment ${{ github.ref == 'refs/heads/main' && 'prod' || 'dev' }} \
            --budget ${{ github.ref == 'refs/heads/main' && '2000' || '100' }}
            
      - name: Deploy with Cost Protection
        run: npm run deploy-with-cost-controls
        env:
          AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          
      - name: Post-deployment Cost Report
        run: npm run cost-report
```

### GitLab CI
```yaml
stages:
  - connect
  - deploy
  - monitor

connect_cost_controls:
  stage: connect
  script:
    - npx github:theijhay/aws-cost-template connect --non-interactive
    
deploy_with_protection:
  stage: deploy
  script:
    - npm run deploy-with-cost-controls
    
cost_monitoring:
  stage: monitor
  script:
    - npm run cost-report
    - ./quick-cost-check.sh
```

### Multi-Environment Setup
```bash
# Connect different environments with different budgets
npx github:theijhay/aws-cost-template connect --environment dev --budget 50
npx github:theijhay/aws-cost-template connect --environment staging --budget 200  
npx github:theijhay/aws-cost-template connect --environment prod --budget 1000
```

## 🔍 Troubleshooting

### Common Issues

**Connection fails with "No package.json found"**
```bash
# Ensure you're in the root of your AWS project
ls -la  # Should show package.json, cdk.json, or similar

# For non-Node.js projects, initialize npm
npm init -y
```

**Cost estimation fails**
```bash
# For CDK projects, ensure CDK is installed
npm install -g aws-cdk

# For CloudFormation, ensure templates are valid
aws cloudformation validate-template --template-body file://template.yaml
```

**Deployment wrapper doesn't detect project type**
```bash
# Manually specify project type
npx github:theijhay/aws-cost-template connect --type cdk-typescript
npx github:theijhay/aws-cost-template connect --type cloudformation
npx github:theijhay/aws-cost-template connect --type terraform
```

**Budget alerts not working**
```bash
# Check AWS permissions
aws iam get-user
aws budgets describe-budgets --account-id $(aws sts get-caller-identity --query Account --output text)

# Verify email subscription
aws sns list-subscriptions
```

**Auto-shutdown not working**
```bash
# Check EventBridge rules
aws events list-rules --name-prefix "cost-control"

# Verify Lambda functions
aws lambda list-functions --query 'Functions[?starts_with(FunctionName, `cost-control`)]'
```

### Debug Mode
```bash
# Enable detailed logging
DEBUG=cost-controls:* npx github:theijhay/aws-cost-template connect

# Test connection without deployment
npx github:theijhay/aws-cost-template connect --dry-run

# Validate configuration
npx github:theijhay/aws-cost-template connect --validate-only
```

### Getting Help

1. **Check the logs** in your deployment output
2. **Review configuration** in `cost-controls-config.json`
3. **Validate AWS permissions** for budgets, CloudWatch, and Lambda
4. **Test with a simple project** first
5. **Open an issue** on GitHub with your configuration and error logs

## �📄 License

MIT License - see LICENSE file for details.

## 🏆 Success Metrics

After implementing this template, you should expect:
- **40-70% cost reduction** in development environments
- **Zero unexpected bills** above alert thresholds
- **100% resource tagging compliance**
- **Automated cost optimization** without manual intervention
- **Real-time cost visibility** for all stakeholders

---

**🎯 Remember**: This template is designed to be a starting point. Customize it based on your organization's specific needs, compliance requirements, and cost optimization goals.