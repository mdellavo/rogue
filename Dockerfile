FROM python:3.9

ENV DEBIAN_FRONTEND noninteractive
ENV HOME /site
WORKDIR /site

ENV PYTHONDONTWRITEBYTECODE 1
ENV PYTHONBUFFERED 1

RUN apt-get update \
    && apt-get -y dist-upgrade \
    && apt-get clean

RUN pip install --upgrade pip
COPY ./requirements.txt /tmp
RUN pip install -r /tmp/requirements.txt

RUN useradd -ms /bin/bash rogue
USER rogue

EXPOSE 6543
CMD python3 -m rogue
ENTRYPOINT python3 -m rogue
