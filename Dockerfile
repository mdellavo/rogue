FROM python:3.9

ENV DEBIAN_FRONTEND noninteractive
ENV HOME /site
ENV PYTHONDONTWRITEBYTECODE 1
ENV PYTHONBUFFERED 1

WORKDIR /site

RUN pip install --upgrade pip
COPY ./requirements.txt /tmp
RUN pip install -r /tmp/requirements.txt

RUN useradd -ms /bin/bash rogue
USER rogue

EXPOSE 6543

ENTRYPOINT uvicorn --host 0.0.0.0 --port 6543 --factory rogue:create_app --reload
