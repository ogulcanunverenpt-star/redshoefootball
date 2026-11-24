FROM node:24-alpine

RUN apk add --no-cache \
    python3 \
    py3-setuptools \
    make \
    g++ \
    sqlite \
    sqlite-dev

WORKDIR /app

COPY package*.json ./

# Dependency'leri kur
RUN npm install --ignore-scripts

# sqlite3 native binding'ini Node 24 Alpine için sıfırdan derle
RUN npm rebuild sqlite3 --build-from-source

COPY . .

# redshoeson istemcisini derle
RUN cd redshoeson && \
    npm install && \
    npm run build

EXPOSE 4000

ENV PORT=4000
ENV NODE_ENV=production

CMD ["node", "app.js"]
