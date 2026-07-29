FROM node:16.3.0-alpine
COPY . /app
RUN mkdir -p /logs && touch /logs/logs.txt
WORKDIR /app
RUN npm install
CMD ["node", "/app/app.js"]
