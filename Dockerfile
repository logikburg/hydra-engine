FROM  gcr.io/google_appengine/nodejs
MAINTAINER sandeep.mogla@gmail.com

RUN apt-get update \
 && apt-get install -y curl vim telnet iputils-ping sudo

RUN npm install -g pm2
RUN mkdir -p /logs

COPY hydra-engine.js hydra.js
COPY package.json package.json
COPY node_modules node_modules
COPY README.md README.md

EXPOSE 8080

CMD ["node","hydro.js"]