FROM ubuntu
MAINTAINER Marc DellaVolpe "marc.dellavolpe@gmail.com"

VOLUME /home/rogue

ENV DEBIAN_FRONTEND noninteractive
ENV HOME /home/rogue
WORKDIR /home/rogue

RUN apt-get update
RUN apt-get dist-upgrade -y
RUN apt-get install -y software-properties-common

RUN add-apt-repository ppa:deadsnakes/ppa
RUN apt-get update
RUN apt-get install -y python3.7 python3.7-dev python3-pip python3.7-distutils
COPY requirements.txt /tmp
RUN python3.7 -m pip install -r /tmp/requirements.txt
RUN rm /tmp/requirements.txt

RUN apt-get purge -y software-properties-common
RUN apt-get -y autoremove

RUN useradd -ms /bin/bash rogue
USER rogue

CMD python3.7 -m rogue
