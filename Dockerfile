FROM python:3.12

ENV DEBIAN_FRONTEND noninteractive
ENV HOME /site
ENV PYTHONDONTWRITEBYTECODE 1
ENV PYTHONBUFFERED 1

WORKDIR /site

RUN pip install --upgrade pip

ADD . /site

RUN pip install -r /site/requirements.txt

EXPOSE 6543

ENTRYPOINT uvicorn --host 0.0.0.0 --port 6543 --factory rogue:create_app --reload
