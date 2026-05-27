FROM public.ecr.aws/lambda/python:3.12

WORKDIR ${LAMBDA_TASK_ROOT}

COPY aws/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY KMeansPairTrading.py ./
COPY sector_map.csv ./
COPY aws/lambda_handler.py ./

CMD ["lambda_handler.handler"]
