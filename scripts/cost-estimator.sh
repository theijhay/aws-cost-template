#!/bin/bash

# AWS Cost Control Template - Cost Estimator Script
# This script estimates costs for CloudFormation templates before deployment

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default values
PROJECT_NAME=${PROJECT_NAME:-"cost-control-demo"}
ENVIRONMENT=${ENVIRONMENT:-"dev"}
TEMPLATE_FILE=""
OUTPUT_FORMAT="table"

# Usage information
usage() {
    echo "Usage: $0 -t <template-file> [-p <project>] [-e <environment>] [-f <format>]"
    echo ""
    echo "Options:"
    echo "  -t, --template    CloudFormation template file (required)"
    echo "  -p, --project     Project name (default: $PROJECT_NAME)"
    echo "  -e, --environment Environment (dev/staging/prod) (default: $ENVIRONMENT)"
    echo "  -f, --format      Output format (table/json) (default: $OUTPUT_FORMAT)"
    echo "  -h, --help        Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0 -t my-template.yaml"
    echo "  $0 -t template.json -p my-app -e prod -f json"
    exit 1
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -t|--template)
            TEMPLATE_FILE="$2"
            shift 2
            ;;
        -p|--project)
            PROJECT_NAME="$2"
            shift 2
            ;;
        -e|--environment)
            ENVIRONMENT="$2"
            shift 2
            ;;
        -f|--format)
            OUTPUT_FORMAT="$2"
            shift 2
            ;;
        -h|--help)
            usage
            ;;
        *)
            echo "Unknown option: $1"
            usage
            ;;
    esac
done

# Validate required parameters
if [ -z "$TEMPLATE_FILE" ]; then
    echo -e "${RED}Error: Template file is required${NC}"
    usage
fi

if [ ! -f "$TEMPLATE_FILE" ]; then
    echo -e "${RED}Error: Template file '$TEMPLATE_FILE' not found${NC}"
    exit 1
fi

# Validate environment
if [[ ! "$ENVIRONMENT" =~ ^(dev|staging|qa|prod)$ ]]; then
    echo -e "${RED}Error: Environment must be dev, staging, qa, or prod${NC}"
    exit 1
fi

# Validate output format
if [[ ! "$OUTPUT_FORMAT" =~ ^(table|json)$ ]]; then
    echo -e "${RED}Error: Output format must be table or json${NC}"
    exit 1
fi

echo -e "${BLUE}💰 AWS Cost Estimator${NC}"
echo "===================="
echo "Template: $TEMPLATE_FILE"
echo "Project: $PROJECT_NAME"
echo "Environment: $ENVIRONMENT"
echo ""

# Check if cost estimation function exists
FUNCTION_NAME="cost-estimation-$PROJECT_NAME-$ENVIRONMENT"
echo -e "${YELLOW}🔍 Checking for cost estimation function...${NC}"

if ! aws lambda get-function --function-name "$FUNCTION_NAME" &>/dev/null; then
    echo -e "${RED}❌ Cost estimation function not found: $FUNCTION_NAME${NC}"
    echo "Please deploy the cost control template first:"
    echo "  ./scripts/deploy.sh"
    exit 1
fi

echo -e "${GREEN}✅ Found cost estimation function${NC}"

# Read and validate template
echo -e "${YELLOW}📄 Reading template file...${NC}"

# Determine template format
if [[ "$TEMPLATE_FILE" =~ \.ya?ml$ ]]; then
    # Convert YAML to JSON
    if command -v yq &> /dev/null; then
        TEMPLATE_JSON=$(yq eval -o=json "$TEMPLATE_FILE")
    elif command -v python3 &> /dev/null; then
        TEMPLATE_JSON=$(python3 -c "
import yaml, json, sys
with open('$TEMPLATE_FILE', 'r') as f:
    data = yaml.safe_load(f)
print(json.dumps(data))
")
    else
        echo -e "${RED}❌ YAML template detected but no YAML parser found${NC}"
        echo "Please install 'yq' or 'python3' with PyYAML"
        exit 1
    fi
else
    # Assume JSON
    TEMPLATE_JSON=$(cat "$TEMPLATE_FILE")
fi

# Validate JSON
if ! echo "$TEMPLATE_JSON" | jq empty 2>/dev/null; then
    echo -e "${RED}❌ Invalid JSON in template file${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Template validated${NC}"

# Create payload for Lambda function
PAYLOAD=$(jq -n --arg template "$TEMPLATE_JSON" '{
    templateBody: $template
}')

# Invoke cost estimation function
echo -e "${YELLOW}🔮 Estimating costs...${NC}"

RESPONSE_FILE=$(mktemp)
INVOKE_RESULT=$(aws lambda invoke \
    --function-name "$FUNCTION_NAME" \
    --payload "$PAYLOAD" \
    "$RESPONSE_FILE" 2>&1)

# Check if invocation was successful
if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Failed to invoke cost estimation function${NC}"
    echo "$INVOKE_RESULT"
    rm -f "$RESPONSE_FILE"
    exit 1
fi

# Parse response
if [ ! -f "$RESPONSE_FILE" ]; then
    echo -e "${RED}❌ No response from cost estimation function${NC}"
    exit 1
fi

RESPONSE=$(cat "$RESPONSE_FILE")
rm -f "$RESPONSE_FILE"

# Check for Lambda errors
if echo "$RESPONSE" | jq -e '.errorMessage' >/dev/null 2>&1; then
    echo -e "${RED}❌ Cost estimation failed:${NC}"
    echo "$RESPONSE" | jq -r '.errorMessage'
    exit 1
fi

# Parse the response body
RESULT_BODY=$(echo "$RESPONSE" | jq -r '.body' 2>/dev/null || echo "$RESPONSE")
if ! echo "$RESULT_BODY" | jq empty 2>/dev/null; then
    echo -e "${RED}❌ Invalid response from cost estimation function${NC}"
    echo "$RESULT_BODY"
    exit 1
fi

# Extract cost information
MONTHLY_COST=$(echo "$RESULT_BODY" | jq -r '.monthlyCost // 0')
RESOURCE_COUNT=$(echo "$RESULT_BODY" | jq -r '.resourceCount // 0')
WARNINGS=$(echo "$RESULT_BODY" | jq -r '.warnings // []')

# Environment-specific thresholds
case $ENVIRONMENT in
    "dev")
        MONTHLY_THRESHOLD=50
        DAILY_THRESHOLD=5
        ;;
    "staging")
        MONTHLY_THRESHOLD=200
        DAILY_THRESHOLD=10
        ;;
    "qa")
        MONTHLY_THRESHOLD=150
        DAILY_THRESHOLD=7
        ;;
    "prod")
        MONTHLY_THRESHOLD=1000
        DAILY_THRESHOLD=50
        ;;
esac

DAILY_COST=$(echo "$MONTHLY_COST / 30" | bc -l)

# Output results
echo -e "${GREEN}✅ Cost estimation completed${NC}"
echo ""

if [ "$OUTPUT_FORMAT" = "json" ]; then
    # JSON output
    jq -n \
        --arg template "$TEMPLATE_FILE" \
        --arg project "$PROJECT_NAME" \
        --arg environment "$ENVIRONMENT" \
        --argjson monthly "$MONTHLY_COST" \
        --argjson daily "$DAILY_COST" \
        --argjson resources "$RESOURCE_COUNT" \
        --argjson monthlyThreshold "$MONTHLY_THRESHOLD" \
        --argjson dailyThreshold "$DAILY_THRESHOLD" \
        --argjson warnings "$WARNINGS" \
        '{
            template: $template,
            project: $project,
            environment: $environment,
            costs: {
                monthly: $monthly,
                daily: $daily,
                currency: "USD"
            },
            resources: $resources,
            thresholds: {
                monthly: $monthlyThreshold,
                daily: $dailyThreshold
            },
            warnings: $warnings,
            timestamp: now | strftime("%Y-%m-%dT%H:%M:%SZ")
        }'
else
    # Table output
    echo -e "${BLUE}📊 Cost Estimation Results${NC}"
    echo "=========================="
    printf "%-20s %s\n" "Monthly Cost:" "\$$(printf "%.2f" "$MONTHLY_COST")"
    printf "%-20s %s\n" "Daily Cost:" "\$$(printf "%.2f" "$DAILY_COST")"
    printf "%-20s %s\n" "Resource Count:" "$RESOURCE_COUNT"
    printf "%-20s %s\n" "Environment:" "$ENVIRONMENT"
    echo ""
    
    # Threshold comparison
    echo -e "${BLUE}🎯 Threshold Analysis${NC}"
    echo "===================="
    
    MONTHLY_EXCEEDED=$(echo "$MONTHLY_COST > $MONTHLY_THRESHOLD" | bc -l)
    DAILY_EXCEEDED=$(echo "$DAILY_COST > $DAILY_THRESHOLD" | bc -l)
    
    if [ "$MONTHLY_EXCEEDED" -eq 1 ]; then
        echo -e "${RED}❌ Monthly cost (\$$(printf "%.2f" "$MONTHLY_COST")) exceeds threshold (\$$MONTHLY_THRESHOLD)${NC}"
    else
        echo -e "${GREEN}✅ Monthly cost (\$$(printf "%.2f" "$MONTHLY_COST")) within threshold (\$$MONTHLY_THRESHOLD)${NC}"
    fi
    
    if [ "$DAILY_EXCEEDED" -eq 1 ]; then
        echo -e "${RED}❌ Daily cost (\$$(printf "%.2f" "$DAILY_COST")) exceeds threshold (\$$DAILY_THRESHOLD)${NC}"
    else
        echo -e "${GREEN}✅ Daily cost (\$$(printf "%.2f" "$DAILY_COST")) within threshold (\$$DAILY_THRESHOLD)${NC}"
    fi
    
    # Warnings
    WARNING_COUNT=$(echo "$WARNINGS" | jq 'length')
    if [ "$WARNING_COUNT" -gt 0 ]; then
        echo ""
        echo -e "${YELLOW}⚠️ Warnings${NC}"
        echo "=========="
        echo "$WARNINGS" | jq -r '.[] | "• " + .'
    fi
    
    # Cost breakdown by resource type (if available in response)
    if echo "$RESULT_BODY" | jq -e '.resourceBreakdown' >/dev/null 2>&1; then
        echo ""
        echo -e "${BLUE}📋 Resource Breakdown${NC}"
        echo "===================="
        echo "$RESULT_BODY" | jq -r '
            .resourceBreakdown // {} | 
            to_entries | 
            sort_by(.value.monthlyCost) | 
            reverse | 
            .[] | 
            "• " + .key + " (" + .value.type + "): $" + (.value.monthlyCost | tostring)
        '
    fi
fi

# Exit with appropriate code
if [ "$MONTHLY_EXCEEDED" -eq 1 ] || [ "$DAILY_EXCEEDED" -eq 1 ] || [ "$WARNING_COUNT" -gt 0 ]; then
    echo ""
    echo -e "${YELLOW}⚠️ Cost estimation completed with warnings${NC}"
    exit 2
else
    echo ""
    echo -e "${GREEN}🎉 Cost estimation completed successfully${NC}"
    exit 0
fi