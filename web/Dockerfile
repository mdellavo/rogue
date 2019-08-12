FROM ubuntu
MAINTAINER Marc DellaVolpe "marc.dellavolpe@gmail.com"

VOLUME /home/rogue-web

ENV DEBIAN_FRONTEND noninteractive
ENV HOME /home/rogue-web
WORKDIR /home/rogue-web

RUN apt-get update
RUN apt-get install -y curl gnupg
RUN curl -sS https://dl.yarnpkg.com/debian/pubkey.gpg | apt-key add -
RUN echo "deb https://dl.yarnpkg.com/debian/ stable main" | tee /etc/apt/sources.list.d/yarn.list
RUN apt-get update

RUN apt-get dist-upgrade -y
RUN apt-get install -y nodejs yarn

RUN useradd -ms /bin/bash rogue-web
USER rogue-web

CMD yarn start