FROM node:22
WORKDIR /app

COPY package*.json ./
RUN npm install --omit=optional

COPY . .

EXPOSE 3008
CMD ["npm", "run", "start"]
