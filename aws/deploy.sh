#!/usr/bin/env bash
#
# One-shot deploy script for the KMeans Pair Trading Lambda.
#
# Required env vars (set them before running):
#   AWS_REGION       e.g. ap-south-1
#   S3_BUCKET        target bucket for strategy CSV outputs
#
# Optional (sensible defaults):
#   ECR_REPO=kmeans-pair-trading
#   FUNCTION_NAME=kmeans-pair-trading-strategy
#   ROLE_NAME=kmeans-strategy-role
#   S3_PREFIX=data
#
# Usage from repo root:
#   AWS_REGION=ap-south-1 S3_BUCKET=my-strategy-bucket ./aws/deploy.sh

set -euo pipefail

# ── Config ─────────────────────────────────────────────────────────
: "${AWS_REGION:?AWS_REGION must be set}"
: "${S3_BUCKET:?S3_BUCKET must be set}"

ECR_REPO="${ECR_REPO:-kmeans-pair-trading}"
FUNCTION_NAME="${FUNCTION_NAME:-kmeans-pair-trading-strategy}"
ROLE_NAME="${ROLE_NAME:-kmeans-strategy-role}"
S3_PREFIX="${S3_PREFIX:-data}"
IMAGE_TAG="${IMAGE_TAG:-latest}"

AWS_ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
ECR_URI="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${ECR_REPO}"

# Repo root is the parent of this script's directory
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &> /dev/null && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

log()  { printf "\033[1;34m[%s]\033[0m %s\n" "$(date +%H:%M:%S)" "$*"; }
warn() { printf "\033[1;33m[%s] WARN:\033[0m %s\n" "$(date +%H:%M:%S)" "$*"; }

log "Repo root:    $REPO_ROOT"
log "AWS account:  $AWS_ACCOUNT_ID"
log "Region:       $AWS_REGION"
log "ECR repo:     $ECR_REPO ($ECR_URI)"
log "Lambda fn:    $FUNCTION_NAME"
log "S3 target:    s3://$S3_BUCKET/$S3_PREFIX/"

# ── 1. Ensure ECR repo exists ──────────────────────────────────────
log "Ensuring ECR repository exists..."
aws ecr describe-repositories --repository-names "$ECR_REPO" --region "$AWS_REGION" >/dev/null 2>&1 \
  || aws ecr create-repository --repository-name "$ECR_REPO" --region "$AWS_REGION" >/dev/null

# ── 2. Build & push image ──────────────────────────────────────────
log "Logging in to ECR..."
aws ecr get-login-password --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin "${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com" >/dev/null

log "Building image (linux/amd64)..."
docker build --platform linux/amd64 \
  -f "$REPO_ROOT/aws/Dockerfile" \
  -t "$ECR_REPO:$IMAGE_TAG" \
  "$REPO_ROOT"

log "Tagging and pushing image..."
docker tag "$ECR_REPO:$IMAGE_TAG" "$ECR_URI:$IMAGE_TAG"
docker push "$ECR_URI:$IMAGE_TAG"

# ── 3. Ensure IAM role exists ──────────────────────────────────────
log "Ensuring IAM role $ROLE_NAME..."

ROLE_ARN="arn:aws:iam::${AWS_ACCOUNT_ID}:role/${ROLE_NAME}"

TRUST_POLICY=$(cat <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {"Service": "lambda.amazonaws.com"},
    "Action": "sts:AssumeRole"
  }]
}
EOF
)

S3_POLICY=$(cat <<EOF
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["s3:PutObject", "s3:PutObjectAcl"],
    "Resource": "arn:aws:s3:::${S3_BUCKET}/*"
  }]
}
EOF
)

if aws iam get-role --role-name "$ROLE_NAME" >/dev/null 2>&1; then
  log "Role exists, ensuring policies are attached"
else
  log "Creating role $ROLE_NAME"
  aws iam create-role \
    --role-name "$ROLE_NAME" \
    --assume-role-policy-document "$TRUST_POLICY" >/dev/null
  log "Waiting 10s for role propagation"
  sleep 10
fi

aws iam attach-role-policy \
  --role-name "$ROLE_NAME" \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole >/dev/null 2>&1 || true

aws iam put-role-policy \
  --role-name "$ROLE_NAME" \
  --policy-name s3-write \
  --policy-document "$S3_POLICY" >/dev/null

# ── 4. Create or update Lambda function ────────────────────────────
log "Deploying Lambda function..."

ENV_VARS="Variables={S3_BUCKET=${S3_BUCKET},S3_PREFIX=${S3_PREFIX}}"

if aws lambda get-function --function-name "$FUNCTION_NAME" --region "$AWS_REGION" >/dev/null 2>&1; then
  log "Updating existing function code"
  aws lambda update-function-code \
    --function-name "$FUNCTION_NAME" \
    --image-uri "$ECR_URI:$IMAGE_TAG" \
    --region "$AWS_REGION" >/dev/null

  log "Waiting for code update to settle"
  aws lambda wait function-updated --function-name "$FUNCTION_NAME" --region "$AWS_REGION"

  log "Updating function configuration"
  aws lambda update-function-configuration \
    --function-name "$FUNCTION_NAME" \
    --timeout 600 \
    --memory-size 2048 \
    --ephemeral-storage Size=2048 \
    --environment "$ENV_VARS" \
    --region "$AWS_REGION" >/dev/null
else
  log "Creating new function"
  aws lambda create-function \
    --function-name "$FUNCTION_NAME" \
    --package-type Image \
    --code "ImageUri=$ECR_URI:$IMAGE_TAG" \
    --role "$ROLE_ARN" \
    --timeout 600 \
    --memory-size 2048 \
    --ephemeral-storage Size=2048 \
    --environment "$ENV_VARS" \
    --region "$AWS_REGION" >/dev/null
fi

aws lambda wait function-updated --function-name "$FUNCTION_NAME" --region "$AWS_REGION"
LAMBDA_ARN="arn:aws:lambda:${AWS_REGION}:${AWS_ACCOUNT_ID}:function:${FUNCTION_NAME}"

# ── 5. EventBridge rules ───────────────────────────────────────────
create_rule() {
  local rule_name="$1"
  local schedule="$2"
  local stmt_id="$3"

  log "Rule: $rule_name -> $schedule"

  aws events put-rule \
    --name "$rule_name" \
    --schedule-expression "$schedule" \
    --state ENABLED \
    --region "$AWS_REGION" >/dev/null

  aws lambda add-permission \
    --function-name "$FUNCTION_NAME" \
    --statement-id "$stmt_id" \
    --action lambda:InvokeFunction \
    --principal events.amazonaws.com \
    --source-arn "arn:aws:events:${AWS_REGION}:${AWS_ACCOUNT_ID}:rule/${rule_name}" \
    --region "$AWS_REGION" >/dev/null 2>&1 || true

  aws events put-targets \
    --rule "$rule_name" \
    --targets "Id=1,Arn=${LAMBDA_ARN}" \
    --region "$AWS_REGION" >/dev/null
}

# 4:00 PM IST = 10:30 UTC, Mon–Fri  (post-close, the work)
create_rule "kmeans-strategy-postclose" \
            "cron(30 10 ? * MON-FRI *)" \
            "eventbridge-postclose"

# 8:30 AM IST = 3:00 UTC, Mon–Fri  (pre-open, defensive)
create_rule "kmeans-strategy-preopen" \
            "cron(0 3 ? * MON-FRI *)" \
            "eventbridge-preopen"

# ── 6. Done ────────────────────────────────────────────────────────
log "Deployment complete."
cat <<MSG

Next steps:
  • Test:    aws lambda invoke --function-name $FUNCTION_NAME \\
                --payload '{"lookback_years": 3}' \\
                --cli-binary-format raw-in-base64-out \\
                --region $AWS_REGION response.json && cat response.json
  • Logs:    aws logs tail /aws/lambda/$FUNCTION_NAME --follow --region $AWS_REGION
  • Verify:  aws s3 ls s3://$S3_BUCKET/$S3_PREFIX/ --human-readable
  • Re-run this script anytime to push code or config changes.

MSG
