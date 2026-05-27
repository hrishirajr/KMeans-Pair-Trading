# AWS Deployment

## Architecture

```
EventBridge (cron)
    └─> Lambda (container, runs KMeansPairTrading.py)
            └─> S3 bucket: <BUCKET>/data/*.csv
                    └─> S3 (static frontend) reads /data/*.csv via fetch
```

No EC2 required.

## Prerequisites

- AWS CLI configured (`aws configure`)
- An S3 bucket for the strategy outputs (and optionally frontend)
- Docker installed locally (to build the Lambda image)

Set these once for convenience:

```bash
export AWS_REGION=ap-south-1                          # Mumbai
export AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
export ECR_REPO=kmeans-pair-trading
export S3_BUCKET=your-strategy-bucket-name
export S3_PREFIX=data
export FUNCTION_NAME=kmeans-pair-trading-strategy
```

## 1. Build & push the container image

```bash
# Create ECR repo (one-time)
aws ecr create-repository --repository-name $ECR_REPO --region $AWS_REGION || true

# Login to ECR
aws ecr get-login-password --region $AWS_REGION \
  | docker login --username AWS --password-stdin \
        $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com

# Build from project root (so KMeansPairTrading.py and sector_map.csv are in context)
cd /path/to/KMeans-Pair-Trading
docker build --platform linux/amd64 -f aws/Dockerfile \
    -t $ECR_REPO:latest .

# Tag and push
docker tag $ECR_REPO:latest \
    $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_REPO:latest
docker push $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_REPO:latest
```

## 2. Create the Lambda execution role

`trust-policy.json`:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {"Service": "lambda.amazonaws.com"},
    "Action": "sts:AssumeRole"
  }]
}
```

`s3-policy.json` (replace BUCKET):

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["s3:PutObject", "s3:PutObjectAcl"],
    "Resource": "arn:aws:s3:::your-strategy-bucket-name/*"
  }]
}
```

```bash
aws iam create-role --role-name kmeans-strategy-role \
    --assume-role-policy-document file://trust-policy.json

aws iam attach-role-policy --role-name kmeans-strategy-role \
    --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole

aws iam put-role-policy --role-name kmeans-strategy-role \
    --policy-name s3-write --policy-document file://s3-policy.json
```

## 3. Create the Lambda function

```bash
aws lambda create-function \
    --function-name $FUNCTION_NAME \
    --package-type Image \
    --code ImageUri=$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_REPO:latest \
    --role arn:aws:iam::$AWS_ACCOUNT_ID:role/kmeans-strategy-role \
    --timeout 600 \
    --memory-size 2048 \
    --ephemeral-storage Size=2048 \
    --environment "Variables={S3_BUCKET=$S3_BUCKET,S3_PREFIX=$S3_PREFIX}" \
    --region $AWS_REGION
```

Notes:
- `--timeout 600` = 10 min (max for our use case; runs typically under 2 min)
- `--memory-size 2048` MB — pandas + sklearn + statsmodels need headroom
- `--ephemeral-storage 2048` — `/tmp` quota for working files

## 4. EventBridge schedules

NSE market hours: 9:15 AM – 3:30 PM IST.
IST = UTC + 5:30. EventBridge cron expressions are in UTC.

### Post-close run (the work) — 4:00 PM IST = 10:30 UTC, Mon–Fri

```bash
aws events put-rule \
    --name kmeans-strategy-postclose \
    --schedule-expression "cron(30 10 ? * MON-FRI *)" \
    --region $AWS_REGION

aws lambda add-permission \
    --function-name $FUNCTION_NAME \
    --statement-id eventbridge-postclose \
    --action lambda:InvokeFunction \
    --principal events.amazonaws.com \
    --source-arn arn:aws:events:$AWS_REGION:$AWS_ACCOUNT_ID:rule/kmeans-strategy-postclose

aws events put-targets \
    --rule kmeans-strategy-postclose \
    --targets "Id=1,Arn=arn:aws:lambda:$AWS_REGION:$AWS_ACCOUNT_ID:function:$FUNCTION_NAME" \
    --region $AWS_REGION
```

### Optional pre-open refresh — 8:30 AM IST = 3:00 UTC, Mon–Fri

Mostly defensive — yesterday's signals are still valid. Useful if you want to retry in case the post-close run failed.

```bash
aws events put-rule \
    --name kmeans-strategy-preopen \
    --schedule-expression "cron(0 3 ? * MON-FRI *)" \
    --region $AWS_REGION

aws lambda add-permission \
    --function-name $FUNCTION_NAME \
    --statement-id eventbridge-preopen \
    --action lambda:InvokeFunction \
    --principal events.amazonaws.com \
    --source-arn arn:aws:events:$AWS_REGION:$AWS_ACCOUNT_ID:rule/kmeans-strategy-preopen

aws events put-targets \
    --rule kmeans-strategy-preopen \
    --targets "Id=1,Arn=arn:aws:lambda:$AWS_REGION:$AWS_ACCOUNT_ID:function:$FUNCTION_NAME" \
    --region $AWS_REGION
```

### IST cron quick reference

| Goal | IST | UTC | Cron |
|------|-----|-----|------|
| Pre-open prep | 8:30 AM | 3:00 | `cron(0 3 ? * MON-FRI *)` |
| Post-close run | 4:00 PM | 10:30 | `cron(30 10 ? * MON-FRI *)` |
| Hourly during market | 9:30, 10:30 ... 3:30 PM | 4:00, 5:00 ... 10:00 | `cron(0 4-10 ? * MON-FRI *)` |

## 5. Test invocation

```bash
aws lambda invoke \
    --function-name $FUNCTION_NAME \
    --payload '{"lookback_years": 3}' \
    --cli-binary-format raw-in-base64-out \
    --region $AWS_REGION \
    response.json

cat response.json
aws s3 ls s3://$S3_BUCKET/$S3_PREFIX/
```

## 6. Frontend — point it at S3 instead of local /data

The frontend is currently fetching from `/data/<file>.csv` (relative path). When deployed to S3:

- Either: deploy the frontend to the **same** S3 bucket and put the strategy CSVs at `<bucket>/data/`
- Or: enable CORS on the strategy bucket and change `lib/csv.ts`:

```ts
const DATA_BASE = process.env.NEXT_PUBLIC_DATA_BASE_URL || "/data";
// fetch(`${DATA_BASE}/${file}`)
```

Then set `NEXT_PUBLIC_DATA_BASE_URL=https://<strategy-bucket>.s3.<region>.amazonaws.com/data` at build time.

## Updating the function

After code changes:

```bash
docker build --platform linux/amd64 -f aws/Dockerfile -t $ECR_REPO:latest .
docker tag $ECR_REPO:latest $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_REPO:latest
docker push $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_REPO:latest

aws lambda update-function-code \
    --function-name $FUNCTION_NAME \
    --image-uri $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_REPO:latest \
    --region $AWS_REGION
```

## Monitoring

```bash
# Tail Lambda logs
aws logs tail /aws/lambda/$FUNCTION_NAME --follow --region $AWS_REGION

# Recent run results
aws s3 ls s3://$S3_BUCKET/$S3_PREFIX/ --human-readable
```
