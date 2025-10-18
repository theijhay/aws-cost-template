#!/bin/bash

# AWS Cost Control Template - Deployment Script
# This script deploys the complete cost control infrastructure

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
PROJECT_NAME=${PROJECT_NAME:-"cost-control-demo"}
ENVIRONMENT=${ENVIRONMENT:-"dev"}
COST_CENTER=${COST_CENTER:-"engineering"}
OWNER=${OWNER:-"devops-team"}
ALERT_EMAIL=${ALERT_EMAIL:-"devops@company.com"}
ALERT_PHONE=${ALERT_PHONE:-""}
BUDGET=${BUDGET:-""}

echo -e "${GREEN}🚀 AWS Cost Control Template Deployment${NC}"
echo "========================================"
echo "Project: $PROJECT_NAME"
echo "Environment: $ENVIRONMENT"
echo "Cost Center: $COST_CENTER"
echo "Owner: $OWNER"
echo "Alert Email: $ALERT_EMAIL"
echo ""

# Validate prerequisites
echo -e "${YELLOW}📋 Checking prerequisites...${NC}"

# Check AWS CLI
if ! command -v aws &> /dev/null; then
    echo -e "${RED}❌ AWS CLI not found. Please install AWS CLI.${NC}"
    exit 1
fi

# Check CDK CLI
if ! command -v cdk &> /dev/null; then
    echo -e "${RED}❌ AWS CDK CLI not found. Installing...${NC}"
    npm install -g aws-cdk
fi

# Check Node.js version
NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo -e "${RED}❌ Node.js 18+ required. Current version: $(node --version)${NC}"
    exit 1
fi

# Check AWS credentials
if ! aws sts get-caller-identity &> /dev/null; then
    echo -e "${RED}❌ AWS credentials not configured or invalid.${NC}"
    echo "Please run 'aws configure' or set environment variables."
    exit 1
fi

echo -e "${GREEN}✅ Prerequisites check passed${NC}"

# Install dependencies
echo -e "${YELLOW}📦 Installing dependencies...${NC}"
npm install

# Build the project
echo -e "${YELLOW}🔨 Building the project...${NC}"
npm run build

# Bootstrap CDK if needed
echo -e "${YELLOW}🏗️ Bootstrapping CDK...${NC}"
CDK_DEFAULT_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
CDK_DEFAULT_REGION=$(aws configure get region)
CDK_DEFAULT_REGION=${CDK_DEFAULT_REGION:-us-east-1}

cdk bootstrap aws://$CDK_DEFAULT_ACCOUNT/$CDK_DEFAULT_REGION

# Set budget based on environment if not provided
if [ -z "$BUDGET" ]; then
    case $ENVIRONMENT in
        "dev")
            BUDGET=100
            ;;
        "staging")
            BUDGET=300
            ;;
        "qa")
            BUDGET=150
            ;;
        "prod")
            BUDGET=1000
            ;;
        *)
            BUDGET=100
            ;;
    esac
fi

echo -e "${YELLOW}💰 Budget set to: $${BUDGET}/month${NC}"

# Deploy the stacks
echo -e "${YELLOW}🚀 Deploying cost control infrastructure...${NC}"

# Prepare CDK context
CDK_CONTEXT="--context projectName=$PROJECT_NAME --context environment=$ENVIRONMENT --context costCenter=$COST_CENTER --context owner=$OWNER --context alertEmail=$ALERT_EMAIL"

if [ -n "$ALERT_PHONE" ]; then
    CDK_CONTEXT="$CDK_CONTEXT --context alertPhone=$ALERT_PHONE"
fi

# Deploy in order (dependencies handled by CDK)
cdk deploy --all $CDK_CONTEXT --require-approval never

# Verify deployment
echo -e "${YELLOW}🔍 Verifying deployment...${NC}"

# Check Lambda functions
FUNCTIONS=(
    "tag-validation-$PROJECT_NAME-$ENVIRONMENT"
    "tag-compliance-report-$PROJECT_NAME-$ENVIRONMENT"
    "budget-response-$PROJECT_NAME-$ENVIRONMENT"
    "cost-anomaly-detection-$PROJECT_NAME-$ENVIRONMENT"
    "resource-validation-$PROJECT_NAME-$ENVIRONMENT"
    "compliance-report-$PROJECT_NAME-$ENVIRONMENT"
    "auto-shutdown-$PROJECT_NAME-$ENVIRONMENT"
    "resource-cleanup-$PROJECT_NAME-$ENVIRONMENT"
    "lifecycle-management-$PROJECT_NAME-$ENVIRONMENT"
    "cost-reporting-$PROJECT_NAME-$ENVIRONMENT"
    "cost-alerts-$PROJECT_NAME-$ENVIRONMENT"
    "cost-estimation-$PROJECT_NAME-$ENVIRONMENT"
    "deployment-guard-$PROJECT_NAME-$ENVIRONMENT"
    "rollback-$PROJECT_NAME-$ENVIRONMENT"
)

LAMBDA_SUCCESS=0
for func in "${FUNCTIONS[@]}"; do
    if aws lambda get-function --function-name "$func" &>/dev/null; then
        echo -e "${GREEN}✅ $func${NC}"
        ((LAMBDA_SUCCESS++))
    else
        echo -e "${RED}❌ $func${NC}"
    fi
done

# Check CloudWatch dashboard
DASHBOARD_NAME="cost-control-$PROJECT_NAME-$ENVIRONMENT"
if aws cloudwatch describe-dashboards --dashboard-names "$DASHBOARD_NAME" &>/dev/null; then
    echo -e "${GREEN}✅ CloudWatch dashboard: $DASHBOARD_NAME${NC}"
else
    echo -e "${RED}❌ CloudWatch dashboard missing${NC}"
fi

# Check budgets
BUDGET_NAME="$PROJECT_NAME-$ENVIRONMENT-monthly-budget"
if aws budgets describe-budget --account-id $CDK_DEFAULT_ACCOUNT --budget-name "$BUDGET_NAME" &>/dev/null; then
    echo -e "${GREEN}✅ Budget: $BUDGET_NAME${NC}"
else
    echo -e "${RED}❌ Budget missing: $BUDGET_NAME${NC}"
fi

# Get stack outputs
echo -e "${YELLOW}📊 Getting deployment information...${NC}"

# Get dashboard URL
DASHBOARD_URL="https://console.aws.amazon.com/cloudwatch/home?region=$CDK_DEFAULT_REGION#dashboards:name=$DASHBOARD_NAME"

# Get SNS topic ARNs
TAG_VIOLATION_TOPIC=$(aws cloudformation describe-stacks --stack-name "Tagging-$PROJECT_NAME-$ENVIRONMENT" --query "Stacks[0].Outputs[?OutputKey=='TagViolationTopicArn'].OutputValue" --output text 2>/dev/null || echo "Not found")
BUDGET_ALARM_TOPIC=$(aws cloudformation describe-stacks --stack-name "Budget-$PROJECT_NAME-$ENVIRONMENT" --query "Stacks[0].Outputs[?OutputKey=='BudgetAlarmTopicArn'].OutputValue" --output text 2>/dev/null || echo "Not found")

echo ""
echo -e "${GREEN}🎉 Deployment Summary${NC}"
echo "===================="
echo "✅ Lambda Functions: $LAMBDA_SUCCESS/14 deployed"
echo "✅ Project: $PROJECT_NAME"
echo "✅ Environment: $ENVIRONMENT"
echo "✅ Budget: \$$BUDGET/month"
echo "✅ Region: $CDK_DEFAULT_REGION"
echo ""
echo -e "${YELLOW}📊 Access Points:${NC}"
echo "Dashboard: $DASHBOARD_URL"
echo "Tag Violations Topic: $TAG_VIOLATION_TOPIC"
echo "Budget Alarms Topic: $BUDGET_ALARM_TOPIC"
echo ""
echo -e "${YELLOW}🔑 Next Steps:${NC}"
echo "1. Subscribe to SNS topics for alerts"
echo "2. Review CloudWatch dashboard"
echo "3. Test tag validation by creating a resource without required tags"
echo "4. Configure Service Control Policies at organization level"
echo "5. Set up auto-shutdown tags on development resources"
echo ""
echo -e "${YELLOW}⚡ Quick Test Commands:${NC}"
echo "# Test tag validation"
echo "aws ec2 run-instances --image-id ami-0abcdef1234567890 --instance-type t3.micro --count 1"
echo ""
echo "# Test cost estimation"
echo "aws lambda invoke --function-name cost-estimation-$PROJECT_NAME-$ENVIRONMENT --payload '{\"templateBody\":\"{\\\"Resources\\\":{\\\"TestInstance\\\":{\\\"Type\\\":\\\"AWS::EC2::Instance\\\",\\\"Properties\\\":{\\\"InstanceType\\\":\\\"t3.micro\\\"}}}}\"}'} response.json"
echo ""
echo "# View cost report"
echo "aws lambda invoke --function-name cost-reporting-$PROJECT_NAME-$ENVIRONMENT response.json"
echo ""

# Generate deployment report
REPORT_FILE="deployment-report-$(date +%Y%m%d-%H%M%S).json"
cat > "$REPORT_FILE" << EOF
{
  "deployment": {
    "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
    "project": "$PROJECT_NAME",
    "environment": "$ENVIRONMENT",
    "region": "$CDK_DEFAULT_REGION",
    "account": "$CDK_DEFAULT_ACCOUNT",
    "budget": $BUDGET,
    "owner": "$OWNER",
    "costCenter": "$COST_CENTER"
  },
  "resources": {
    "lambdaFunctions": $LAMBDA_SUCCESS,
    "dashboardUrl": "$DASHBOARD_URL",
    "budgetName": "$BUDGET_NAME",
    "tagViolationTopic": "$TAG_VIOLATION_TOPIC",
    "budgetAlarmTopic": "$BUDGET_ALARM_TOPIC"
  },
  "status": "$([ $LAMBDA_SUCCESS -eq 14 ] && echo 'SUCCESS' || echo 'PARTIAL')"
}
EOF

echo -e "${GREEN}📋 Deployment report saved: $REPORT_FILE${NC}"

if [ $LAMBDA_SUCCESS -eq 14 ]; then
    echo -e "${GREEN}🎉 Deployment completed successfully!${NC}"
    exit 0
else
    echo -e "${YELLOW}⚠️ Deployment completed with some issues. Check the logs above.${NC}"
    exit 1
fi